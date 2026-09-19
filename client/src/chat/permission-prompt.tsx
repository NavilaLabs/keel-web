import type { PermissionDecision, Question } from '@keel-web/protocol'
import { useState } from 'react'
import { Button } from '@/components/ui/button.tsx'
import type { PermissionPromptProperties } from './types.ts'
import { ToolInput } from './tool-input.tsx'

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

  // The agent reads a comma separated string per question, keyed by the full
  // question text.
  const submit = () => {
    const answers = Object.fromEntries(
      Object.entries(chosen).map(([question, labels]) => [question, labels.join(', ')]),
    )
    onAnswer({ decision: 'answers', answers })
  }

  const answered = questions.every((question) => (chosen[question.question] ?? []).length > 0)

  return (
    <div className="flex flex-col gap-4">
      {questions.map((question) => (
        <fieldset key={question.question} className="flex flex-col gap-2">
          <legend className="mb-1 flex items-baseline gap-2">
            <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {question.header}
            </span>
            <span className="text-sm text-foreground">{question.question}</span>
          </legend>
          {question.options.map((option) => {
            const selected = (chosen[question.question] ?? []).includes(option.label)
            return (
              <label
                key={option.label}
                className={`flex cursor-pointer gap-3 border border-border p-2 text-sm ${
                  selected ? 'border-brand bg-accent' : 'hover:bg-accent'
                }`}
              >
                <input
                  type={question.multiSelect ? 'checkbox' : 'radio'}
                  name={question.question}
                  checked={selected}
                  disabled={disabled}
                  onChange={() => toggle(question, option.label)}
                  className="mt-1 accent-brand"
                />
                <span>
                  <span className="block text-foreground">{option.label}</span>
                  <span className="block text-muted-foreground">{option.description}</span>
                  {option.preview !== undefined && (
                    <pre className="mt-2 overflow-x-auto bg-code p-2 font-mono text-xs">
                      {option.preview}
                    </pre>
                  )}
                </span>
              </label>
            )
          })}
        </fieldset>
      ))}
      <Button size="sm" disabled={disabled || !answered} onClick={submit}>
        Answer
      </Button>
    </div>
  )
}

export function PermissionPrompt({ request, answering, onAnswer }: PermissionPromptProperties) {
  const [reason, setReason] = useState<string | undefined>(undefined)

  if (request.questions !== undefined) {
    return (
      <section className="border border-brand bg-card p-3">
        <Questions questions={request.questions} disabled={answering} onAnswer={onAnswer} />
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-3 border border-brand bg-card p-3">
      <header className="flex items-baseline gap-2">
        <span className="font-mono text-sm text-foreground">{request.toolName}</span>
        <span className="text-xs text-muted-foreground">wants to run</span>
      </header>

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
          <label className="text-xs text-muted-foreground" htmlFor="deny-reason">
            The agent reads this, so a reason is a better answer than silence.
          </label>
          <textarea
            id="deny-reason"
            autoFocus
            rows={2}
            value={reason}
            disabled={answering}
            onChange={(changed) => setReason(changed.target.value)}
            className="border border-input bg-background p-2 font-mono text-sm"
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
    </section>
  )
}
