import type { SessionMode } from '@keel-web/protocol'

/**
 * The modes keel-web offers, in the order the status line lists them and in
 * the order shift and tab walks through them.
 *
 * Ordered by how much still reaches the developer: everything, then what a
 * classifier is unsure about, then everything but file edits, then nothing
 * because it is refused, then nothing because nothing runs.
 */
export const offeredModes: readonly { value: SessionMode; label: string; detail: string }[] = [
  { value: 'default', label: 'default', detail: 'Asks before every tool call' },
  { value: 'auto', label: 'auto', detail: 'A classifier answers what it is sure about' },
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
  if (mode === 'auto' || mode === 'acceptEdits' || mode === 'dontAsk') return 'hold'
  return mode === 'plan' ? 'keel' : 'muted'
}
