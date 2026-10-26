# Ticket and section lines

The map places a pull request or an issue on a section from what the work states: a line in its body, an ID in its title or branch, or an approved mapping. It doesn't place work by the files it changes. These are the lines it reads.

## In a pull request or issue body

Put each line on its own line, anywhere in the body:

```
Section: checkout
Ticket: C80
```

- `Section: <id>` names a section by its id in `flow.json`. Only an exact id counts: `Section: checkout-api` is not `checkout`.
- `Ticket: C80` names a plan ticket, and `Tickets: C80, C81` several. `Unit: U32` names a whole unit when no single ticket fits. The IDs come from the unit table (`files.plan`).
- `Ticket: #12` names a ticket filed as an issue; `Refs #12` and `Closes #12` do too. Another repository's issue is `example-org/example-app#12`.
- `Ticket: none` marks work outside the plan, such as CI, dependency bumps or flaky-test fixes. It leaves the pull request out of the plan's units and tickets; a `Section:` line in the same body still places it on that section.
- `Ticket: C80 complete` (or `done`, `finished`) marks the ticket finished by this pull request.

The list of IDs ends at the first word that isn't one, so `Ticket: C80, the About page` names C80 alone. A line that names both `none` and an ID places the pull request on no unit, and the map says why.

## What wins

For the plan units and tickets a merged pull request belongs to, from most to least trusted:

1. An approved entry for the pull request in `mapping.json`.
2. Its own `Ticket:` or `Unit:` line.
3. A ticket or unit ID in its title or branch name.
4. A link to a unit's issue, as the unit table cites it.

An ID that appears only in the body's prose is shown beside the pull request as a candidate and never counted.

A `Section:` line places a pull request on a section directly, apart from that order: a `mapping.json` entry changes a merged pull request's units and tickets, not the section its own `Section:` line names. An open pull request is placed by its `Section:` line first, then by the tickets and units it names. `CONTRACT.md` has the full rules.

On a ticket-count map, issues also find their section through the config's `progress.placement` rules: a label, or the word before the colon in the title (`Checkout: card payments`). See [config.md](config.md).

## In an agent run log

The agents collector can read an optional log of agent runs ([config.md](config.md#agent-run-log)). A run's start line names its work the same way: `Ticket: C80`, `Section: checkout`. A later `TICKET` line for the same run replaces it, and the newest wins. An open pull request that states nothing can be placed where the run that worked on it sits, and is marked inferred.
