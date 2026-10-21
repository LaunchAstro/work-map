# GitHub budget

How the Rust engine reads GitHub while the app is open and stays well inside the user's own rate limit. Resolves #12.

Inputs: the settled decisions in #3 (refresh only while open, the `gh` login, deep sync retired) and the archive's budget ticket. That ticket measured the old engine re-reading every card every five minutes, about 1,900 GraphQL points an hour across the maintainer's two live maps. After its fix, with the timer reading only the merge panel and Sync reading only what changed, the two maps spent about 25 to 70 points an hour. This spec carries that design over and adds REST conditional requests, budget rules scaled to the user's limit, and back-off.

## Facts from GitHub's docs

Read on 21 October 2026.

- The REST limit for a signed-in user is 5,000 requests an hour, and every credential the user holds draws on that one limit. The token from `gh auth login` belongs to the GitHub CLI's OAuth app, so the work map shares one limit with the user's `gh` commands, agents and other tools. ([REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api))
- GraphQL has its own 5,000 points an hour. A query costs the number of connection requests it could make, divided by 100 and rounded, with a minimum of 1. Every query can ask for `rateLimit { cost limit remaining used resetAt }`. Going over returns HTTP 200 with an error and `x-ratelimit-remaining: 0`, not a 403. ([GraphQL limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api))
- Secondary limits apply on top: 100 concurrent requests shared by REST and GraphQL, 900 REST points and 2,000 GraphQL points a minute, and a CPU time cap. A hit comes back as 403 or 429 on REST, or as 200 or 403 on GraphQL. Wait for `retry-after` if it is sent, otherwise at least a minute, then back off exponentially. (same two pages)
- A 304 Not Modified answer to a request sent with an `Authorization` header does not count against the primary limit. Requests must stay identical to get a 304: a different page size, page or filter gives a different `etag`. ([REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api))
- `GET /rate_limit` does not count against the primary limit but can count against the secondary one. When it disagrees with the `x-ratelimit-*` headers, the headers win. ([Rate limit endpoint](https://docs.github.com/en/rest/rate-limit/rate-limit))
- REST responses carry `x-ratelimit-limit`, `-remaining`, `-used`, `-resource` and `-reset`, the last in UTC epoch seconds.
- `gh auth token` prints the active account's token ([manual](https://cli.github.com/manual/gh_auth_token)). `gh api --cache` keeps answers for a fixed time and never revalidates with an ETag, so the engine does not use it.

Not confirmed in the docs: whether GraphQL offers conditional requests (treat it as no), and whether GraphQL `search` draws on the REST search limit of 30 a minute (the docs suggest not). The design below works either way: it never relies on a GraphQL 304, and it sends at most a few searches per Sync.

## The rules

Every rule has a test the Rust build must prove. The tests run against a fake GitHub server with a fake clock. The fake counts requests and points and returns the headers and errors listed above.

### Sign-in and plumbing

**B1. Token from `gh`, held in memory.** At start the engine runs `gh auth token` once and calls `api.github.com` directly, so it sees every header and can send `If-None-Match`. On a 401 it asks `gh` once more. If that fails too, the screen says "Sign in with `gh auth login`" and polling stops until the user presses Retry. The token is never written to disk or to a log.
Test: a 401 from the fake triggers exactly one more `gh auth token` call, and the token string appears in no file or log line the engine writes.

**B2. One request at a time.** The engine sends at most one GitHub request at a time, across every project tab. Polls, Syncs and kicks queue behind each other. This keeps the engine far from the concurrency and per-minute secondary limits.
Test: with a poll, a Sync and a kick fired at once, the fake never sees two requests open together.

**B3. Every call reports what it cost.** Every GraphQL query asks for `rateLimit { cost remaining limit resetAt }`. Every REST response's `x-ratelimit-*` headers update the engine's view of the budget. `GET /rate_limit` is called only at start and when waking from a pause (B10). The run log records each call's reader, cost and points left.
Test: one poll logs one entry with its cost and makes no `GET /rate_limit` call except on the first poll.

### The poll timer

**B4. Five minutes while open.** The engine polls on start, then every 300 seconds while it runs, with a window or headless. There are no OS background services (#3). A tick that comes while the last poll is still running is dropped, not queued. The engine does not slow down when the window is hidden: a poll costs one point, and keeping it simple is worth more than saving that point.
Test: over one fake hour the engine starts exactly 13 polls per project, and a slow poll that overruns a tick does not cause a second one.

**B5. A poll reads only the merge panel, in one GraphQL query per project.** The query reads merged PRs on the product repository updated since the last watermark minus a 10-minute overlap, newest first, stopping at the watermark. In the same call it reads the merge queue's length and first 20 entries, and the count of open approved PRs. It uses GraphQL because the merge queue has no REST endpoint. A quiet hour costs 12 points per project tab, about a quarter of one per cent of the user's limit.
Test: a poll with no new merges makes one GraphQL call costing 1 point and no REST calls; an hour of quiet polls spends no more than 13 points per project.

**B6. Polls never read cards.** Cards, the loading bay, map gaps and site versions update only on Sync. The one exception: a project whose cards were never read gets one card read on its first poll.
Test: a poll that finds a new merge leaves every card's read time unchanged; a project with no card cache reads its cards on the first poll only.

### Sync

**B7. Sync reads only what changed.** Sync reads the merge panel, then one change probe for each group of up to 15 configured repositories: a GraphQL search for `repo:A repo:B ... updated:>=` the cards' last read minus 10 minutes, at one point a page. It re-reads incrementally only the repositories and kinds (issues, or PR states) the probe names. Then it reads map gaps and site versions. If the probe needs more than 3 pages, Sync reads every repository incrementally instead.
Test: with one issue changed in one of five repositories, Sync re-reads only that repository's issues; with nothing changed, Sync costs the panel query plus one probe point.

**B8. Backstops.** The first Sync more than 24 hours after the last all-repository read skips the probe and reads every repository incrementally. The first Sync more than 7 days after the last full read reads everything from scratch, so deleted and transferred issues drop out. Cards never read before get a full read.
Test: at a fake 25 hours the Sync reads every repository incrementally; at a fake 8 days it does a full read, and a deleted issue leaves the count.

**B9. Conditional REST reads and immutable data.** Every REST GET goes through one cache that stores the ETag, `last-modified` and body for each exact URL and headers. It sends `If-None-Match` (or `If-Modified-Since` when there is no ETag) and serves the stored body on a 304. Request URLs, page sizes and `Accept` headers stay fixed so the 304s keep coming. A merged PR's file list, once read in full, is never read again.
Test: a second Sync with nothing changed gets 304s for every REST read, spends no REST primary limit, and shows the same site versions.

### Low budget and back-off

Thresholds scale with the `limit` GitHub reports, so they still hold for accounts with a higher limit. For a 5,000 limit they match the archive's 1,500 and 1,000.

**B10. Light floor at 30%.** When either the REST or the GraphQL remainder is under 30% of its limit, the timer and the kick send nothing. The remainder can only rise at the reset, so the next poll waits until `resetAt` plus 5 seconds, starting with a `GET /rate_limit`.
Test: with the fake reporting 1,400 of 5,000 left, the next three ticks send no request, and the first request after the reset time is `GET /rate_limit`.

**B11. Reserve at 20%.** Sync does not start under 20% left. Before each call, Sync takes the call's expected cost (that reader's last cost, or 100 when it has none) and stops if the call would take the remainder under 20%. It keeps everything it read. Cards it did not reach keep their old values and age.
Test: a Sync started at 1,050 of 5,000 left, with reads costing 30 points each, makes one read, stops before the second, and the cards it skipped keep their previous values.

**B12. GitHub's own stop signals win.** On a primary-limit answer (REST 403 or 429 with `x-ratelimit-remaining: 0`, or a GraphQL 200 carrying a rate-limit error), the engine sends nothing until the reset time. On a secondary-limit answer, it waits `retry-after` seconds, or 60 when the header is missing. Each further secondary hit in a row doubles the wait, up to 15 minutes. A network failure or 5xx drops that poll, and the next tick tries again. The engine never retries inside a poll.
Test: two secondary hits in a row with no `retry-after` produce waits of 60 then 120 seconds, and a GraphQL 200 with a rate-limit error pauses the engine until `resetAt`.

### What the screen shows

**B13. Old values with their age, never pending for a skip.** Cards show their last read at any age, with "cards 2 hours ago" in the header. The merge panel shows "Merges as of 13:20" when its last poll was skipped or failed. Pending means only that a card was never read. The header shows the budget only when the timer is paused: "Live merges paused: GitHub budget low, 1,240 left, resets 14:05". Under the reserve the Sync button is disabled and says the same. After a secondary-limit hit the header says "GitHub asked the map to slow down, next try 13:42". After three failed polls in a row it says "GitHub unreachable since 13:10". Hovering the budget line shows the points this app spent in the last hour, so the user can tell the map's share from their other tools'.
Test: a screen render with a 3-hour-old card cache and a paused timer shows the cards' values, "3 hours ago" and the pause line, and no card reads as pending.

### The optional kick

**B14. A kick is a poll now, nothing more.** An outside script, for example a build tool after a merge, can ask the running engine to poll now. The kick runs B5 at once and follows the same floor and back-off rules. Kicks within 30 seconds of each other count as one. A kick never reads cards. When the app is not running, a kick does nothing and nothing queues for later. The kick's interface, the call an outside script makes, belongs to the screen-to-engine contract (#9).
Test: five kicks in ten seconds produce one poll; a kick under the light floor sends nothing; a kick makes no card read.
