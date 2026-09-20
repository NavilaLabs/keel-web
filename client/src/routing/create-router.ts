import type { ArtifactRef } from '@keel-web/protocol'
import type { Route, Router, Unsubscribe } from './types.ts'

const workspaceTicket = /^\/workspaces\/([^/]+)(?:\/tickets\/([^/]+))?$/

const fileKinds = ['knowledge', 'adr', 'document', 'c4Source', 'file'] as const

type FileKind = (typeof fileKinds)[number]

function isFileKind(kind: string): kind is FileKind {
  return (fileKinds as readonly string[]).includes(kind)
}

/**
 * The artefact out of the query, or nothing when it is incomplete.
 *
 * A mangled link should land on the ticket rather than on an error, so every
 * failure here is silent and yields no artefact.
 */
function artifactOf(search: string): ArtifactRef | undefined {
  const query = new URLSearchParams(search)
  const kind = query.get('kind')
  if (kind === null) return undefined

  if (kind === 'c4View') {
    const view = query.get('view')
    if (view === null || view === '') return undefined
    const branch = query.get('branch')
    return { kind, view, ...(branch && { branch }) }
  }

  const path = query.get('path')
  if (path === null || path === '') return undefined
  if (kind === 'stub') {
    const symbol = query.get('symbol')
    return { kind, repository: 'code', path, ...(symbol && { symbol }) }
  }
  if (isFileKind(kind)) return { kind, repository: 'ticket', path }
  return undefined
}

function toQuery(artifact: ArtifactRef): string {
  const query = new URLSearchParams({ kind: artifact.kind })
  if (artifact.kind === 'c4View') {
    query.set('view', artifact.view)
    if (artifact.branch) query.set('branch', artifact.branch)
  } else {
    query.set('path', artifact.path)
    if (artifact.kind === 'stub' && artifact.symbol) query.set('symbol', artifact.symbol)
  }
  return `?${query.toString()}`
}

function parse(pathname: string, search: string): Route {
  const match = workspaceTicket.exec(pathname)
  const workspaceId = match?.[1]
  if (workspaceId === undefined) return { view: 'none' }

  const ticketId = match?.[2]
  if (ticketId === undefined) return { workspaceId, view: 'none' }

  const artifact = artifactOf(search)
  return artifact === undefined
    ? { workspaceId, ticketId, view: 'none' }
    : { workspaceId, ticketId, view: 'artifact', artifact }
}

function toPath(route: Route): string {
  if (route.workspaceId === undefined) return '/'
  const workspace = `/workspaces/${encodeURIComponent(route.workspaceId)}`
  if (route.ticketId === undefined) return workspace

  const ticket = `${workspace}/tickets/${encodeURIComponent(route.ticketId)}`
  return route.view === 'artifact' && route.artifact
    ? `${ticket}${toQuery(route.artifact)}`
    : ticket
}

export function createRouter(): Router {
  return {
    current() {
      return parse(globalThis.location.pathname, globalThis.location.search)
    },

    navigate(route) {
      const path = toPath(route)
      if (path === globalThis.location.pathname + globalThis.location.search) return
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
