/**
 * The wire contract for what the workflow says is worth looking at now.
 *
 * keel writes a hint into `tickets/<id>/events.jsonl` when a consultation
 * opens on an artefact. It is fire and forget on that side: nothing waits for
 * it, and keel is unchanged by nobody listening. This carries it to a browser
 * that happens to be there.
 */

import type { ArtifactRef } from './artifacts.js'

/**
 * One hint, as the browser receives it.
 *
 * `targets` is ordered and the first is the primary, so a surface that can
 * show one artefact has an unambiguous choice. The rest are what else the
 * step is about.
 *
 * `at` is the producer's timestamp, and `consultation` is present when the
 * hint belongs to a question the developer is being asked. Both come from
 * keel unchanged.
 */
export interface ArtifactHint {
  at: string
  step?: string
  block?: string | null
  consultation?: string
  targets: ArtifactRef[]
}
