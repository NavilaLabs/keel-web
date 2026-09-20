import type { ArtifactHint, TicketId } from '@keel-web/protocol'

export type Unsubscribe = () => void

/**
 * Listens for what the workflow says is worth looking at, for one ticket.
 *
 * It opens its own stream rather than riding on the chat session's, because
 * a hint belongs to a ticket and not to a conversation: the developer may be
 * reading a ticket's artefacts with no agent running at all, and that is
 * exactly when a hint still makes sense.
 *
 * Nothing here decides what to do with a hint. It reports, and the shell
 * opens the primary target. That keeps the rule the ticket is built on
 * within sight: a hint arrives once, and whatever the developer does next
 * wins.
 */
export interface HintListener {
  /**
   * Listens for the hints of that ticket, and hears only what arrives from
   * now on.
   *
   * A reconnect resumes where it stopped, so a dropped connection does not
   * cost a hint, and nothing already delivered arrives twice. Listening for
   * a ticket while already listening for another replaces the first.
   *
   * Only a visible page acts: a hint means look at this now, and a tab
   * nobody is looking at cannot. A hidden tab therefore hears nothing rather
   * than being moved behind the developer's back.
   */
  listen: (ticketId: TicketId | undefined, onHint: (hint: ArtifactHint) => void) => void

  /** Stops listening and closes the stream. */
  dispose: () => void
}

export interface HintListenerDependencies {
  workspaceId: string
}

export type CreateHintListener = (dependencies: HintListenerDependencies) => HintListener
