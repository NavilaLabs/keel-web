import type { FindTrigger } from './types.ts'

const whitespace = [' ', '\n', '\t']

/** Where the word the caret sits in begins. */
function tokenStart(before: string): number {
  let at = 0
  for (const character of whitespace) at = Math.max(at, before.lastIndexOf(character) + 1)
  return at
}

export const findTrigger: FindTrigger = (text, caret) => {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)))
  const at = tokenStart(before)
  const token = before.slice(at)

  if (token.startsWith('@')) return { kind: 'file', at, query: token.slice(1) }
  if (!token.startsWith('/')) return undefined

  // A second slash means this is a path being typed rather than a command,
  // which is what stops `/tmp/notes.md` from keeping the command list open.
  const query = token.slice(1)
  return query.includes('/') ? undefined : { kind: 'command', at, query }
}
