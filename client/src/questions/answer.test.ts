import type { Question } from '@keel-web/protocol'
import { describe, expect, it } from 'vitest'
import { answerOf, decisionOf, isComplete, sendsOnClick, withLabel, withOther } from './answer.ts'

const library: Question = {
  question: 'Which library should we use?',
  header: 'Library',
  multiSelect: false,
  options: [
    { label: 'A', description: 'the first' },
    { label: 'B', description: 'the second' },
  ],
}

const features: Question = {
  question: 'Which features do you want?',
  header: 'Features',
  multiSelect: true,
  options: [
    { label: 'One', description: 'the first' },
    { label: 'Two', description: 'the second' },
  ],
}

describe('the answer to one question', () => {
  it('is the chosen label', () => {
    expect(answerOf({ labels: ['A'] })).toBe('A')
  })

  it('joins several chosen labels the one way the agent reads them', () => {
    expect(answerOf({ labels: ['One', 'Two'] })).toBe('One, Two')
  })

  it('is the typed text when nothing was chosen', () => {
    expect(answerOf({ labels: [], other: 'something else' })).toBe('something else')
  })

  it('carries the typed text after the chosen labels', () => {
    expect(answerOf({ labels: ['One'], other: 'and this' })).toBe('One, and this')
  })

  it('ignores a text field that was opened and left empty', () => {
    expect(answerOf({ labels: [], other: '   ' })).toBe('')
  })
})

describe('whether everything has been answered', () => {
  it('is false while a question has neither a choice nor text', () => {
    expect(isComplete([library, features], { [library.question]: { labels: ['A'] } })).toBe(false)
  })

  it('is true once every question has something to send', () => {
    const chosen = {
      [library.question]: { labels: ['A'] },
      [features.question]: { labels: [], other: 'neither' },
    }

    expect(isComplete([library, features], chosen)).toBe(true)
  })
})

describe('picking an option', () => {
  it('replaces the choice where only one is allowed', () => {
    const chosen = withLabel(withLabel({}, library, 'A'), library, 'B')

    expect(chosen[library.question]?.labels).toEqual(['B'])
  })

  it('leaves a single choice picked rather than clearing it', () => {
    const chosen = withLabel(withLabel({}, library, 'A'), library, 'A')

    expect(chosen[library.question]?.labels).toEqual(['A'])
  })

  it('adds and removes where several are allowed', () => {
    const both = withLabel(withLabel({}, features, 'One'), features, 'Two')
    const fewer = withLabel(both, features, 'One')

    expect(both[features.question]?.labels).toEqual(['One', 'Two'])
    expect(fewer[features.question]?.labels).toEqual(['Two'])
  })

  it('keeps the typed text when an option is picked as well', () => {
    const chosen = withLabel(withOther({}, features, 'and this'), features, 'One')

    expect(answerOf(chosen[features.question] as never)).toBe('One, and this')
  })
})

describe('whether a click is the whole answer', () => {
  it('is true for one question that takes one choice', () => {
    expect(sendsOnClick([library], {})).toBe(true)
  })

  it('is false once something has been typed beside the options', () => {
    expect(sendsOnClick([library], withOther({}, library, 'else'))).toBe(false)
  })

  it('is false where several choices are allowed, because no click can end it', () => {
    expect(sendsOnClick([features], {})).toBe(false)
  })

  it('is false for more than one question', () => {
    expect(sendsOnClick([library, features], {})).toBe(false)
  })
})

describe('the decision the agent reads', () => {
  it('is keyed by the full question text and never by the header', () => {
    const chosen = {
      [library.question]: { labels: ['A'] },
      [features.question]: { labels: ['One', 'Two'] },
    }

    expect(decisionOf([library, features], chosen)).toEqual({
      decision: 'answers',
      answers: {
        'Which library should we use?': 'A',
        'Which features do you want?': 'One, Two',
      },
    })
  })

  it('names every question, even one that was left empty', () => {
    const decision = decisionOf([library], {})

    expect(decision).toEqual({ decision: 'answers', answers: { [library.question]: '' } })
  })
})
