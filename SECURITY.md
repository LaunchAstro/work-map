# Security

## Report a problem privately

Report security problems through GitHub's private vulnerability reporting: open this repository's **Security** tab and choose **Report a vulnerability**. Please don't open a public issue, pull request or discussion for one.

Include the commit you ran, your macOS and Node versions, the steps that show the problem and what you expected instead. We reply on the advisory, work on a fix in private and credit you when it's published, unless you'd rather not be named.

Only the latest commit on `main` gets fixes.

## What the work map is allowed to do

The work map runs on your own machine. These are the promises it makes, so a way to break any of them is a security problem:

- **Local only.** The server listens on `127.0.0.1` and nowhere else. It answers only requests whose `Host` header is exactly `127.0.0.1:<port>`, and refuses a request from any other origin. That check also stops DNS rebinding.
- **Sync needs the page itself.** The Sync route accepts only a same-origin `POST` with the work map's own header and an empty body. A page on another site can't start a Sync.
- **Read-only on GitHub.** It reads GitHub through the GitHub CLI (`gh`) under your own login and sends queries only. It never creates, edits, comments on, labels or merges anything.
- **No credentials of its own.** It never asks for, stores or logs a token. `gh` keeps your login.
- **Files stay in their folders.** The server serves only the built page and the data folder's published files, never a path outside them.
- **Configured sites only.** The optional site-version check fetches only the HTTPS addresses in your own config, with time and size limits, and refuses redirects.
- **No paid services.** It calls no paid API and no model.

## Out of scope

- Anything that needs someone already logged in to your Mac as you, or able to edit your config or data folder.
- GitHub's rate limits. The map reads under your login's hourly budget and stops reading below a floor; running out of budget is not a security problem.
- Problems in `gh`, Node, pnpm or a dependency, unless the work map uses it unsafely. Report those to their own projects.
