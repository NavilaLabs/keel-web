interface ToolInputProperties {
  name: string
  input: Record<string, unknown>
}

const repositoryRoot = '/workspaces/keel-web'

function asText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function Code({ children, tone }: { children: string; tone?: 'added' | 'removed' }) {
  const colour =
    tone === 'added'
      ? 'text-keel'
      : tone === 'removed'
        ? 'text-muted-foreground line-through decoration-1'
        : 'text-foreground'
  return (
    <pre
      className={`overflow-x-auto rounded-sm bg-code p-2.5 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap ${colour}`}
    >
      {children}
    </pre>
  )
}

function Path({ value }: { value: string }) {
  const outside = value.startsWith('/') && !value.startsWith(repositoryRoot)
  const shown = value.startsWith(`${repositoryRoot}/`)
    ? value.slice(repositoryRoot.length + 1)
    : value
  return (
    <p className="font-mono text-[13px]">
      <span className={outside ? 'text-destructive' : 'text-foreground'}>{shown}</span>
      {outside && <span className="ml-2 font-sans text-destructive">outside the repository</span>}
    </p>
  )
}

/**
 * Shows a tool call so it can be judged.
 *
 * A command is never shortened and a path is always visible, because an
 * approval given to a truncated call is not an approval. Anything without its
 * own treatment falls back to the full input.
 */
export function ToolInput({ name, input }: ToolInputProperties) {
  const command = asText(input.command)
  const filePath = asText(input.file_path)

  if (name === 'Bash' && command !== undefined) {
    const description = asText(input.description)
    return (
      <div className="flex flex-col gap-1.5">
        <Code>{command}</Code>
        {description !== undefined && (
          <p className="text-[13px] text-muted-foreground">{description}</p>
        )}
      </div>
    )
  }

  if (filePath !== undefined) {
    const removed = asText(input.old_string)
    const added = asText(input.new_string)
    const content = asText(input.content)
    return (
      <div className="flex flex-col gap-1.5">
        <Path value={filePath} />
        {removed !== undefined && <Code tone="removed">{removed}</Code>}
        {added !== undefined && <Code tone="added">{added}</Code>}
        {content !== undefined && (
          <>
            <p className="text-[13px] text-muted-foreground">{content.split('\n').length} lines</p>
            <Code>{content}</Code>
          </>
        )}
      </div>
    )
  }

  return <Code>{JSON.stringify(input, null, 2)}</Code>
}
