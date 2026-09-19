import type { Route, Router, Unsubscribe } from './types.ts'

const ticketPath = /^\/tickets\/([^/]+)$/

function parse(pathname: string): Route {
  const match = ticketPath.exec(pathname)
  const ticketId = match?.[1]
  return ticketId === undefined ? { view: 'none' } : { ticketId, view: 'none' }
}

function toPath(route: Route): string {
  return route.ticketId === undefined ? '/' : `/tickets/${encodeURIComponent(route.ticketId)}`
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
