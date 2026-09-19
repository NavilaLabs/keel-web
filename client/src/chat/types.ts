import type { PermissionDecision, PermissionRequest } from '@keel-web/protocol'
import type { RenderItem } from '../transcript/types.ts'

export interface TranscriptProperties {
  items: readonly RenderItem[]
  /** Rendered as plain text below the transcript, empty when nothing is streaming. */
  draft: string
  onAnswer: (requestId: string, decision: PermissionDecision) => void
}

/**
 * Renders a held tool call so it can be answered rather than merely seen.
 *
 * The input is shown in full: a command is never truncated, a file path is
 * shown relative to the repository root and flagged when it points outside.
 * `request.questions` is present exactly for `AskUserQuestion`, and then the
 * answer must be the `answers` decision rather than allow or deny.
 *
 * Denying opens a reason field first, because the message reaches the agent
 * and an empty one is a worse answer than a reason.
 */
export interface PermissionPromptProperties {
  request: PermissionRequest
  /** Set while an answer is in flight, so the form is disabled but still visible. */
  answering: boolean
  onAnswer: (decision: PermissionDecision) => void
}
