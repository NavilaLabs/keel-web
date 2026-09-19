import type { PermissionDecision, Question } from '@keel-web/protocol'
import { useState } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { ToolInput } from './tool-input.tsx'
import type { PermissionPromptProperties } from './types.ts'

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="hold-arrive w-full border-l-[3px] border-hold-edge bg-hold-fill py-3 pr-3 pl-4">
      {children}
    </section>
  )
}

function Questions({
  questions,
  disabled,
  onAnswer,
}: {
  questions: readonly Question[]
  disabled: boolean
  onAnswer: (decision: PermissionDecision) => void
}) {
  const [chosen, setChosen] = useState<Record<string, string[]>>({})

  const toggle = (question: Question, label: string) => {
    setChosen((previous) => {
      const current = previous[question.question] ?? []
      if (!question.multiSelect) return { ...previous, [question.question]: [label] }
      return {
        ...previous,
        [question.question]: current.includes(label)
          ? current.filter((entry) => entry !== label)
          : [...current, label],
      }
    })
  }

  // The agent reads one comma separated string per question, keyed by the
  // full question text.
  const submit = () => {
    onAnswer({
      decision: 'answers',
      answers: Object.fromEntries(
        Object.entries(chosen).map(([question, labels]) => [question, labels.join(', ')]),
      ),
    })
  }

  const complete = questions.every((question) => (chosen[question.question] ?? []).length > 0)

  return (
    <div className="flex flex-col gap-5">
      {questions.map((question) => (
        <fieldset key={question.question} className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[15px] text-foreground">{question.question}</legend>
          {question.options.map((option) => {
            const selected = (chosen[question.question] ?? []).includes(option.label)
            return (
              <label
                key={option.label}
                className={`flex cursor-pointer gap-2.5 rounded-sm px-2 py-1.5 text-[13px] ${
                  selected ? 'bg-hold/15' : 'hover:bg-foreground/5'
                }`}
              >
                <input
                  type={question.multiSelect ? 'checkbox' : 'radio'}
                  name={question.question}
                  checked={selected}
                  disabled={disabled}
                  onChange={() => toggle(question, option.label)}
                  className="mt-1 accent-hold"
                />
                <span className="min-w-0">
                  <span className="block text-foreground">{option.label}</span>
                  <span className="block text-muted-foreground">{option.description}</span>
                  {option.preview !== undefined && (
                    <pre className="mt-1.5 overflow-x-auto bg-code p-2 font-mono text-[12px]">
                      {option.preview}
                    </pre>
                  )}
                </span>
              </label>
            )
          })}
        </fieldset>
      ))}
      <div>
        <Button size="sm" disabled={disabled || !complete} onClick={submit}>
          Send answer
        </Button>
      </div>
    </div>
  )
}

export function PermissionPrompt({ request, answering, onAnswer }: PermissionPromptProperties) {
  const [reason, setReason] = useState<string | undefined>(undefined)

  if (request.questions !== undefined) {
    return (
      <Frame>
        <Questions questions={request.questions} disabled={answering} onAnswer={onAnswer} />
      </Frame>
    )
  }

  return (
    <Frame>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-hold">
          Waiting on you before running{' '}
          <span className="font-mono text-foreground">{request.toolName}</span>
        </p>

        <ToolInput name={request.toolName} input={request.input} />

        {reason === undefined ? (
          <div className="flex gap-2">
            <Button size="sm" disabled={answering} onClick={() => onAnswer({ decision: 'allow' })}>
              Allow
            </Button>
            <Button size="sm" variant="outline" disabled={answering} onClick={() => setReason('')}>
              Deny
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="text-[13px] text-muted-foreground" htmlFor="deny-reason">
              Claude Code reads this and can act on it.
            </label>
            <textarea
              id="deny-reason"
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
                onClick={() => onAnswer({ decision: 'deny', message: reason })}
              >
                Send denial
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={answering}
                onClick={() => setReason(undefined)}
              >
                Back
              </Button>
            </div>
          </div>
        )}
      </div>
    </Frame>
  )
}
