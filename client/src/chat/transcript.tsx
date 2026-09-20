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
    <div className="max-w-[68ch] text-[15px] leading-[1.65] text-foreground [&>*+*]:mt-3 [&_code]:bg-code [&_code]:px-1 [&_code]:font-mono [&_code]:text-[13px] [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:bg-code [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  )
}

/**
 * The left edge says what kind of entry this is.
 *
 * Nothing here is boxed: a border on every entry would make the waiting ones
 * indistinguishable from the rest, and the waiting ones are the point.
 */
function Aside({ edge, children }: { edge: string; children: React.ReactNode }) {
  return <div className={`border-l-2 ${edge} py-0.5 pl-3`}>{children}</div>
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
        <p className="ml-10 self-end rounded-sm bg-muted px-3 py-2 text-[15px] leading-[1.6] whitespace-pre-wrap text-foreground">
          {item.text}
        </p>
      ) : (
        <Prose text={item.text} />
      )

    case 'thinking':
      return (
        <Aside edge="border-border">
          <details className="text-[13px] text-muted-foreground">
            <summary className="cursor-pointer list-none select-none hover:text-foreground">
              Thinking
            </summary>
            <p className="mt-2 max-w-[68ch] leading-relaxed whitespace-pre-wrap">{item.text}</p>
          </details>
        </Aside>
      )

    case 'tool': {
      const state = item.result === undefined ? 'running' : item.result.ok ? 'done' : 'failed'
      return (
        <Aside edge={item.result?.ok === false ? 'border-destructive' : 'border-border'}>
          <details className="text-[13px]">
            <summary className="flex cursor-pointer list-none items-baseline gap-2 select-none">
              <span className="font-mono text-foreground">{item.name}</span>
              <span
                className={
                  state === 'failed'
                    ? 'text-destructive'
                    : state === 'running'
                      ? 'text-keel'
                      : 'text-muted-foreground'
                }
              >
                {state}
              </span>
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              <ToolInput name={item.name} input={item.input} />
              {item.result !== undefined && item.result.summary !== '' && (
                <pre className="max-h-64 overflow-auto bg-code p-2 font-mono text-[12px] whitespace-pre-wrap text-muted-foreground">
                  {item.result.summary}
                </pre>
              )}
            </div>
          </details>
        </Aside>
      )
    }

    case 'permission':
      return item.decision === undefined ? (
        <PermissionPrompt
          request={item.request}
          answering={false}
          onAnswer={(decision) => onAnswer(item.request.requestId, decision)}
        />
      ) : (
        <Aside edge="border-border">
          <p className="text-[13px] text-muted-foreground">
            <span className="font-mono text-foreground">{item.request.toolName}</span>{' '}
            {item.decision.decision === 'deny' ? 'denied' : 'allowed'}
            {item.decision.decision === 'deny' && item.decision.message !== '' && (
              <span className="block pt-1">{item.decision.message}</span>
            )}
          </p>
        </Aside>
      )

    case 'failure':
      return (
        <Aside edge="border-destructive">
          <p className="max-w-[68ch] text-sm text-foreground">
            {item.text}
            {item.authRequired ? (
              <>
                {' '}
                Log in with <code className="bg-code px-1 font-mono text-[13px]">claude</code> in a
                terminal, then reload.
              </>
            ) : null}
          </p>
        </Aside>
      )

    case 'idle':
      return (
        <p className="pt-1 font-mono text-[11px] text-muted-foreground">
          {item.turns} turns, ${item.costUsd.toFixed(3)}
        </p>
      )
  }
})

export function Transcript({ items, draft, onAnswer }: TranscriptProperties) {
  return (
    <div className="flex flex-col items-start gap-5">
      {items.map((item) => (
        <Item key={item.key} item={item} onAnswer={onAnswer} />
      ))}
      {draft !== '' && (
        <p className="max-w-[68ch] text-[15px] leading-[1.65] whitespace-pre-wrap text-foreground">
          {draft}
          <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-keel" />
        </p>
      )}
    </div>
  )
}
