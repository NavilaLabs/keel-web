import type { SessionControls } from '@keel-web/protocol'
import { useSyncExternalStore } from 'react'
import type { SessionControlsStore } from './types.ts'

export function useSessionControls(store: SessionControlsStore): SessionControls | undefined {
  return useSyncExternalStore(store.subscribe, store.getControls)
}
