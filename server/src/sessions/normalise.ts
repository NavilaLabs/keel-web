import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ServerEventBody } from '@keel-web/protocol'

interface TextBlock {
  type: 'text'
  text: string
}

interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}

interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input?: Record<string, unknown>
}

interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  is_error?: boolean
  content?: unknown
}

type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock | { type: string }

function blocksOf(message: unknown): ContentBlock[] {
  const content = (message as { message?: { content?: unknown } } | undefined)?.message?.content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return Array.isArray(content) ? (content as ContentBlock[]) : []
}

function summarise(block: ToolResultBlock): string {
  const { content } = block
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .filter((part): part is TextBlock => (part as TextBlock).type === 'text')
      .map((part) => part.text)
      .join('')
    if (text.length > 0) return text
  }
  return ''
}

/**
 * Maps one SDK message onto the events that belong in the transcript.
 *
 * Message kinds the UI has no use for map to no events at all, so the
 * transcript stays a record of the conversation rather than of the protocol.
 */
export function normalise(message: SDKMessage): ServerEventBody[] {
  if (message.type === 'system' && message.subtype === 'init') {
    return [{ type: 'session.started', sessionId: message.session_id, resumed: false }]
  }

  if (message.type === 'assistant') {
    const events: ServerEventBody[] = []
    for (const block of blocksOf(message)) {
      if (block.type === 'text' && (block as TextBlock).text.length > 0) {
        events.push({ type: 'assistant.message', text: (block as TextBlock).text })
      } else if (block.type === 'thinking') {
        events.push({ type: 'assistant.thinking', text: (block as ThinkingBlock).thinking })
      } else if (block.type === 'tool_use') {
        const tool = block as ToolUseBlock
        events.push({
          type: 'tool.started',
          toolUseId: tool.id,
          name: tool.name,
          input: tool.input ?? {},
        })
      }
    }
    return events
  }

  if (message.type === 'user') {
    return blocksOf(message)
      .filter((block): block is ToolResultBlock => block.type === 'tool_result')
      .map((block) => ({
        type: 'tool.completed' as const,
        toolUseId: block.tool_use_id,
        ok: block.is_error !== true,
        summary: summarise(block),
      }))
  }

  if (message.type === 'result') {
    if (message.subtype === 'success') {
      return [
        {
          type: 'session.idle',
          turns: message.num_turns,
          costUsd: message.total_cost_usd,
        },
      ]
    }
    return [
      {
        type: 'session.failed',
        code: 'agent_error',
        message: `The agent stopped: ${message.subtype}.`,
      },
    ]
  }

  return []
}

/** Token-level text from a partial message, or undefined for anything else. */
export function deltaTextOf(message: SDKMessage): string | undefined {
  if (message.type !== 'stream_event') return undefined
  const event = message.event as { type?: string; delta?: { type?: string; text?: string } }
  if (event.type !== 'content_block_delta') return undefined
  if (event.delta?.type !== 'text_delta') return undefined
  return event.delta.text
}
