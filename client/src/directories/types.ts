import type { DirectoryListing } from '@keel-web/protocol'

export type { DirectoryListing }

/**
 * The directory the picker is showing, and the one thing it can do: go
 * somewhere else.
 *
 * `listing` is undefined until the first navigation answers, and keeps the
 * last good listing when a navigation fails, so a mistyped path leaves the
 * dialog where it was rather than empty. `error` holds that failure as a
 * sentence and is cleared by the next navigation.
 *
 * Nothing here adds a workspace. The picker reports the chosen path and the
 * workspace list does the adding, so there is still one way into the registry.
 */
export interface Directories {
  listing?: DirectoryListing
  loading: boolean
  error?: string

  /**
   * Shows that directory, or the home directory when the path is omitted.
   *
   * Never throws: a failure surfaces as `error`, because every caller is a
   * click handler or an effect.
   */
  go: (path?: string) => Promise<void>
}

export type UseDirectories = () => Directories
