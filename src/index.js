/**
 * Simple Dock node half. Registers the plugin's own settings namespace so the
 * "设置 → 插件" card dispatches by it (the `settings.plugin.item` slot is
 * keyed by the namespace the card edits). The card's enabled state lives in
 * the browser half; this half only serves the namespace key. Everything else
 * stays client-side — no network, no host behavior beyond the registration.
 */
import z from '@deepseek-ai/schemastery'

/**
 * Register the `simple-dock` namespace once the optional settings service is
 * composed. The empty schema means the namespace owns no editable fields —
 * the card stores its state in localStorage; the namespace exists purely so
 * the plugin's card is served and dispatched in Settings → Plugins.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx) {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register('simple-dock', z.object({}))
  })
}
