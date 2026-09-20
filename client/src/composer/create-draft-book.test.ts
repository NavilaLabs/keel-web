import type { SessionKey } from '@keel-web/protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDraftBook } from './create-draft-book.ts'

const four: SessionKey = { workspaceId: 'w1', ticketId: '4' }
const nine: SessionKey = { workspaceId: 'w1', ticketId: '9' }
const elsewhere: SessionKey = { workspaceId: 'w2', ticketId: '4' }

describe('draft book', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('has nothing for a ticket nothing was written for', () => {
    expect(createDraftBook().readDraft(four)).toBe('')
  })

  it('keeps a draft per ticket', () => {
    const drafts = createDraftBook()

    drafts.writeDraft(four, 'half a thought')
    drafts.writeDraft(nine, 'another one')

    expect(drafts.readDraft(four)).toBe('half a thought')
    expect(drafts.readDraft(nine)).toBe('another one')
  })

  it('survives a reload, which is the point of keeping it at all', () => {
    createDraftBook().writeDraft(four, 'half a thought')

    expect(createDraftBook().readDraft(four)).toBe('half a thought')
  })

  it('drops the draft once the message is sent', () => {
    const drafts = createDraftBook()
    drafts.writeDraft(four, 'about to send')

    drafts.recordSent(four, 'about to send')

    expect(drafts.readDraft(four)).toBe('')
  })

  it('walks back through what was sent, newest first', () => {
    const drafts = createDraftBook()
    drafts.recordSent(four, 'first')
    drafts.recordSent(four, 'second')

    expect(drafts.earlier('w1', 1)).toBe('second')
    expect(drafts.earlier('w1', 2)).toBe('first')
  })

  it('stops rather than wrapping round at the oldest', () => {
    const drafts = createDraftBook()
    drafts.recordSent(four, 'only')

    expect(drafts.earlier('w1', 2)).toBeUndefined()
    expect(drafts.earlier('w1', 0)).toBeUndefined()
  })

  it('keeps the history per workspace, so another ticket reaches it', () => {
    const drafts = createDraftBook()
    drafts.recordSent(four, 'asked in four')

    expect(drafts.earlier('w1', 1)).toBe('asked in four')
    expect(drafts.earlier('w2', 1)).toBeUndefined()
  })

  it('records the same message twice in a row once', () => {
    const drafts = createDraftBook()
    drafts.recordSent(four, 'again')
    drafts.recordSent(nine, 'again')

    expect(drafts.earlier('w1', 1)).toBe('again')
    expect(drafts.earlier('w1', 2)).toBeUndefined()
  })

  it('keeps a workspace that was never written to out of another one', () => {
    const drafts = createDraftBook()
    drafts.writeDraft(elsewhere, 'over here')

    expect(drafts.readDraft(four)).toBe('')
  })

  it('composes and sends normally in a browser that refuses to store', () => {
    const refusing = () => {
      throw new Error('storage is blocked')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refusing)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refusing)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(refusing)
    const drafts = createDraftBook()

    expect(() => drafts.writeDraft(four, 'anything')).not.toThrow()
    expect(() => drafts.recordSent(four, 'anything')).not.toThrow()
    expect(drafts.readDraft(four)).toBe('')
    expect(drafts.earlier('w1', 1)).toBeUndefined()

    vi.restoreAllMocks()
  })

  it('starts over rather than throwing on a history it cannot read', () => {
    localStorage.setItem('keel-web.history.w1', 'not json')

    expect(createDraftBook().earlier('w1', 1)).toBeUndefined()
  })
})
