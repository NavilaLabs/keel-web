import { describe, expect, it } from 'vitest'
import { findTrigger } from './find-trigger.ts'

/** The caret sits at the end of what was typed, which is the usual case. */
function at(text: string) {
  return findTrigger(text, text.length)
}

describe('finding the trigger the caret sits in', () => {
  it('opens a command at the start of the message', () => {
    expect(at('/rev')).toEqual({ kind: 'command', at: 0, query: 'rev' })
  })

  it('opens a command after whitespace, so one can be written mid-message', () => {
    expect(at('look at /rev')).toEqual({ kind: 'command', at: 8, query: 'rev' })
  })

  it('stops being a command once a second slash makes it a path', () => {
    expect(at('/tmp/notes.md')).toBeUndefined()
  })

  it('opens a file reference and keeps the separators in its query', () => {
    expect(at('@client/src/ch')).toEqual({ kind: 'file', at: 0, query: 'client/src/ch' })
  })

  it('opens a file reference with nothing typed after it', () => {
    expect(at('please read @')).toEqual({ kind: 'file', at: 12, query: '' })
  })

  it('opens nothing in the middle of a word', () => {
    expect(at('mail@example.com')).toBeUndefined()
    expect(at('and/or')).toBeUndefined()
  })

  it('ends the query at whitespace', () => {
    expect(at('@notes.md and then')).toBeUndefined()
  })

  it('ignores what is written after the caret, so a reference can be filled in', () => {
    expect(findTrigger('read @cli and stop', 9)).toEqual({ kind: 'file', at: 5, query: 'cli' })
  })

  it('opens nothing once the caret has moved past the word', () => {
    expect(findTrigger('read @cli and stop', 10)).toBeUndefined()
  })

  it('opens a command on a line of its own', () => {
    expect(at('first\n/rev')).toEqual({ kind: 'command', at: 6, query: 'rev' })
  })

  it('answers for an empty message and for a caret past the end', () => {
    expect(findTrigger('', 0)).toBeUndefined()
    expect(findTrigger('@a', 99)).toEqual({ kind: 'file', at: 0, query: 'a' })
  })
})
