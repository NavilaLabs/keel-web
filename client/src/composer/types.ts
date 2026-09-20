import type { FileEntry, SessionKey, SlashCommandSummary, WorkspaceId } from '@keel-web/protocol'

/** What the composer completes when a trigger is open. */
export type TriggerKind = 'command' | 'file'

/**
 * A completion the text being typed has opened.
 *
 * `at` is the index of the trigger character itself, so the text it owns runs
 * from `at` to the caret and that is what a taken completion replaces.
 */
export interface Trigger {
  kind: TriggerKind
  at: number
  query: string
}

/**
 * Finds the trigger the caret sits in, or nothing.
 *
 * Pure and total: any text and any caret answer without throwing.
 *
 * A `/` opens one only at the very start of the text or after whitespace, and
 * its query runs to the caret and stops at whitespace, so `/tmp/notes.md`
 * stops being a command as soon as the second slash is typed. An `@` opens
 * one at the start or after whitespace, and its query also stops at
 * whitespace, so a path may contain slashes but never a space.
 *
 * Text after the caret is ignored, which is what lets a reference be
 * completed in the middle of a sentence that is already written.
 */
export type FindTrigger = (text: string, caret: number) => Trigger | undefined

/**
 * One row the completion popup offers.
 *
 * `insert` is the whole replacement for the trigger and its query, the
 * trigger character included, so taking a row never leaves the caller to
 * work out what to keep.
 */
export interface Completion {
  /** Stable within one list, so it can be a React key. */
  key: string
  label: string
  detail?: string
  insert: string
}

/** Turns what the file index answered into rows the popup can show. */
export type CompletionsOfFiles = (entries: readonly FileEntry[]) => Completion[]

/**
 * What the developer has typed but not sent, and what they sent before.
 *
 * It lives in the browser, because keel-web keeps no storage of its own and
 * what someone half-typed is theirs. It therefore follows neither the
 * developer to another browser nor a session to another viewer, and it can
 * come back empty from a browser that refuses storage.
 *
 * Nothing here ever throws. A browser that will not store answers as one that
 * has nothing stored, so a private window composes and sends normally and
 * only forgets.
 */
export interface DraftBook {
  /** The unsent text for that ticket, empty when there is none. */
  readDraft: (key: SessionKey) => string

  /** Keeps the unsent text, replacing what was kept for that ticket. */
  writeDraft: (key: SessionKey, text: string) => void

  /**
   * Records a message as sent: it joins the history and the draft is dropped.
   *
   * The history is per workspace rather than per ticket, so what was asked in
   * one ticket can be asked again in the next. Sending the same text twice in
   * a row records it once, which is what keeps a repeated command from
   * filling the history.
   */
  recordSent: (key: SessionKey, text: string) => void

  /**
   * The message `back` steps into the past, where 1 is the most recent.
   *
   * Undefined once `back` reaches past the oldest, which is what stops the
   * walk rather than wrapping round to the newest.
   */
  earlier: (workspaceId: WorkspaceId, back: number) => string | undefined
}

/**
 * The message input, with its completions and its history.
 *
 * It behaves as the terminal does, and the keyboard is where that is decided:
 *
 * - While the popup is open, **up** and **down** move the highlight, and the
 *   list opens with **no row highlighted**. **Enter** then still sends the
 *   text as it was typed, so a completion never sends something the developer
 *   did not write. Once a row is highlighted, **enter** takes it instead.
 * - **Tab** takes the highlighted row, or the first one when none is
 *   highlighted.
 * - **Escape** closes the popup and leaves the text alone. It does not
 *   clear the input.
 * - **Up** with the popup closed and the caret in the first line walks back
 *   through what was sent before. Anywhere else it moves the caret, so a
 *   draft of several lines stays editable.
 * - **Shift and tab** cycles the session's mode, wherever the caret is.
 *
 * The popup never takes the focus: it is drawn beside an input that keeps it
 * throughout, so typing continues while it is open and the caret never moves
 * because a list appeared.
 *
 * A taken file reference is written as plain `@path` text and sent as part of
 * the message, exactly as it is typed in the terminal. The message on the
 * wire stays a string, and nothing about the file travels with it.
 */
export interface ComposerProperties {
  /** Undefined until a ticket is open, which is when there is nothing to write to. */
  session: SessionKey | undefined

  /**
   * The commands a slash completion offers.
   *
   * Handed over rather than fetched, because the session says what it offers
   * on the one stream someone else already owns. An empty list is the state
   * before the session has said, and it only means the popup has nothing to
   * show yet.
   */
  commands: readonly SlashCommandSummary[]

  drafts: DraftBook

  onSend: (text: string) => void
  onCycleMode: () => void
}
