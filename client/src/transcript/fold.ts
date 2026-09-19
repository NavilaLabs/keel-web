import type { Fold, RenderItem } from './types.ts'

export const fold: Fold = (events) => {
  const items: RenderItem[] = []
  const toolAt = new Map<string, number>()
  const permissionAt = new Map<string, number>()

  for (const event of events) {
    const key = `e${event.seq}`

    switch (event.type) {
      case 'user.message':
        items.push({ kind: 'message', key, author: 'developer', text: event.text })
        break

      case 'assistant.message':
        items.push({ kind: 'message', key, author: 'agent', text: event.text })
        break

      case 'assistant.thinking':
        items.push({ kind: 'thinking', key, text: event.text })
        break

      case 'tool.started':
        toolAt.set(event.toolUseId, items.length)
        items.push({ kind: 'tool', key, name: event.name, input: event.input })
        break

      case 'tool.completed': {
        const index = toolAt.get(event.toolUseId)
        if (index === undefined) break
        const started = items[index]
        if (started?.kind !== 'tool') break
        items[index] = { ...started, result: { ok: event.ok, summary: event.summary } }
        break
      }

      case 'permission.requested':
        permissionAt.set(event.request.requestId, items.length)
        items.push({ kind: 'permission', key, request: event.request })
        break

      case 'permission.resolved': {
        const index = permissionAt.get(event.requestId)
        if (index === undefined) break
        const requested = items[index]
        if (requested?.kind !== 'permission') break
        items[index] = { ...requested, decision: event.decision }
        break
      }

      case 'session.failed':
        items.push({
          kind: 'failure',
          key,
          text: event.message,
          authRequired: event.code === 'auth_required',
        })
        break

      case 'session.idle':
        items.push({ kind: 'idle', key, turns: event.turns, costUsd: event.costUsd })
        break

      case 'session.started':
        break
    }
  }

  return items
}

/** Tool calls still waiting for an answer, oldest first. */
export function heldPermissions(items: readonly RenderItem[]): RenderItem[] {
  return items.filter((item) => item.kind === 'permission' && item.decision === undefined)
}
