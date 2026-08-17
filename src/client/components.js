// client/components.js — React 组件：底栏 StatsDock、设置行（Mode/Pricing/
// Currency/Glass）、设置 → 插件卡片。全部 React.createElement，无 JSX。
import {
  getEnabled, setEnabled, subscribeEnabled,
  getPanelMode, setPanelMode, subscribePanelMode,
  getCurrency, setCurrency, subscribeCurrency,
  getBlurPref, getFrostPref, setBlurPref, setFrostPref, subscribeGlass,
  readCostCache, writeCostCache, scheduleInterval,
  computeSessionCost,
  num, fmtExact, fmtDuration, fmtTps, fmtCost, formatClock,
  foldStats, stepReading, readUsage,
} from './core.js'
import { subscribeLocale, getLocaleRevision, t } from './i18n.js'

// 跟随 DSH 系统语言的 hook：locale 快照 revision 变化（系统语言切换、
// 字典注册）即触发组件重渲染；文案在渲染时经 t() 取当前语言。
function useLocale() {
  return React.useSyncExternalStore(subscribeLocale, getLocaleRevision)
}

function darkTheme() {
  return typeof document !== 'undefined' && document.body !== null
    ? document.body.hasAttribute('data-ds-dark-theme')
    : false
}

// 磨砂玻璃填充 + 模糊都走 CSS 变量，旋钮改动实时生效、无需重渲染：
//   每块面板的 --dsstat-blur / --dsstat-frost（styles.css 中定义）直接绑定
//   本插件「面板玻璃」滑杆（--dsh-dstat-blur / --dsh-dstat-frost）。
function glassStyle() {
  const base = {
    backdropFilter: 'blur(var(--dsstat-blur, 14px)) saturate(1.2)',
    WebkitBackdropFilter: 'blur(var(--dsstat-blur, 14px)) saturate(1.2)',
  }
  if (darkTheme()) {
    return {
      ...base,
      backgroundColor: 'color-mix(in srgb, rgb(42 46 56) calc(50% * var(--dsstat-frost, 1)), transparent)',
      backgroundImage: 'linear-gradient(180deg, color-mix(in srgb, rgb(22 25 34) calc(50% * var(--dsstat-frost, 1)), transparent) 0%, transparent 70%)',
    }
  }
  return {
    ...base,
    backgroundColor: 'color-mix(in srgb, rgb(255 255 255) calc(50% * var(--dsstat-frost, 1)), transparent)',
    backgroundImage: 'linear-gradient(180deg, color-mix(in srgb, rgb(255 255 255) calc(35% * var(--dsstat-frost, 1)), transparent) 0%, transparent 70%)',
  }
}

function row(key, label, value, sub) {
  return React.createElement('div', { className: 'dsstat-row', key },
    React.createElement('span', { className: 'dsstat-k' }, label),
    React.createElement('span', { className: 'dsstat-v' },
      value,
      sub ? React.createElement('span', { className: 'dsstat-s' }, sub) : null,
    ),
  )
}

function divider(key) {
  return React.createElement('div', { className: 'dsstat-divider', key })
}

function heading(key, text, extra) {
  return React.createElement('div', { className: 'dsstat-title', key },
    React.createElement('span', null, text),
    extra ? React.createElement('span', null, extra) : null,
  )
}

export function StatsDock(props) {
  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
  const [leftOpen, setLeftOpen] = React.useState(false)
  const [rightOpen, setRightOpen] = React.useState(false)
  const rootRef = React.useRef(null)
  const panelMode = React.useSyncExternalStore(subscribePanelMode, getPanelMode)
  useLocale()

  // 面板弹出期间把 composerSeat 临时提到「回到底部」按钮（z-8）之上。
  React.useEffect(() => {
    const seat = document.querySelector('[data-composer-seat]')
    if (seat === null) return
    if (leftOpen || rightOpen) {
      seat.style.zIndex = '9'
    } else {
      seat.style.removeProperty('z-index')
    }
  }, [leftOpen, rightOpen])

  // Close both panels on any pointer-down outside this dock's root element.
  React.useEffect(() => {
    if (!leftOpen && !rightOpen) return
    const onPointerDown = (e) => {
      const el = rootRef.current
      if (el === null) return
      if (el.contains(e.target)) return
      setLeftOpen(false)
      setRightOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [leftOpen, rightOpen])

  const session = (typeof props.useSession === 'function' ? props.useSession(s => s) : undefined) || props.session
  const useProjection = typeof props.useProjection === 'function' ? props.useProjection : null
  const usageProjection = useProjection === null ? undefined : useProjection('tokenUsage')
  const statsProjection = useProjection === null ? undefined : useProjection('sessionStats')

  const sessionId = props.sessionId !== undefined && props.sessionId !== null
    ? props.sessionId
    : (session ? session.sessionId : undefined)
  const summary = typeof props.useSessions === 'function'
    ? props.useSessions(st => (st && st.byId && sessionId !== undefined ? st.byId[sessionId] : undefined))
    : undefined

  const nodes = (session && session.chat && session.chat.legacy && session.chat.legacy.nodes)
    || (session && session.nodes)
    || []
  const folded = React.useMemo(() => foldStats(nodes), [nodes])
  const stats = statsProjection || folded
  const usage = React.useMemo(() => readUsage(usageProjection), [usageProjection])

  const billed = usage === null ? 0 : usage.uncached + usage.read + usage.write
  const hitRate = usage !== null && billed > 0 ? Math.round((usage.read / billed) * 100) : null
  const avgTtft = stats.ttftSteps > 0 ? stats.ttftMs / stats.ttftSteps : null
  const tps = stats.decodeMs > 0 ? stats.decodeTokens / (stats.decodeMs / 1000) : null

  const title = summary ? summary.displayTitle : undefined
  const running = summary ? summary.running : undefined
  const clock = summary && typeof summary.updatedAt === 'number' ? formatClock(summary.updatedAt) : null

  // ---- 会话费用（纯客户端）：单行「预估成本 金额 ↻」 ----
  // 打开面板：先显示该会话缓存的上次结果（不闪加载），后台更新成功后
  // 替换显示并写回缓存；更新失败时保留当前显示。
  const [costState, setCostState] = React.useState({ loading: false, data: null, error: null })
  const [costTick, setCostTick] = React.useState(0)
  const currency = React.useSyncExternalStore(subscribeCurrency, getCurrency)

  React.useEffect(() => {
    if (!rightOpen || usage === null) return
    let alive = true
    if (sessionId === undefined) return
    const cached = readCostCache(sessionId)
    if (cached !== null && cached.data && cached.data.currency === currency) {
      setCostState({ loading: false, data: cached.data, error: null })
    } else {
      setCostState((s) => ({ ...s, loading: true }))
    }
    computeSessionCost(nodes, usage, currency)
      .then((res) => {
        if (!alive || !res) return
        if (res.ok === true) {
          writeCostCache(sessionId, res)
          setCostState({ loading: false, data: res, error: null })
        } else {
          setCostState((s) => ({ ...s, loading: false, error: s.data ? null : (res.error || '无响应') }))
        }
      })
      .catch((e) => {
        if (!alive) return
        setCostState((s) => ({ ...s, loading: false, error: s.data ? null : String((e && e.message) || e) }))
      })
    return () => { alive = false }
  }, [rightOpen, sessionId, costTick, currency, nodes, usage])

  // 后台每小时刷新一次当前会话的缓存（即使面板未打开）；启动即刷一次预热。
  React.useEffect(() => {
    if (sessionId === undefined || usage === null) return
    const refresh = () => {
      computeSessionCost(nodes, usage, currency)
        .then((res) => { if (res && res.ok === true) writeCostCache(sessionId, res) })
        .catch(() => { /* 后台失败静默，下小时重试 */ })
    }
    refresh()
    const disposer = scheduleInterval(refresh, 60 * 60 * 1000)
    return () => { if (disposer !== null) disposer() }
  }, [sessionId, currency, nodes, usage])

  const costLine = (() => {
    const data = costState.data
    if (data && data.ok === true) {
      return { value: fmtCost(data.cost.total, data.currency), sub: '' }
    }
    if (data && data.ok === false) {
      const msg = data.error || ''
      // 不在内置价格表的模型：不显示预估价格。
      if (typeof msg === 'string' && msg.indexOf('未知模型价格') === 0) {
        return { value: '—', sub: t('cost.notInTable') }
      }
      return { value: t('cost.unavailable'), sub: msg }
    }
    if (costState.loading) return { value: t('cost.loading'), sub: '' }
    if (costState.error) return { value: t('cost.unavailable'), sub: costState.error }
    return { value: '—', sub: '' }
  })()

  const refreshCost = React.createElement('button', {
    className: 'dsstat-refresh' + (costState.loading ? ' busy' : ''),
    onClick: (e) => { e.stopPropagation(); setCostTick((t) => t + 1) },
    title: t('cost.recalc'),
    'aria-label': t('cost.recalc'),
  }, costState.loading ? '…' : '↻')

  const costSection = React.createElement('div', { className: 'dsstat-cost-line', key: 'cost' },
    React.createElement('span', { className: 'dsstat-cost-label' }, t('cost.label')),
    React.createElement('span', { className: 'dsstat-cost-value' },
      costLine.value,
      costLine.sub
        ? React.createElement('span', { className: 'dsstat-cost-sub' }, costLine.sub)
        : null,
    ),
    refreshCost,
  )

  const onKey = toggle => e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle()
    }
  }

  const glass = panelMode === 'translucent' ? ' dsstat-glass' : ''
  const panelStyle = panelMode === 'translucent' ? glassStyle() : null

  const leftPanel = React.createElement('div', {
    className: 'dsstat-panel dsstat-panel-left' + (leftOpen ? ' open' : '') + glass,
    style: panelStyle,
  },
    heading('h-perf', t('panel.perf')),
    row('llm', t('row.llm'), fmtDuration(stats.llmMs),
      stats.steps > 0 && stats.llmMs > 0 ? t('sub.perStep', { value: fmtDuration(stats.llmMs / stats.steps) }) : ''),
    row('tool', t('row.tool'), fmtDuration(stats.toolMs),
      stats.toolCalls > 0 ? t('sub.calls', { count: stats.toolCalls, value: fmtDuration(stats.toolMs / stats.toolCalls) }) : ''),
    divider('d-brief'),
    heading('h-brief', t('panel.brief')),
    row('title', t('row.title'),
      title === undefined
        ? '—'
        : React.createElement('span', { className: 'dsstat-v dsstat-ellip', title }, title)),
    row('status', t('row.status'), running === undefined ? '—' : (running ? t('status.running') : t('status.idle'))),
    row('update', t('row.updated'), clock === null ? '—' : clock,
      t('sub.turnsSteps', { turns: stats.turns, steps: stats.steps })),
  )

  const tokenRows = usage === null || (billed === 0 && usage.out === 0)
    ? [React.createElement('div', { className: 'dsstat-empty', key: 'empty' }, t('empty.noTokens'))]
    : [
      row('in-hit', t('row.inputHit'), fmtExact(usage.read)),
      row('in-miss', t('row.inputMiss'), fmtExact(usage.uncached + usage.write),
        usage.write > 0 ? t('sub.cacheWrite', { count: fmtExact(usage.write) }) : ''),
      row('out', t('row.output'), fmtExact(usage.out)),
    ]

  const rightPanel = React.createElement('div', {
    className: 'dsstat-panel dsstat-panel-right' + (rightOpen ? ' open' : '') + glass,
    style: panelStyle,
  },
    heading('h-tokens', t('panel.tokens'), t('sub.total')),
    ...tokenRows,
    divider('d-metrics'),
    row('ttft', t('row.ttft'), avgTtft === null ? '—' : fmtDuration(avgTtft), t('sub.avg')),
    row('tps', t('row.tps'), tps === null ? '—' : `${fmtTps(tps)} tok/s`, t('sub.avg')),
    divider('d-cost'),
    costSection,
  )

  const seg = (key, open, onClick, label, value) => React.createElement('div', {
    key,
    role: 'button',
    tabIndex: 0,
    'aria-expanded': open,
    className: 'dsstat-seg' + (open ? ' open' : ''),
    onClick,
    onKeyDown: onKey(onClick),
  },
    React.createElement('span', { className: 'dsstat-label' }, label),
    React.createElement('span', { className: 'dsstat-val' }, value),
    React.createElement('span', { className: 'dsstat-chev' }, open ? '▴' : '▾'),
  )

  // 插件停用时底栏区域留空（官方统计行由本插件占据，不再渲染）。
  if (!enabled) return null

  return React.createElement('div', { className: 'dsstat-root', ref: rootRef },
    seg('seg-steps', leftOpen, () => setLeftOpen(!leftOpen), t('seg.steps'), String(stats.steps)),
    seg('seg-hit', rightOpen, () => setRightOpen(!rightOpen), t('seg.hitRate'), hitRate === null ? '—' : hitRate + '%'),
    leftPanel,
    rightPanel,
  )
}

// Settings row (Settings → General): translucent vs classic panel style.
export function ModeRow() {
  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
  const mode = React.useSyncExternalStore(subscribePanelMode, getPanelMode)
  useLocale()
  const btn = (label, value) => React.createElement('button', {
    className: 'dsstat-mode-btn' + (mode === value ? ' active' : ''),
    onClick: () => setPanelMode(value),
  }, label)
  if (!enabled) return null
  return React.createElement('div', { className: 'dsstat-mode-row' },
    React.createElement('span', { className: 'dsstat-mode-label' }, t('mode.label')),
    React.createElement('div', { className: 'dsstat-mode-seg' },
      btn(t('mode.translucent'), 'translucent'),
      btn(t('mode.classic'), 'classic'),
    ),
  )
}

// Settings row (Settings → General): 内置价格表说明（无外部拉取）。
// 成本按每次消耗的精确时间取峰/谷价：v4-pro / v4-flash 自 2026-08-17
// 起分峰谷（UTC 01–04 与 06–10 为峰，谷为峰价一半），其余模型统一价。
export function PricingRow() {
  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
  useLocale()
  if (!enabled) return null
  return React.createElement('div', { className: 'dsstat-mode-row' },
    React.createElement('span', { className: 'dsstat-mode-label' }, t('pricing.label')),
    React.createElement('div', { className: 'dsstat-mode-seg dsstat-pricing-seg' },
      React.createElement('span', { className: 'dsstat-pricing-text' }, t('pricing.builtin')),
    ),
  )
}

// Settings row (Settings → General): display currency for session cost.
export function CurrencyRow() {
  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
  const currency = React.useSyncExternalStore(subscribeCurrency, getCurrency)
  useLocale()
  const btn = (label, value) => React.createElement('button', {
    className: 'dsstat-mode-btn' + (currency === value ? ' active' : ''),
    onClick: () => setCurrency(value),
  }, label)
  if (!enabled) return null
  return React.createElement('div', { className: 'dsstat-mode-row' },
    React.createElement('span', { className: 'dsstat-mode-label' }, t('currency.label')),
    React.createElement('div', { className: 'dsstat-mode-seg' },
      btn(t('currency.usd'), 'usd'),
      btn(t('currency.cny'), 'cny'),
    ),
  )
}

// Settings row (Settings → General): 面板玻璃模糊度/磨砂度滑杆。
export function GlassRow() {
  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
  const blur = React.useSyncExternalStore(subscribeGlass, getBlurPref)
  const frost = React.useSyncExternalStore(subscribeGlass, getFrostPref)
  useLocale()
  const knob = (label, value, min, max, step, unit, onChange) => React.createElement('div', {
    className: 'dsstat-knob',
    key: label,
  },
    React.createElement('span', { className: 'dsstat-knob-label' }, label),
    React.createElement('input', {
      type: 'range',
      className: 'dsstat-knob-range',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(value),
      onChange: (e) => onChange(Number(e.target.value)),
      'aria-label': label,
    }),
    React.createElement('span', { className: 'dsstat-knob-num' }, String(value) + unit),
  )
  if (!enabled) return null
  return React.createElement('div', { className: 'dsstat-glass-row' },
    React.createElement('div', { className: 'dsstat-glass-head' },
      React.createElement('span', { className: 'dsstat-mode-label' }, t('glass.label')),
    ),
    knob(t('glass.blur'), blur, 0, 40, 0.5, ' px', setBlurPref),
    knob(t('glass.frost'), frost, 0, 100, 1, ' %', setFrostPref),
  )
}

// Settings → Plugins card: master on/off switch (same shape as other plugin cards).
export function PluginCard() {
  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
  useLocale()
  return React.createElement('li', { className: 'dsstat-card' },
    React.createElement('div', { className: 'dsstat-card-head' },
      React.createElement('div', { className: 'dsstat-card-text' },
        React.createElement('div', { className: 'dsstat-card-title' }, 'Simple Dock'),
        React.createElement('div', { className: 'dsstat-card-desc' }, t('card.desc')),
      ),
      React.createElement('button', {
        type: 'button',
        className: 'dsstat-card-toggle',
        'aria-pressed': enabled,
        onClick: () => setEnabled(!enabled),
      },
        React.createElement('span', { className: 'dsstat-card-check' }, enabled ? '✓' : ''),
        enabled ? t('card.on') : t('card.off'),
      ),
    ),
  )
}
