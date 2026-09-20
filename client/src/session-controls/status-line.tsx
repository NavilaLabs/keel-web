import type { EffortLevel, SessionMode } from '@keel-web/protocol'
import { ControlMenu, type MenuItem } from './control-menu.tsx'
import { labelOfMode, offeredModes, toneOfMode } from './modes.ts'
import type { SessionControlsStore } from './types.ts'
import { useSessionControls } from './use-session-controls.ts'

export function StatusLine({ store }: { store: SessionControlsStore }) {
  const controls = useSessionControls(store)
  if (controls === undefined) return null

  const { settings, models, commands } = controls
  const chosenModel = models.find((model) => model.value === settings.model)
  const effortLevels = chosenModel?.effortLevels ?? []

  const change = (asked: Parameters<SessionControlsStore['change']>[0]) => {
    void store.change(asked)
  }

  const modeItems: MenuItem[] = offeredModes.map((offered) => ({
    value: offered.value,
    label: offered.label,
    detail: offered.detail,
    chosen: offered.value === settings.mode,
  }))

  const modelItems: MenuItem[] = models.map((model) => ({
    value: model.value,
    label: model.displayName,
    detail: model.description,
    chosen: model.value === settings.model,
  }))

  const effortItems: MenuItem[] = effortLevels.map((level) => ({
    value: level,
    label: level,
    chosen: level === settings.effort,
  }))

  return (
    <div className="flex items-center gap-1 pt-1.5 text-[12px] text-muted-foreground">
      <ControlMenu
        label={labelOfMode(settings.mode)}
        title="Which tool calls you are asked about. Shift and tab cycles it."
        tone={toneOfMode(settings.mode)}
        items={modeItems}
        onPick={(value) => change({ mode: value as SessionMode })}
      />

      {models.length > 0 && (
        <ControlMenu
          label={chosenModel?.displayName ?? settings.model ?? 'default model'}
          title="The model this session answers with"
          tone="muted"
          items={modelItems}
          onPick={(value) => change({ model: value })}
        />
      )}

      {effortLevels.length > 0 && (
        <ControlMenu
          label={settings.effort ?? 'default effort'}
          title="How much thinking the model is asked for"
          tone="muted"
          items={effortItems}
          onPick={(value) => change({ effort: value as EffortLevel })}
        />
      )}

      <span className="ml-auto">
        {commands.length > 0 && `${commands.length} commands · `}
        Enter sends, shift and enter starts a line.
      </span>
    </div>
  )
}
