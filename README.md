# keel-web

A web UI for [keel](https://github.com/NavilaLabs/keel). It lets you chat with Claude Code in the browser and view the tickets, pull requests and LikeC4 diagrams keel is working on, along with the keel phase each ticket is in. The ticket, pull request and diagram views are read-only; changes always go through Claude Code.

## Development

Open the repository in the devcontainer (VS Code "Reopen in Container" or `devcontainer up`). On first start, run `claude` inside the container once to log in; the login is kept in a named volume.

```sh
npm run dev
```

The client (Vite + React) runs on http://localhost:5173 and proxies `/api` to the server (Hono on Node) on port 3000.
