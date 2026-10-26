# Kettle: the example project

Kettle is a made-up online tea shop. Every name, ticket and pull request here is invented. It shows what a project needs to give the work map, and it runs with no GitHub login and no network.

```sh
pnpm install --frozen-lockfile
pnpm build
sh examples/demo/run.sh
```

Then open `http://127.0.0.1:4317`. Set `WORK_MAP_PORT` for another port.

## What is here

- `roadmap/`: what a project keeps in its own roadmap repository.
  - `project.json`: the config. It names the repositories, the files below, the ticket labels, and how tickets find their section: here, by the word before the colon in a ticket's title (`progress.placement`).
  - `flow.json`: the diagram. Stages are columns; each node is a section card, placed by `stage` and `row`. Wires join cards.
  - `section-map.json`: which source paths each section owns. The map uses it to find files no section owns.
  - `audit.json`, `units.md` and `mapping.json`: empty here. Kettle counts tickets, so it has no weighted units.
- `seed.ts`: writes a made-up GitHub read (`github-cache.json` and `work-cache.json`) into the data folder, with times counting back from now. A real map reads these from GitHub (`generate.ts github`).
- `run.sh`: seeds the data folder (default `.data/demo`), builds `snapshot.json` from it with `generate.ts snapshot`, and starts the server. The server gets no project to refresh from, so its Sync button reads nothing from GitHub.

To make your own map, copy `roadmap/` into your project's roadmap repository, then change the repositories, labels, diagram and sections.
