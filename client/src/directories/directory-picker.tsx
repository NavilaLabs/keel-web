import { Dialog } from '@base-ui/react/dialog'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { useDirectories } from './use-directories.ts'

interface DirectoryPickerProperties {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChoose: (path: string) => void
}

/**
 * Walks the directories of this machine so a repository is chosen rather than
 * typed. The path line stays editable, because someone who knows the path
 * should not have to click their way to it.
 */
export function DirectoryPicker({ open, onOpenChange, onChoose }: DirectoryPickerProperties) {
  const { listing, loading, error, go } = useDirectories()
  const [typed, setTyped] = useState('')

  useEffect(() => {
    if (open) void go()
  }, [open, go])

  // While the developer is editing the path line, what they typed wins.
  const [editing, setEditing] = useState(false)
  const shown = editing ? typed : (listing?.path ?? '')

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-background/80" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 flex h-[26rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 flex-col rounded-md border border-border bg-background shadow-lg">
          <Dialog.Title className="px-4 pt-4 pb-3 text-sm font-medium">
            Choose a repository
          </Dialog.Title>

          <form
            className="flex gap-2 px-4 pb-3"
            onSubmit={(submitted) => {
              submitted.preventDefault()
              setEditing(false)
              void go(typed.trim())
            }}
          >
            <input
              value={shown}
              aria-label="Path"
              spellCheck={false}
              onFocus={() => {
                setTyped(listing?.path ?? '')
                setEditing(true)
              }}
              onBlur={() => setEditing(false)}
              onChange={(changed) => setTyped(changed.target.value)}
              className="min-w-0 flex-1 rounded-sm border border-input bg-background px-2 py-1.5 font-mono text-[13px] focus-visible:border-keel focus-visible:outline-none"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={listing?.parent === undefined}
              onClick={() => void go(listing?.parent)}
            >
              Up
            </Button>
          </form>

          <div className="min-h-0 flex-1 overflow-y-auto border-y border-border">
            {listing?.entries.length === 0 && !loading && (
              <p className="px-4 py-3 text-[13px] text-muted-foreground">
                No folders in here. Choose it anyway, or go up.
              </p>
            )}
            {listing?.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => void go(entry.path)}
                className="block w-full truncate px-4 py-1.5 text-left font-mono text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none"
              >
                {entry.name}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 px-4 py-3">
            <p className="min-w-0 flex-1 truncate text-[13px] text-destructive">{error}</p>
            <Dialog.Close
              render={
                <Button type="button" variant="ghost" size="sm">
                  Cancel
                </Button>
              }
            />
            <Button
              type="button"
              size="sm"
              disabled={listing === undefined}
              onClick={() => {
                if (listing === undefined) return
                onChoose(listing.path)
                onOpenChange(false)
              }}
            >
              Add this folder
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
