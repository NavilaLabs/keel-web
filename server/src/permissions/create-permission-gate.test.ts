import { describe, expect, it } from 'vitest'
import type { PermissionRequest } from '@keel-web/protocol'
import { createPermissionGate } from './create-permission-gate.js'

const request: PermissionRequest = {
  requestId: 'r1',
  toolName: 'Bash',
  input: { command: 'ls' },
}

describe('permission gate', () => {
  it('holds a call until it is answered', async () => {
    const gate = createPermissionGate()
    const held = gate.hold(request, new AbortController().signal)

    expect(gate.pending()).toEqual([request])

    gate.answer('r1', { decision: 'allow' })

    await expect(held).resolves.toEqual({ decision: 'allow' })
    expect(gate.pending()).toEqual([])
  })

  it('lets the first answer win', async () => {
    const gate = createPermissionGate()
    const held = gate.hold(request, new AbortController().signal)

    expect(gate.answer('r1', { decision: 'allow' })).toBe(true)
    expect(gate.answer('r1', { decision: 'deny', message: 'no' })).toBe(false)

    await expect(held).resolves.toEqual({ decision: 'allow' })
  })

  it('reports an unknown request rather than throwing', () => {
    expect(createPermissionGate().answer('missing', { decision: 'allow' })).toBe(false)
  })

  it('denies on abort instead of staying pending', async () => {
    const gate = createPermissionGate()
    const aborter = new AbortController()
    const held = gate.hold(request, aborter.signal)

    aborter.abort()

    await expect(held).resolves.toMatchObject({ decision: 'deny' })
    expect(gate.pending()).toEqual([])
  })

  it('denies a call that is already aborted', async () => {
    const aborter = new AbortController()
    aborter.abort()

    await expect(createPermissionGate().hold(request, aborter.signal)).resolves.toMatchObject({
      decision: 'deny',
    })
  })

  it('denies everything still held when it closes, and stays closed', async () => {
    const gate = createPermissionGate()
    const held = gate.hold(request, new AbortController().signal)

    gate.close()
    gate.close()

    await expect(held).resolves.toMatchObject({ decision: 'deny' })
    await expect(
      gate.hold({ ...request, requestId: 'r2' }, new AbortController().signal),
    ).resolves.toMatchObject({ decision: 'deny' })
  })

  it('carries structured answers back unchanged', async () => {
    const gate = createPermissionGate()
    const ask: PermissionRequest = {
      requestId: 'r3',
      toolName: 'AskUserQuestion',
      input: {},
      questions: [{ question: 'Which?', header: 'Pick', multiSelect: false, options: [] }],
    }
    const held = gate.hold(ask, new AbortController().signal)

    gate.answer('r3', { decision: 'answers', answers: { Which: ['A'] } })

    await expect(held).resolves.toEqual({ decision: 'answers', answers: { Which: ['A'] } })
  })
})
