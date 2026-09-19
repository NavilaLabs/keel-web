interface ToolInputProperties {
  name: string
  input: Record<string, unknown>
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function Block({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words bg-code p-2 font-mono text-xs text-foreground">
      {children}
    </pre>
  )
}

function Path({ value }: { value: string }) {
  const outside = !value.startsWith('/workspaces/keel-web') && value.startsWith('/')
  return (
    <p className="font-mono text-xs">
      <span className={outside ? 'text-destructive' : 'text-muted-foreground'}>{value}</span>
      {outside && <span className="ml-2 text-destructive">outside the repository</span>}
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
    return (
      <div className="flex flex-col gap-1">
        <Block>{command}</Block>
        {asText(input.description) !== undefined && (
          <p className="text-xs text-muted-foreground">{asText(input.description)}</p>
        )}
      </div>
    )
  }

  if (filePath !== undefined) {
    const oldText = asText(input.old_string)
    const newText = asText(input.new_string)
    const content = asText(input.content)
    return (
      <div className="flex flex-col gap-1">
        <Path value={filePath} />
        {oldText !== undefined && newText !== undefined && (
          <>
            <Block>{`- ${oldText}`}</Block>
            <Block>{`+ ${newText}`}</Block>
          </>
        )}
        {content !== undefined && (
          <>
            <p className="text-xs text-muted-foreground">{content.split('\n').length} lines</p>
            <Block>{content}</Block>
          </>
        )}
      </div>
    )
  }

  return <Block>{JSON.stringify(input, null, 2)}</Block>
}
