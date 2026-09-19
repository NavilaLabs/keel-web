import type { PermissionRequest, ServerEvent, ServerEventBody } from '@keel-web/protocol'
import { describe, expect, it } from 'vitest'
import { fold, heldPermissions } from './fold.ts'

function stream(...bodies: ServerEventBody[]): ServerEvent[] {
  return bodies.map((body, index) => ({ seq: index + 1, ticketId: '4', ...body }) as ServerEvent)
}

const request: PermissionRequest = {
  requestId: 'r1',
  toolName: 'Bash',
  input: { command: 'ls' },
}

describe('fold', () => {
  it('turns an empty stream into nothing', () => {
    expect(fold([])).toEqual([])
  })

  it('keeps messages in order and marks who spoke', () => {
    const items = fold(
      stream({ type: 'user.message', text: 'hello' }, { type: 'assistant.message', text: 'hi' }),
    )

    expect(items).toMatchObject([
      { kind: 'message', author: 'developer', text: 'hello' },
      { kind: 'message', author: 'agent', text: 'hi' },
    ])
  })

  it('drops the session start, which has nothing to show', () => {
    expect(fold(stream({ type: 'session.started', sessionId: 's1', resumed: false }))).toEqual([])
  })

  it('folds a tool call and its result into one item', () => {
    const items = fold(
      stream(
        { type: 'tool.started', toolUseId: 't1', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool.completed', toolUseId: 't1', ok: true, summary: 'a b c' },
      ),
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'tool',
      name: 'Bash',
      result: { ok: true, summary: 'a b c' },
    })
  })

  it('leaves a tool call without a result unfinished rather than hiding it', () => {
    const items = fold(stream({ type: 'tool.started', toolUseId: 't1', name: 'Bash', input: {} }))

    expect(items[0]).toMatchObject({ kind: 'tool', name: 'Bash' })
    expect(items[0]).not.toHaveProperty('result')
  })

  it('ignores a result for a call it never saw', () => {
    const items = fold(stream({ type: 'tool.completed', toolUseId: 'gone', ok: true, summary: '' }))

    expect(items).toEqual([])
  })

  it('folds a permission request and its answer into one item', () => {
    const items = fold(
      stream(
        { type: 'permission.requested', request },
        { type: 'permission.resolved', requestId: 'r1', decision: { decision: 'allow' } },
      ),
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'permission', decision: { decision: 'allow' } })
  })

  it('reports a request without an answer as still held', () => {
    const items = fold(stream({ type: 'permission.requested', request }))

    expect(heldPermissions(items)).toHaveLength(1)
  })

  it('reports an answered request as no longer held', () => {
    const items = fold(
      stream(
        { type: 'permission.requested', request },
        { type: 'permission.resolved', requestId: 'r1', decision: { decision: 'allow' } },
      ),
    )

    expect(heldPermissions(items)).toEqual([])
  })

  it('marks a lost login so the UI can say what to do', () => {
    const items = fold(
      stream({ type: 'session.failed', code: 'auth_required', message: 'run claude once' }),
    )

    expect(items[0]).toMatchObject({ kind: 'failure', authRequired: true })
  })

  it('folds a replay and a live stream identically', () => {
    const events = stream(
      { type: 'user.message', text: 'go' },
      { type: 'tool.started', toolUseId: 't1', name: 'Bash', input: {} },
      { type: 'permission.requested', request },
      { type: 'permission.resolved', requestId: 'r1', decision: { decision: 'allow' } },
      { type: 'tool.completed', toolUseId: 't1', ok: true, summary: 'done' },
      { type: 'assistant.message', text: 'there' },
    )

    const atOnce = fold(events)
    const oneByOne = events.reduce<ServerEvent[]>((seen, event) => [...seen, event], [])

    expect(fold(oneByOne)).toEqual(atOnce)
  })

  it('gives every item a key that survives growth', () => {
    const events = stream(
      { type: 'user.message', text: 'a' },
      { type: 'assistant.message', text: 'b' },
    )

    const first = fold(events.slice(0, 1))
    const second = fold(events)

    expect(second[0].key).toBe(first[0].key)
    expect(new Set(second.map((item) => item.key)).size).toBe(second.length)
  })
})
