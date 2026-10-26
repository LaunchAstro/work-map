# Build units: Acme Garden Planner

An invented build plan for the made-up `example-org/example-app`, kept as a test fixture. Each build unit is a piece of work of a few days that absorbs one or more roadmap tickets. Nothing here describes a real project.

## What this is

The plan groups the planner's tickets into fourteen units. The diagram (the flow file beside this one) puts each unit in one box, and the audit (the completion file) says how far each one is built.

| Unit | Title      | What it covers               | Tickets absorbed | Components owned | Days |
| ---- | ---------- | ---------------------------- | ---------------- | ---------------- | ---- |
| U90  | Old sketch | a draft row, not in the plan | OLD-1            | none             | 2    |

## The numbers

Fourteen units, 89 estimate-days in all. Sizes are estimate-days (S 1, M 3, L 6).

## Shared parts and who builds them

| Part       | Built by | Used by       |
| ---------- | -------- | ------------- |
| Bed canvas | U06      | U07, U09, U13 |
| Plant card | U08      | U06, U13      |

## Slices

Slice table rows are not unit rows: SL01 builds U06 (#31) and SL02 builds U08 (#32).

| Slice | Units    | Days |
| ----- | -------- | ---- |
| SL01  | U06, U07 | 17   |
| SL02  | U08      | 12   |

## Units by wave

The waves below hold every unit row. A unit row has six columns; anything else in this section is prose.

### Wave 0: the foundation

The design kit comes first, then sign-in (U03 (#33)), so every later screen has a frame and a signed-in user.

| Unit | Title                  | What it covers                    | Tickets absorbed                   | Components owned | Days |
| ---- | ---------------------- | --------------------------------- | ---------------------------------- | ---------------- | ---- |
| U01  | Design kit             | colours, type and the kit         | KIT-1, KIT-2 and KIT-3             | shared: kit      | 8    |
| U02  | App frame              | sidebar, header and narrow layout | FR-1, FR-2-1                       | frame            | 5    |
| U03  | Sign-in and households | sign-in, households and roles     | AU-1, AU-2 (households only), AU-4 | shared: session  | 9    |
| U04  | Test suite and checks  | unit tests and the checks         | CI-1 and CI-2                      | none             | 4    |
| U05  | Hosting and backups    | practice copy, live copy, backups | OPS-1, OPS-2, OPS-3                | none             | 6    |

### Wave 1: planning

Beds come before tasks because a task belongs to a bed.

| Unit | Title          | What it covers               | Tickets absorbed                        | Components owned   | Days |
| ---- | -------------- | ---------------------------- | --------------------------------------- | ------------------ | ---- |
| U06  | Draw beds      | beds drawn to scale          | BED-1, BED-2 (no curved edges: "later") | shared: bed canvas | 10   |
| U07  | Rows and moves | rows in a bed, moving beds   | BED-3, BED-4-2                          | none               | 7    |
| U08  | Plant library  | plants, spacing, sun, season | PL-1, PL-2 and PL-5                     | shared: plant card | 12   |
| U09  | Garden tasks   | sowing, watering, harvest    | TK-1, TK-2                              | task list          | 6    |
| U10  | Reminders      | reminder settings and sends  | TK-3                                    | none               | 3    |

### Wave 2: sharing

| Unit | Title             | What it covers                 | Tickets absorbed  | Components owned | Days |
| ---- | ----------------- | ------------------------------ | ----------------- | ---------------- | ---- |
| U11  | Invites and roles | invite a neighbour, give roles | MB-1, MB-2        | none             | 5    |
| U12  | Garden chat       | messages on a bed or a task    | CH-1              | none             | 4    |
| U13  | Season calendar   | sow and harvest dates          | CAL-1, CAL-2      | calendar         | 8    |
| U14  | Site fixes        | public site and sign-up page   | SITE-1 and SITE-2 | none             | 2    |

A second row for a unit adds its tickets to the first: U09 also takes the watering rule below.

| Unit | Title        | What it covers | Tickets absorbed | Components owned | Days |
| ---- | ------------ | -------------- | ---------------- | ---------------- | ---- |
| U09  | Garden tasks | watering rule  | TK-2, TK-5       | task list        | 0    |

## Stage reviews

Rows here are not unit rows, even when they look like one.

| U01 | not a unit row | x | KIT-9 | y | 1 |

## Outside prerequisites, by unit

| Unit | Needs                    |
| ---- | ------------------------ |
| U05  | a hosting account        |
| U13  | a frost-date data source |

## Change history

### What changed at the first review

U07 split from U06 so rows can land after beds. U14 added for two site fixes.
