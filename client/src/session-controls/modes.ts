import type { SessionMode } from '@keel-web/protocol'

/**
 * The modes keel-web offers, in the order the status line lists them and in
 * the order shift and tab walks through them.
 *
 * `default` first because it is the one a session starts in, then the two
 * that let work happen without being asked, then the one that runs nothing.
 */
export const offeredModes: readonly { value: SessionMode; label: string; detail: string }[] = [
  { value: 'default', label: 'default', detail: 'Asks before every tool call' },
  { value: 'acceptEdits', label: 'accept edits', detail: 'Writes files without asking' },
  { value: 'dontAsk', label: "don't ask", detail: 'Denies whatever is not already allowed' },
  { value: 'plan', label: 'plan', detail: 'Works out a plan and runs nothing' },
]

/** The next mode round the ring, which is what shift and tab asks for. */
export function nextMode(mode: SessionMode): SessionMode {
  const at = offeredModes.findIndex((offered) => offered.value === mode)
  return offeredModes[(at + 1) % offeredModes.length].value
}

export function labelOfMode(mode: SessionMode): string {
  return offeredModes.find((offered) => offered.value === mode)?.label ?? mode
}

/**
 * A mode that lets work happen unasked is coloured as the state it is, the
 * way a held tool call is. `plan` changes what the session does without
 * giving anything away, so it reads as a state rather than a warning.
 */
export function toneOfMode(mode: SessionMode): 'muted' | 'keel' | 'hold' {
  if (mode === 'acceptEdits' || mode === 'dontAsk') return 'hold'
  return mode === 'plan' ? 'keel' : 'muted'
}
