import type { PermissionDecision, PermissionRequest, RequestId } from '@keel-web/protocol'

/**
 * Holds a tool call of one session until the browser answers.
 *
 * It sees the calls the session's mode leaves to the developer, which is
 * every call only while the session runs in its default mode. What another
 * mode settles in advance never reaches here, and is therefore neither held
 * nor recorded as an answer.
 *
 * There is no timeout: an unanswered call keeps its turn paused for as long
 * as the session lives. This is deliberate, so silence is never recorded as
 * a refusal.
 */
export interface PermissionGate {
  /**
   * Blocks until the call is answered, the signal aborts, or the gate closes.
   *
   * Never throws and never resolves on its own: on abort or close it resolves
   * as a deny, so the caller always has a decision to hand back.
   */
  hold(request: PermissionRequest, signal: AbortSignal): Promise<PermissionDecision>

  /**
   * Answers a held call.
   *
   * Idempotent per request: the first answer wins and every later one returns
   * false, as does an unknown `requestId`.
   */
  answer(requestId: RequestId, decision: PermissionDecision): boolean

  /**
   * What is waiting right now, oldest first.
   *
   * This is what a reattaching viewer must be shown. Empty after `close`, and
   * empty after a process restart, since nothing here is persisted.
   */
  pending(): readonly PermissionRequest[]

  /** Resolves everything still held as a deny. Idempotent. */
  close(): void
}

export type CreatePermissionGate = () => PermissionGate
