import type { WorkspaceId } from '@keel-web/protocol'

/** A workspace as the sidebar needs it. */
export interface WorkspaceSummary {
  id: WorkspaceId
  name: string
  /** False when the repository has no keel configuration, so it cannot hold a session. */
  keel: boolean
}
