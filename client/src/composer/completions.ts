import type { SlashCommandSummary } from '@keel-web/protocol'
import type { Completion, CompletionsOfFiles } from './types.ts'

/**
 * A directory keeps the caret inside it and a file moves past it.
 *
 * Taking a directory is rarely the end of what the developer meant to write,
 * so it inserts the separator and waits. A file is, so it inserts the space.
 */
export const completionsOfFiles: CompletionsOfFiles = (entries) =>
  entries.map((entry) => ({
    key: entry.path,
    label: entry.path,
    ...(entry.kind === 'directory' && { detail: 'directory' }),
    insert: entry.kind === 'directory' ? `@${entry.path}/` : `@${entry.path} `,
  }))

function completionOf(command: SlashCommandSummary): Completion {
  return {
    // Two commands may share a name, and only one of them is the agent's own.
    key: `${command.name}:${command.builtin === true ? 'builtin' : 'own'}`,
    label:
      command.argumentHint === '' ? `/${command.name}` : `/${command.name} ${command.argumentHint}`,
    detail: command.description,
    insert: `/${command.name} `,
  }
}

/**
 * The commands a query matches, best first.
 *
 * A name that starts with what was typed outranks an alias that does, and
 * both outrank a description that merely mentions it. That is the order the
 * terminal's own command menu uses, and it is why typing the first letters of
 * a command reaches it rather than everything it is described with.
 */
export function commandCompletions(
  commands: readonly SlashCommandSummary[],
  query: string,
): Completion[] {
  const wanted = query.toLowerCase()

  const byName: Completion[] = []
  const byAlias: Completion[] = []
  const byDescription: Completion[] = []

  for (const command of commands) {
    const completion = completionOf(command)
    if (command.name.toLowerCase().startsWith(wanted)) byName.push(completion)
    else if (command.aliases?.some((alias) => alias.toLowerCase().startsWith(wanted))) {
      byAlias.push(completion)
    } else if (wanted !== '' && command.description.toLowerCase().includes(wanted)) {
      byDescription.push(completion)
    }
  }

  return [...byName, ...byAlias, ...byDescription]
}
