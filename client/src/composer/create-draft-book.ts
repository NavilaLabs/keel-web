import type { SessionKey, WorkspaceId } from '@keel-web/protocol'
import type { DraftBook } from './types.ts'

const longestHistory = 100

function draftKey(key: SessionKey): string {
  return `keel-web.draft.${key.workspaceId}.${key.ticketId}`
}

function historyKey(workspaceId: WorkspaceId): string {
  return `keel-web.history.${workspaceId}`
}

/**
 * Storage that never throws.
 *
 * A private window, blocked site data and a browser that has simply run out
 * all report themselves by throwing, and none of them is a reason for the
 * composer to stop working.
 */
function read(name: string): string | undefined {
  try {
    return localStorage.getItem(name) ?? undefined
  } catch {
    return undefined
  }
}

function write(name: string, value: string): void {
  try {
    localStorage.setItem(name, value)
  } catch {
    // Forgetting is the worst this may do.
  }
}

function forget(name: string): void {
  try {
    localStorage.removeItem(name)
  } catch {
    // As above.
  }
}

function historyOf(workspaceId: WorkspaceId): string[] {
  const stored = read(historyKey(workspaceId))
  if (stored === undefined) return []
  try {
    const parsed: unknown = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : []
  } catch {
    return []
  }
}

export function createDraftBook(): DraftBook {
  return {
    readDraft(key) {
      return read(draftKey(key)) ?? ''
    },

    writeDraft(key, text) {
      if (text === '') forget(draftKey(key))
      else write(draftKey(key), text)
    },

    recordSent(key, text) {
      forget(draftKey(key))
      if (text === '') return

      const history = historyOf(key.workspaceId)
      // The same thing twice in a row is one entry, so a command repeated
      // while waiting does not bury what came before it.
      if (history[0] === text) return
      write(
        historyKey(key.workspaceId),
        JSON.stringify([text, ...history].slice(0, longestHistory)),
      )
    },

    earlier(workspaceId, back) {
      return back < 1 ? undefined : historyOf(workspaceId)[back - 1]
    },
  }
}
