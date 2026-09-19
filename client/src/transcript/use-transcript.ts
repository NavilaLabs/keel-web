import { useSyncExternalStore } from 'react'
import type { RenderItem, TranscriptStore } from './types.ts'

/** Re-renders only when something recorded arrives. */
export function useTranscript(store: TranscriptStore): readonly RenderItem[] {
  return useSyncExternalStore(store.subscribeTranscript, store.getTranscript, store.getTranscript)
}

/** Re-renders on every batch of tokens, so it belongs in one leaf. */
export function useDraft(store: TranscriptStore): string {
  return useSyncExternalStore(store.subscribeDraft, store.getDraft, store.getDraft)
}
