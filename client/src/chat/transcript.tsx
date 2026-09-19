import { memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { RenderItem } from '../transcript/types.ts'
import { PermissionPrompt } from './permission-prompt.tsx'
import { ToolInput } from './tool-input.tsx'
import type { TranscriptProperties } from './types.ts'

/** Raw HTML in model output is not rendered: react-markdown ignores it by default. */
function Prose({ text }: { text: string }) {
  return (
    <div className="prose-sm max-w-none text-sm leading-relaxed text-foreground [&_a]:text-brand [&_a]:underline [&_code]:bg-code [&_code]:px-1 [&_pre]:overflow-x-auto [&_pre]:bg-code [&_pre]:p-2">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  )
}

const Item = memo(function Item({
  item,
  onAnswer,
}: {
  item: RenderItem
  onAnswer: TranscriptProperties['onAnswer']
}) {
  switch (item.kind) {
    case 'message':
      return item.author === 'developer' ? (
        <p className="self-end border border-border bg-muted px-3 py-2 text-sm whitespace-pre-wrap text-foreground">
          {item.text}
        </p>
      ) : (
        <Prose text={item.text} />
      )

    case 'thinking':
      return (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Thinking</summary>
          <p className="mt-1 whitespace-pre-wrap">{item.text}</p>
        </details>
      )

    case 'tool':
      return (
        <details className="border border-border">
          <summary className="flex cursor-pointer items-baseline gap-2 px-2 py-1 select-none">
            <span className="font-mono text-xs text-foreground">{item.name}</span>
            <span className="text-xs text-muted-foreground">
              {item.result === undefined ? 'running' : item.result.ok ? 'done' : 'failed'}
            </span>
          </summary>
          <div className="flex flex-col gap-2 p-2">
            <ToolInput name={item.name} input={item.input} />
            {item.result !== undefined && item.result.summary !== '' && (
              <pre className="max-h-64 overflow-auto bg-code p-2 font-mono text-xs whitespace-pre-wrap">
                {item.result.summary}
              </pre>
            )}
          </div>
        </details>
      )

    case 'permission':
      return item.decision === undefined ? (
        <PermissionPrompt
          request={item.request}
          answering={false}
          onAnswer={(decision) => onAnswer(item.request.requestId, decision)}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{item.request.toolName}</span>{' '}
          {item.decision.decision === 'deny' ? 'denied' : 'allowed'}
        </p>
      )

    case 'failure':
      return (
        <p className="border border-destructive px-3 py-2 text-sm text-destructive">
          {item.authRequired
            ? 'Claude Code is not logged in inside the container. Run `claude` in it once, then reload.'
            : item.text}
        </p>
      )

    case 'idle':
      return (
        <p className="text-xs text-muted-foreground">
          {item.turns} turns, ${item.costUsd.toFixed(3)}
        </p>
      )
  }
})

export function Transcript({ items, draft, onAnswer }: TranscriptProperties) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <Item key={item.key} item={item} onAnswer={onAnswer} />
      ))}
      {draft !== '' && (
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">{draft}</p>
      )}
    </div>
  )
}
