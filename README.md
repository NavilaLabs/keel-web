# keel-web

A web UI for [keel](https://github.com/NavilaLabs/keel). It lets you chat with Claude Code in the browser and view the tickets, pull requests and LikeC4 diagrams keel is working on, along with the keel phase each ticket is in. The ticket, pull request and diagram views are read-only; changes always go through Claude Code.

## Development

keel-web runs on the machine you work on, beside the Claude Code it drives. The
agent is a child of the server process, so it runs as you, sees your
repositories and uses the login you already have. Nothing is mounted, nothing
is containerised, and there is no second Claude identity to keep logged in.

You need Node 22 and a Claude Code login (`claude` once in a terminal, or any
of the other ways Claude Code accepts a credential). keel-web never checks for
one itself: it starts the agent and reports what the agent says.

Keel keeps its ticket artifacts in a separate repository (`keel-web-tickets`).
Clone it next to this one; each workspace's `.claude/keel.json` says where its
own ticket repository is.

```sh
npm install
npm run dev
```

The client (Vite + React) runs on http://localhost:5173 and proxies `/api` to
the server (Hono on Node) on port 3000. Both listen on this machine only:
reaching the server means reaching an agent that acts as you.

## Tooling

Everything runs on the host:

```sh
npm run lint
npm run format
npm test
```

Enable the git hook once with `git config core.hooksPath .githooks`. It runs
lint and the format check before a commit, which is what CI runs too.

`compose.yaml` is left for one job: running the test suite in a fixed
environment, with no Claude login and no ports. Its dependencies live in named
volumes, so install them once:

```sh
docker compose run --rm -u root test sh scripts/setup-container.sh
docker compose run --rm test
```
