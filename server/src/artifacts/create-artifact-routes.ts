import { Hono } from 'hono'
import type { ArtifactKind, ArtifactRef } from '@keel-web/protocol'
import type { LoggerVariables } from '../logging/types.js'
import {
  ArtifactOutsideWorkspaceError,
  UnreadableArtifactError,
  type CreateArtifactRoutes,
} from './types.js'

const fileKinds = new Set<ArtifactKind>(['knowledge', 'adr', 'document', 'c4Source', 'file'])

/**
 * The reference out of the query, or nothing when it does not describe one.
 *
 * A stub is the only kind read from the code repository, and a view is not
 * read here at all, so both are decided by the kind rather than trusted from
 * the request.
 */
function refOf(query: Record<string, string | undefined>): ArtifactRef | undefined {
  const kind = query.kind as ArtifactKind | undefined
  const path = query.path
  if (kind === undefined || path === undefined || path === '') return undefined

  if (fileKinds.has(kind)) {
    return { kind, repository: 'ticket', path } as ArtifactRef
  }
  if (kind === 'stub') {
    return { kind, repository: 'code', path, ...(query.symbol && { symbol: query.symbol }) }
  }
  return undefined
}

export const createArtifactRoutes: CreateArtifactRoutes = ({ artifacts, workspaces }) => {
  const routes = new Hono<{ Variables: LoggerVariables }>()

  const base = '/workspaces/:workspaceId/tickets/:ticketId/artifacts'

  routes.get(base, async (context) => {
    const workspace = workspaces.find(context.req.param('workspaceId'))
    if (!workspace) {
      return context.json({ reason: 'That workspace is not one keel-web knows.' }, 404)
    }

    const tree = await artifacts.tree(workspace, context.req.param('ticketId'))
    return context.json(tree)
  })

  routes.get(`${base}/content`, async (context) => {
    const workspace = workspaces.find(context.req.param('workspaceId'))
    if (!workspace) {
      return context.json({ reason: 'That workspace is not one keel-web knows.' }, 404)
    }

    const ref = refOf(context.req.query())
    if (!ref) {
      return context.json({ reason: 'That request does not name an artefact.' }, 400)
    }

    try {
      const content = await artifacts.read(workspace, context.req.param('ticketId'), ref)

      // The body is the artefact and the tag identifies it, so a viewer that
      // already holds it is told so rather than sent it again.
      if (context.req.header('if-none-match') === content.etag) {
        context.header('ETag', content.etag)
        return context.body(null, 304)
      }

      context.header('ETag', content.etag)
      return context.json(content)
    } catch (error) {
      if (error instanceof ArtifactOutsideWorkspaceError) {
        return context.json({ reason: error.message }, 400)
      }
      if (error instanceof UnreadableArtifactError) {
        return context.json({ reason: error.message }, 404)
      }
      throw error
    }
  })

  return routes
}
