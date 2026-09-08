// client/index.js — Simple Dock 客户端插件入口：注入样式 + 注册 6 个 slot。
// 依赖：slots 服务（bundle 里由 dsh-client-runtime 提供）+ locale 服务
//（dsh-client-locale，跟随 DSH 系统语言设置，不提供自己的切换按钮）。
import {
  applyGlassVars, getEnabled, subscribeEnabled,
} from './core.js'
import {
  StatsDock, ModeRow, PricingRow, CurrencyRow, GlassRow, PluginCard,
} from './components.js'
import { NS, dicts, setLocaleFace, t } from './i18n.js'
import { css } from './styles.js'

/**
 * Required services: the slot registry plus the locale runtime. Both are
 * inject-declared so Cordis activates this plugin only after they exist:
 * the locale roster row (dsh-client-locale) may apply after this one, and a
 * bare ctx.get('locale') at apply time can then miss it and silently leave
 * every label on the key-string fallback. Injecting 'locale' makes Cordis
 * wait for the service instead.
 */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: inject the stylesheet (plugin-owned style tag, removed
 * with the fiber) and register the composer dock plus the settings surfaces.
 * @param ctx - client root context.
 */
export function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return

  // 跟随 DSH 系统语言：注册字典并把 locale 的 subscribe/getSnapshot/bind
  // 桥给组件（组件用 useSyncExternalStore 订阅 revision 重渲染）。
  const locale = ctx.get('locale')
  if (locale !== undefined) {
    ctx.effect(() => locale.register(NS, dicts), 'simple-dock: dictionaries')
    setLocaleFace(
      (fn) => locale.subscribe(fn),
      () => locale.getSnapshot().revision,
      locale.bind(NS),
    )
  }

  applyGlassVars()

  // Plugin-owned stylesheet: <style data-plugin="…"> is the loader convention;
  // the fiber disposer removes it on unload.
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'dsh-ui-simple-dock')
    style.textContent = css
    document.head.appendChild(style)
    return () => { style.remove() }
  })

  // Composer dock: replaces the official stats line. Official one sits at
  // priority 0; shadowing needs a strictly lower priority (lowest renders).
  // 开关（设置 → 插件卡片）关闭时注销本注册，官方 stats 行恢复显示；
  // 重新开启再注册。StatsDock 内部 enabled=false 返回 null 只是双保险。
  let dockDisposer = null
  // 订阅回调是无参调用（createPref 的 listener 不携带新值），所以这里
  // 不接收参数、直接读当前 pref：停用 → 注销（官方 stats 行恢复显示），
  // 启用 → 重新注册。StatsDock 内部 enabled=false 返回 null 只是双保险。
  const syncDock = () => {
    const on = getEnabled()
    if (on && dockDisposer === null) {
      dockDisposer = slots.inject('conversation.composer.dock', () => slots.register(
        { name: 'conversation.composer.dock', id: 'stats', priority: -1, label: 'stats' },
        (props) => React.createElement(StatsDock, props),
      ))
    } else if (!on && dockDisposer !== null) {
      dockDisposer()
      dockDisposer = null
    }
  }
  ctx.effect(() => {
    syncDock(getEnabled())
    return subscribeEnabled(syncDock)
  })

  // Settings → Plugins: master on/off card (same shape as other plugin cards).
  // This slot is keyed by the settings namespace the card edits; the key must
  // be one the Host serves — the `simple-dock` namespace registered by the
  // node half — or the owner never dispatches the card.
  slots.inject('settings.plugin.item', () => slots.register(
    { name: 'settings.plugin.item', key: 'simple-dock', order: 6, label: 'Simple Dock' },
    () => React.createElement(PluginCard, {}),
  ))

  // Settings → General: four rows (labels follow the system locale).
  slots.inject('settings.general.item', () => slots.register(
    { name: 'settings.general.item', id: 'dstat-mode', order: 12, label: () => t('mode.label') },
    () => React.createElement(ModeRow, {}),
  ))
  slots.inject('settings.general.item', () => slots.register(
    { name: 'settings.general.item', id: 'dstat-pricing', order: 13, label: () => t('pricing.label') },
    () => React.createElement(PricingRow, {}),
  ))
  slots.inject('settings.general.item', () => slots.register(
    { name: 'settings.general.item', id: 'dstat-currency', order: 14, label: () => t('currency.label') },
    () => React.createElement(CurrencyRow, {}),
  ))
  slots.inject('settings.general.item', () => slots.register(
    { name: 'settings.general.item', id: 'dstat-glass', order: 15, label: () => t('glass.label') },
    () => React.createElement(GlassRow, {}),
  ))
}
