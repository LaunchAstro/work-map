# Notes app build plan

The units below are the plan. Each has a roadmap issue where one exists: U01 (#40), U04 (#41).

## Background

This table is not read, because it sits outside the "Units by wave" section.

| Unit | Title    | What it covers | Tickets absorbed | Components owned | Days |
| ---- | -------- | -------------- | ---------------- | ---------------- | ---- |
| U99  | Not read | an older draft | X-1              | none             | 1    |

## Units by wave

### Wave 1

| Unit | Title       | What it covers        | Tickets absorbed                  | Components owned | Days |
| ---- | ----------- | --------------------- | --------------------------------- | ---------------- | ---- |
| U01  | Sign-in     | sign-up and sign-in   | AC-1, AC-2 and AC-3               | src/accounts     | 4    |
| U02  | Local store | notes on the device   | ST-1 (write-ahead log first), ST-2 | src/storage      | 6    |
| U03  | Sync        | notes across devices  | ST-3                              | src/storage      | 8    |

### Wave 2

| Unit | Title       | What it covers        | Tickets absorbed | Components owned | Days |
| ---- | ----------- | --------------------- | ---------------- | ---------------- | ---- |
| U04  | Editor      | writing a note        | ED-1, ED-2, ED-3 | src/editor       | 10   |
| U05  | Share links | read-only share links | SH-1, SH-2       | src/sharing      | 5    |
| U06  | Guide       | getting started       | DO-1             | docs             | 1    |
| U07  | First tag   | the first release     | RE-1             | .github          | 2    |

## Later

| Unit | Title          | What it covers | Tickets absorbed | Components owned | Days |
| ---- | -------------- | -------------- | ---------------- | ---------------- | ---- |
| U08  | Not read either | parked        | LA-1             | none             | 1    |
