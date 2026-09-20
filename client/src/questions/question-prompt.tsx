import type { PermissionDecision, Question } from '@keel-web/protocol'
import { useState } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { answerOf, decisionOf, isComplete, sendsOnClick, withLabel, withOther } from './answer.ts'
import type { Chosen, QuestionPromptProperties } from './types.ts'

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="hold-arrive w-full border-l-[3px] border-hold-edge bg-hold-fill py-3 pr-3 pl-4">
      {children}
    </section>
  )
}

/**
 * One option, as a whole target rather than a control with a label beside it.
 *
 * The preview belongs to the option under the pointer, which is what the
 * agent means by rendering it when the option is focused.
 */
function Option({
  option,
  picked,
  disabled,
  onPick,
}: {
  option: Question['options'][number]
  picked: boolean
  disabled: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={picked}
      disabled={disabled}
      onClick={onPick}
      className={`group block w-full rounded-sm border px-3 py-2 text-left text-[13px] focus-visible:ring-1 focus-visible:ring-hold focus-visible:outline-none ${
        picked ? 'border-hold-edge bg-hold/10' : 'border-border hover:border-hold-edge'
      }`}
    >
      <span className="block text-[15px] text-foreground">{option.label}</span>
      <span className="block text-muted-foreground">{option.description}</span>
      {option.preview !== undefined && (
        <pre className="mt-2 hidden overflow-x-auto bg-code p-2 font-mono text-[12px] group-hover:block group-focus-visible:block">
          {option.preview}
        </pre>
      )}
    </button>
  )
}

function Chip({
  question,
  state,
  onGo,
}: {
  question: Question
  state: 'current' | 'answered' | 'open'
  onGo: () => void
}) {
  const tone =
    state === 'current'
      ? 'border-hold-edge text-foreground'
      : state === 'answered'
        ? 'border-border text-muted-foreground'
        : 'border-dashed border-border text-muted-foreground'
  return (
    <button
      type="button"
      onClick={onGo}
      className={`rounded-sm border px-2 py-0.5 text-[12px] hover:text-foreground focus-visible:outline-none ${tone}`}
    >
      {question.header}
    </button>
  )
}

export function QuestionPrompt({ questions, answering, onAnswer }: QuestionPromptProperties) {
  const [chosen, setChosen] = useState<Chosen>({})
  // One past the last question is the step that shows every answer before it
  // goes. A single question never reaches it.
  const [at, setAt] = useState(0)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')

  const send = (decision: PermissionDecision) => {
    if (answering) return
    onAnswer(decision)
  }

  const pick = (question: Question, label: string) => {
    const next = withLabel(chosen, question, label)
    setChosen(next)
    if (sendsOnClick(questions, next)) send(decisionOf(questions, next))
  }

  if (declining) {
    return (
      <Frame>
        <div className="flex flex-col gap-2">
          <label className="text-[13px] text-muted-foreground" htmlFor="decline-reason">
            Claude Code reads this and carries on without an answer.
          </label>
          <textarea
            id="decline-reason"
            autoFocus
            rows={2}
            value={reason}
            disabled={answering}
            placeholder="Why not, or what to do instead"
            onChange={(changed) => setReason(changed.target.value)}
            className="resize-none rounded-sm border border-input bg-background p-2 font-mono text-[13px] focus-visible:ring-1 focus-visible:ring-hold focus-visible:outline-none"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={answering}
              onClick={() => send({ decision: 'deny', message: reason })}
            >
              Send
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={answering}
              onClick={() => setDeclining(false)}
            >
              Back
            </Button>
          </div>
        </div>
      </Frame>
    )
  }

  const reviewing = at >= questions.length
  const question = questions[at]
  // Still walking through the questions, so the button moves on rather than
  // sends. The last step of the walk is the review, where it sends.
  const walking = !reviewing && questions.length > 1
  const unanswered =
    question !== undefined && answerOf(chosen[question.question] ?? { labels: [] }) === ''

  return (
    <Frame>
      <div className="flex flex-col gap-4">
        {questions.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {questions.map((candidate, index) => (
              <Chip
                key={candidate.question}
                question={candidate}
                state={
                  index === at
                    ? 'current'
                    : answerOf(chosen[candidate.question] ?? { labels: [] }) === ''
                      ? 'open'
                      : 'answered'
                }
                onGo={() => setAt(index)}
              />
            ))}
          </div>
        )}

        {reviewing ? (
          <div className="flex flex-col gap-3">
            {questions.map((candidate, index) => (
              <div key={candidate.question}>
                <p className="text-[13px] text-muted-foreground">{candidate.question}</p>
                <button
                  type="button"
                  onClick={() => setAt(index)}
                  className="text-left text-[15px] text-foreground hover:underline focus-visible:outline-none"
                >
                  {answerOf(chosen[candidate.question] ?? { labels: [] }) || 'Not answered yet'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          question !== undefined && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-[15px] text-foreground">{question.question}</legend>
              {question.options.map((option) => (
                <Option
                  key={option.label}
                  option={option}
                  picked={(chosen[question.question]?.labels ?? []).includes(option.label)}
                  disabled={answering}
                  onPick={() => pick(question, option.label)}
                />
              ))}
              <input
                value={chosen[question.question]?.other ?? ''}
                disabled={answering}
                placeholder="Or say something else"
                onChange={(changed) => setChosen(withOther(chosen, question, changed.target.value))}
                className="mt-1 rounded-sm border border-input bg-background px-3 py-2 text-[13px] placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-hold focus-visible:outline-none"
              />
            </fieldset>
          )
        )}

        <div className="flex gap-2">
          {walking && (
            <Button size="sm" disabled={answering || unanswered} onClick={() => setAt(at + 1)}>
              {at === questions.length - 1 ? 'Review' : 'Next'}
            </Button>
          )}
          {/* A single question that sends on the click needs no button of its
              own, and grows one as soon as something is typed beside the
              options. */}
          {!walking && !sendsOnClick(questions, chosen) && (
            <Button
              size="sm"
              disabled={answering || !isComplete(questions, chosen)}
              onClick={() => send(decisionOf(questions, chosen))}
            >
              Send
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={answering} onClick={() => setDeclining(true)}>
            Decline
          </Button>
        </div>
      </div>
    </Frame>
  )
}
