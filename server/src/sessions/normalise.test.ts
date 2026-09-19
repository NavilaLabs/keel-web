import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { deltaTextOf, normalise } from './normalise.js'

function assistant(content: unknown): SDKMessage {
  return { type: 'assistant', message: { content } } as unknown as SDKMessage
}

describe('normalise', () => {
  it('turns the init message into a started event carrying the session id', () => {
    const message = { type: 'system', subtype: 'init', session_id: 'abc' } as unknown as SDKMessage

    expect(normalise(message)).toEqual([
      { type: 'session.started', sessionId: 'abc', resumed: false },
    ])
  })

  it('splits an assistant message into one event per block', () => {
    const message = assistant([
      { type: 'text', text: 'hello' },
      { type: 'thinking', thinking: 'hmm' },
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
    ])

    expect(normalise(message)).toEqual([
      { type: 'assistant.message', text: 'hello' },
      { type: 'assistant.thinking', text: 'hmm' },
      { type: 'tool.started', toolUseId: 't1', name: 'Bash', input: { command: 'ls' } },
    ])
  })

  it('accepts string content as a single text block', () => {
    expect(normalise(assistant('plain'))).toEqual([{ type: 'assistant.message', text: 'plain' }])
  })

  it('drops empty text rather than recording a blank message', () => {
    expect(normalise(assistant([{ type: 'text', text: '' }]))).toEqual([])
  })

  it('reads a tool result, failed or not', () => {
    const message = {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'done' },
          { type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'boom' },
        ],
      },
    } as unknown as SDKMessage

    expect(normalise(message)).toEqual([
      { type: 'tool.completed', toolUseId: 't1', ok: true, summary: 'done' },
      { type: 'tool.completed', toolUseId: 't2', ok: false, summary: 'boom' },
    ])
  })

  it('reads a tool result made of text blocks', () => {
    const message = {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'ok' }] },
        ],
      },
    } as unknown as SDKMessage

    expect(normalise(message)[0]).toMatchObject({ summary: 'ok' })
  })

  it('reports a successful result as idle', () => {
    const message = {
      type: 'result',
      subtype: 'success',
      num_turns: 3,
      total_cost_usd: 0.12,
    } as unknown as SDKMessage

    expect(normalise(message)).toEqual([{ type: 'session.idle', turns: 3, costUsd: 0.12 }])
  })

  it('reports any other result as a failure', () => {
    const message = { type: 'result', subtype: 'error_max_turns' } as unknown as SDKMessage

    expect(normalise(message)[0]).toMatchObject({ type: 'session.failed', code: 'agent_error' })
  })

  it('ignores message kinds the transcript has no use for', () => {
    expect(normalise({ type: 'status' } as unknown as SDKMessage)).toEqual([])
  })
})

describe('deltaTextOf', () => {
  it('reads token text from a partial message', () => {
    const message = {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
    } as unknown as SDKMessage

    expect(deltaTextOf(message)).toBe('hi')
  })

  it('ignores a non-text delta', () => {
    const message = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{' },
      },
    } as unknown as SDKMessage

    expect(deltaTextOf(message)).toBeUndefined()
  })

  it('ignores anything that is not a partial message', () => {
    expect(deltaTextOf(assistant([]))).toBeUndefined()
  })
})
