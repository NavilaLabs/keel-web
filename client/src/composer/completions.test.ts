import type { SlashCommandSummary } from '@keel-web/protocol'
import { describe, expect, it } from 'vitest'
import { commandCompletions, completionsOfFiles } from './completions.ts'

const commands: SlashCommandSummary[] = [
  { name: 'review', description: 'Reviews the diff', argumentHint: '<path>' },
  { name: 'usage', description: 'Shows the cost so far', argumentHint: '', aliases: ['cost'] },
  { name: 'clear', description: 'Starts a review of nothing', argumentHint: '' },
]

function named(query: string): string[] {
  return commandCompletions(commands, query).map((completion) => completion.label)
}

describe('command completions', () => {
  it('offers everything when nothing has been typed yet', () => {
    expect(commandCompletions(commands, '')).toHaveLength(3)
  })

  it('puts a name that starts with the query ahead of a description that mentions it', () => {
    // `clear` is described as starting a review of nothing, so it matches the
    // query too, and it has to come second.
    expect(named('review')).toEqual(['/review <path>', '/clear'])
  })

  it('reaches a command through an alias', () => {
    expect(named('cost')).toEqual(['/usage'])
  })

  it('ranks a name before an alias and an alias before a description', () => {
    expect(named('c')).toEqual(['/clear', '/usage'])
  })

  it('shows the argument hint beside the name, and nothing where there is none', () => {
    expect(named('usage')).toEqual(['/usage'])
  })

  it('keeps two commands of the same name apart', () => {
    const shared: SlashCommandSummary[] = [
      { name: 'review', description: "The agent's own", argumentHint: '', builtin: true },
      { name: 'review', description: 'The one in this project', argumentHint: '' },
    ]

    const keys = commandCompletions(shared, 'review').map((completion) => completion.key)

    expect(new Set(keys).size).toBe(2)
  })

  it('inserts the command and a space, so an argument can follow', () => {
    expect(commandCompletions(commands, 'review')[0]?.insert).toBe('/review ')
  })
})

describe('file completions', () => {
  it('moves past a file and waits inside a directory', () => {
    const rows = completionsOfFiles([
      { path: 'client/src', kind: 'directory' },
      { path: 'README.md', kind: 'file' },
    ])

    expect(rows[0]?.insert).toBe('@client/src/')
    expect(rows[1]?.insert).toBe('@README.md ')
  })

  it('says which rows are directories and leaves a file unmarked', () => {
    const rows = completionsOfFiles([
      { path: 'client', kind: 'directory' },
      { path: 'README.md', kind: 'file' },
    ])

    expect(rows[0]?.detail).toBe('directory')
    expect(rows[1]?.detail).toBeUndefined()
  })
})
