# keel-web

A web UI for [keel](https://github.com/NavilaLabs/keel). It lets you chat with Claude Code in the browser and view the tickets, pull requests and LikeC4 diagrams keel is working on, along with the keel phase each ticket is in. The ticket, pull request and diagram views are read-only; changes always go through Claude Code.

## Development

Keel keeps its ticket artifacts in a separate repository (`keel-web-tickets`). Clone it next to this one and point `KEEL_TICKET_REPO` at it on the host, for example `export KEEL_TICKET_REPO=$HOME/projects/keel-web-tickets`. The devcontainer mounts it at `~/projects/keel-web-tickets`, where keel expects it, and refuses to start if the variable is unset or the directory is missing.

Open the repository in the devcontainer (VS Code "Reopen in Container" or `devcontainer up`). On first start, run `claude` inside the container once to log in; the login is kept in a named volume.

```sh
npm run dev
```

The client (Vite + React) runs on http://localhost:5173 and proxies `/api` to the server (Hono on Node) on port 3000.
