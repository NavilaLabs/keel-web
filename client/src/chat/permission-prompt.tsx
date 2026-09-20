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

export function PermissionPrompt({ request, answering, onAnswer }: PermissionPromptProperties) {
  // A call the agent flagged opens on its refusal, so that approving it is
  // never the thing that happens by reflex.
  const [reason, setReason] = useState<string | undefined>(
    request.defaultToNo === true ? '' : undefined,
  )

  return (
    <Frame>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-hold">
          Waiting on you before running{' '}
          <span className="font-mono text-foreground">{request.toolName}</span>
        </p>

        <ToolInput name={request.toolName} input={request.input} />

        {reason === undefined ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={answering} onClick={() => onAnswer({ decision: 'allow' })}>
              Allow
            </Button>
            {request.alwaysAllowable === true && (
              <Button
                size="sm"
                variant="outline"
                disabled={answering}
                title={`Stop asking about ${request.toolName} for the rest of this session`}
                onClick={() => onAnswer({ decision: 'allow', alwaysAllow: true })}
              >
                Allow, and stop asking
              </Button>
            )}
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
