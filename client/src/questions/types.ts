import type { PermissionDecision, Question } from '@keel-web/protocol'

/**
 * What the developer has settled on for one question.
 *
 * `other` is what they typed rather than picked. The agent is told not to
 * offer an option for it, because offering one is the client's job, so a
 * typed answer is an answer like any other and not a special case the agent
 * has to be told about.
 *
 * A question that allows one choice holds at most one label. One that allows
 * several holds them in the order they were chosen, which is the order they
 * are read back in.
 */
export interface Choice {
  labels: readonly string[]
  other?: string
}

/** What has been settled so far, keyed by the full question text. */
export type Chosen = Readonly<Record<string, Choice>>

/**
 * The answer to one question, as the agent reads it.
 *
 * Labels and typed text are joined by a comma and a space, in that order,
 * because that is the one shape the agent understands. Anything else is read
 * as no answer at all.
 */
export type AnswerOf = (choice: Choice) => string

/**
 * Whether every question has something to send.
 *
 * A question is answered when a label was picked or something was typed. An
 * empty typed answer does not count, so a question cannot be sent blank by
 * opening the text field and leaving it.
 */
export type IsComplete = (questions: readonly Question[], chosen: Chosen) => boolean

/**
 * Shows what the agent is asking and takes the answer.
 *
 * It is answered with the mouse alone. Every option is a target worth
 * clicking rather than a radio button with a label beside it, and a preview
 * is shown for the option under the pointer, because that is what a preview
 * is for.
 *
 * One question with a single choice is one card, and clicking an option sends
 * it: there is nothing left to confirm, and a confirmation step would be a
 * click asking whether the last click was meant.
 *
 * Several questions are shown one at a time, with a chip per question to move
 * between them, and a last step that lists every answer before it goes. A
 * question that allows several choices always ends in a step of its own,
 * because no single click can mean "and that is all of them".
 *
 * Declining sends a `deny` carrying whatever the developer wrote, which the
 * agent reads and may act on. It does not stop the turn: what the agent does
 * without an answer is the agent's to decide.
 */
export interface QuestionPromptProperties {
  questions: readonly Question[]
  /** True once an answer is on its way, so nothing is sent twice. */
  answering: boolean
  onAnswer: (decision: PermissionDecision) => void
}
