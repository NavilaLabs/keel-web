import type { PermissionDecision, Question } from '@keel-web/protocol'
import type { AnswerOf, Chosen, IsComplete } from './types.ts'

export const answerOf: AnswerOf = (choice) => {
  const typed = choice.other?.trim() ?? ''
  return [...choice.labels, ...(typed === '' ? [] : [typed])].join(', ')
}

export const isComplete: IsComplete = (questions, chosen) =>
  questions.every((question) => answerOf(chosen[question.question] ?? { labels: [] }) !== '')

/** The decision the agent reads, keyed by the full question text. */
export function decisionOf(questions: readonly Question[], chosen: Chosen): PermissionDecision {
  const answers: Record<string, string> = {}
  for (const question of questions) {
    answers[question.question] = answerOf(chosen[question.question] ?? { labels: [] })
  }
  return { decision: 'answers', answers }
}

/**
 * What picking a label leaves the question at.
 *
 * A question that allows one choice replaces what was picked, and picking the
 * same label again leaves it picked rather than clearing it: a single-choice
 * question has no empty state to go back to once it has been answered.
 */
export function withLabel(chosen: Chosen, question: Question, label: string): Chosen {
  const current = chosen[question.question] ?? { labels: [] }
  if (!question.multiSelect)
    return { ...chosen, [question.question]: { ...current, labels: [label] } }

  const labels = current.labels.includes(label)
    ? current.labels.filter((picked) => picked !== label)
    : [...current.labels, label]
  return { ...chosen, [question.question]: { ...current, labels } }
}

export function withOther(chosen: Chosen, question: Question, other: string): Chosen {
  const current = chosen[question.question] ?? { labels: [] }
  return { ...chosen, [question.question]: { ...current, other } }
}

/**
 * Whether clicking an option is the whole answer.
 *
 * Only when there is one question, it takes one choice, and nothing has been
 * typed beside it: anything else leaves something the developer still has to
 * say they are done with.
 */
export function sendsOnClick(questions: readonly Question[], chosen: Chosen): boolean {
  const only = questions[0]
  if (questions.length !== 1 || only === undefined || only.multiSelect) return false
  return (chosen[only.question]?.other ?? '') === ''
}
