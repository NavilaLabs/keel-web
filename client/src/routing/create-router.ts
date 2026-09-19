import type { Route, Router, Unsubscribe } from './types.ts'

const workspaceTicket = /^\/workspaces\/([^/]+)(?:\/tickets\/([^/]+))?$/

function parse(pathname: string): Route {
  const match = workspaceTicket.exec(pathname)
  const workspaceId = match?.[1]
  if (workspaceId === undefined) return { view: 'none' }
  const ticketId = match?.[2]
  return ticketId === undefined
    ? { workspaceId, view: 'none' }
    : { workspaceId, ticketId, view: 'none' }
}

function toPath(route: Route): string {
  if (route.workspaceId === undefined) return '/'
  const workspace = `/workspaces/${encodeURIComponent(route.workspaceId)}`
  return route.ticketId === undefined
    ? workspace
    : `${workspace}/tickets/${encodeURIComponent(route.ticketId)}`
}

export function createRouter(): Router {
  return {
    current() {
      return parse(globalThis.location.pathname)
    },

    navigate(route) {
      const path = toPath(route)
      if (path === globalThis.location.pathname) return
      globalThis.history.pushState(null, '', path)
    },

    subscribe(listener): Unsubscribe {
      globalThis.addEventListener('popstate', listener)
      return () => {
        globalThis.removeEventListener('popstate', listener)
      }
    },
  }
}
