// client/components.js — React 组件：底栏 StatsDock、设置行（Mode/Pricing/
// Currency/Glass）、设置 → 插件卡片。全部 React.createElement，无 JSX。
import {
  getEnabled, setEnabled, subscribeEnabled,
  getPanelMode, setPanelMode, subscribePanelMode,
  getCurrency, setCurrency, subscribeCurrency,
  getBlurPref, getFrostPref, setBlurPref, setFrostPref, subscribeGlass,
  getGlassColor, getSolidColor, setGlassColor, setSolidColor, subscribeColors,
  loadSessionCost,
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

// 上下文占用：与官方 ContextMeter 同一份 token-meter 投影，公式一致
//（projectedTokens 优先，回退 pressureTokens；缺上下文窗口时不可用）。
function contextOccupancy(pressure) {
  if (pressure === null || pressure === undefined || typeof pressure !== 'object') return null
  const used = typeof pressure.projectedTokens === 'number' ? pressure.projectedTokens : pressure.pressureTokens
  const window = pressure.contextWindow
  if (typeof used !== 'number' || typeof window !== 'number' || window <= 0) return null
  return { percent: Math.min(100, Math.round(used / window * 100)), used, window }
}

// 上下文面板图例：与官方 ContextMeter 同序、同色（系统提示词 / 工具定义 / 对话消息）。
const CONTEXT_ROWS = [
  { key: 'systemTokens', label: 'context.system', color: 'dsstat-ctx-system' },
  { key: 'toolsTokens', label: 'context.tools', color: 'dsstat-ctx-tools' },
  { key: 'messageTokens', label: 'context.messages', color: 'dsstat-ctx-messages' },
]

// 官方把本地化的占用句子按占位符切开，让读数单独着色而词序仍由语言决定
//（'上下文已用 45%' / '45% of context used'）。
const CONTEXT_READING_SLOT = '\u0000'

// 圆环几何：官方 ContextMeter 同为 14px viewBox、2px 描边、自 12 点方向起画。
const CONTEXT_RING_RADIUS = 5.5
const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS

/** 官方式圆环（track + fill 两段描边）。 */
function ContextRing(props) {
  const ratio = CONTEXT_RING_CIRCUMFERENCE * (props.percent / 100)
  return React.createElement('svg', { viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': true },
    React.createElement('circle', { className: 'dsstat-ctx-track', cx: 7, cy: 7, r: CONTEXT_RING_RADIUS }),
    React.createElement('circle', {
      className: 'dsstat-ctx-fill',
      cx: 7,
      cy: 7,
      r: CONTEXT_RING_RADIUS,
      strokeDasharray: ratio + ' ' + CONTEXT_RING_CIRCUMFERENCE,
      transform: 'rotate(-90 7 7)',
    }),
  )
}

/** 紧凑 token 数（官方同一套 K/M 模板与取整规则）。 */
function formatTokens(value, tr) {
  const scaled = (candidate) => (candidate >= 100
    ? String(Math.round(candidate))
    : String(Math.round(candidate * 10) / 10))
  if (value < 1000) return String(value)
  if (value < 1000000) return tr('number.thousand', { value: scaled(value / 1000) })
  return tr('number.million', { value: scaled(value / 1000000) })
}

// 磨砂玻璃填充 + 模糊都走 CSS 变量，旋钮改动实时生效、无需重渲染：
//   每块面板的 --dsstat-blur / --dsstat-frost（styles.css 中定义）直接绑定
//   本插件「面板玻璃」滑杆（--dsh-dstat-blur / --dsh-dstat-frost）。
function glassStyle() {
  const base = {
    backdropFilter: 'blur(var(--dsstat-blur, 14px)) saturate(1.2)',
    WebkitBackdropFilter: 'blur(var(--dsstat-blur, 14px)) saturate(1.2)',
  }
  // 半透明底色：用户自定义色（--dsh-dstat-glass-color，来自设置 → 背景色）
  // 优先，未设置时按主题给默认值（深色偏冷灰、浅色偏白）。
  const dark = darkTheme()
  const fill = dark ? 'rgb(42 46 56)' : 'rgb(255 255 255)'
  const tint = dark ? 'rgb(22 25 34)' : 'rgb(255 255 255)'
  const fillRatio = dark ? 50 : 50
  const tintRatio = dark ? 50 : 35
  return {
    ...base,
    backgroundColor: `color-mix(in srgb, var(--dsh-dstat-glass-color, ${fill}) calc(${fillRatio}% * var(--dsstat-frost, 1)), transparent)`,
    backgroundImage: `linear-gradient(180deg, color-mix(in srgb, var(--dsh-dstat-glass-color, ${tint}) calc(${tintRatio}% * var(--dsstat-frost, 1)), transparent) 0%, transparent 70%)`,
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
  // 三个面板互斥：同一时刻只有一个 openPanel（'steps' | 'hit' | 'context' | null）。
  const [openPanel, setOpenPanel] = React.useState(null)
  const rootRef = React.useRef(null)
  const panelMode = React.useSyncExternalStore(subscribePanelMode, getPanelMode)
  useLocale()
  const togglePanel = (key) => setOpenPanel((current) => (current === key ? null : key))

  // 面板弹出期间把 composerSeat 临时提到「回到底部」按钮（z-8）之上。
  React.useEffect(() => {
    const seat = document.querySelector('[data-composer-seat]')
    if (seat === null) return
    if (openPanel !== null) {
      seat.style.zIndex = '9'
    } else {
      seat.style.removeProperty('z-index')
    }
  }, [openPanel])

  // 点面板外或按 Esc 关闭当前面板。
  React.useEffect(() => {
    if (openPanel === null) return
    const onPointerDown = (e) => {
      const el = rootRef.current
      if (el === null) return
      if (el.contains(e.target)) return
      setOpenPanel(null)
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpenPanel(null)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [openPanel])
  const leftOpen = openPanel === 'steps'
  const rightOpen = openPanel === 'hit'
  const contextOpen = openPanel === 'context'

  // ---- 数据源（随 DSH 版本演进，双通道防御） ----
  // 新版（0.1.2+）：SessionSnapshot 不再携带会话节点，会话内容走 useChat
  //（ChatSnapshot 选择器，legacy.nodes 为兼容投影，字段与旧版一致）。
  // 旧版：useSession 返回含 chat.legacy.nodes 的大快照。
  const useChat = typeof props.useChat === 'function' ? props.useChat : null
  const chatNodes = useChat === null
    ? undefined
    : useChat(s => (s && s.legacy && Array.isArray(s.legacy.nodes) ? s.legacy.nodes : []))
  const useSession = typeof props.useSession === 'function' ? props.useSession : null
  const session = useSession === null ? props.session : useSession(s => s)
  const useProjection = typeof props.useProjection === 'function' ? props.useProjection : null
  const usageProjection = useProjection === null ? undefined : useProjection('tokenUsage')
  const statsProjection = useProjection === null ? undefined : useProjection('sessionStats')
  const pressureProjection = useProjection === null ? undefined : useProjection('contextPressure')
  const breakdownProjection = useProjection === null ? undefined : useProjection('contextBreakdown')

  const sessionId = props.sessionId !== undefined && props.sessionId !== null
    ? props.sessionId
    : (session ? session.sessionId : undefined)
  const summary = typeof props.useSessions === 'function'
    ? props.useSessions(st => (st && st.byId && sessionId !== undefined ? st.byId[sessionId] : undefined))
    : undefined

  const nodes = chatNodes !== undefined
    ? chatNodes
    : (session && session.chat && session.chat.legacy && session.chat.legacy.nodes)
      || (session && session.nodes)
      || []
  const folded = React.useMemo(() => foldStats(nodes), [nodes])
  const stats = statsProjection || folded
  const usage = React.useMemo(() => readUsage(usageProjection), [usageProjection])

  const billed = usage === null ? 0 : usage.uncached + usage.read + usage.write
  const hitRate = usage !== null && billed > 0 ? Math.round((usage.read / billed) * 100) : null
  // 上下文占用（与官方指示器同源同公式）与其系统/工具/消息分解。
  const context = React.useMemo(() => contextOccupancy(pressureProjection), [pressureProjection])
  const contextBreakdown = breakdownProjection === null || breakdownProjection === undefined
    ? null
    : breakdownProjection
  // 分段占比：整条长度为 provider 精确的百分比，配色部分只按 heuristic 分解
  // 比例分配（官方同款算法）；没有分解数据时退化为单段总占用。
  const contextSegments = (() => {
    if (context === null) return []
    const total = contextBreakdown === null
      ? 0
      : (num(contextBreakdown.systemTokens) ?? 0)
        + (num(contextBreakdown.toolsTokens) ?? 0)
        + (num(contextBreakdown.messageTokens) ?? 0)
    const parts = contextBreakdown === null || total === 0
      ? [{ key: 'total', color: '', width: context.percent }]
      : CONTEXT_ROWS.map(row => ({
        key: row.key,
        color: row.color,
        width: context.percent * ((num(contextBreakdown[row.key]) ?? 0) / total),
      }))
    return parts.filter(part => part.width > 0)
  })()
  // 面板标题左右两截（官方用占位符切分，中文只有前缀、英文两侧都有）。
  const contextHeadline = context === null
    ? ['', '']
    : t('context.aria', { percent: CONTEXT_READING_SLOT }).split(CONTEXT_READING_SLOT).map(part => part.trim())
  const avgTtft = stats.ttftSteps > 0 ? stats.ttftMs / stats.ttftSteps : null
  const tps = stats.decodeMs > 0 ? stats.decodeTokens / (stats.decodeMs / 1000) : null

  const title = summary ? summary.displayTitle : undefined
  const running = summary ? summary.running : undefined
  const clock = summary && typeof summary.updatedAt === 'number' ? formatClock(summary.updatedAt) : null

  // ---- 会话费用：单行「预估成本 金额 ↻」 ----
  // host 半区维护成本（启动预算 + 新步增量 + 每步写回会话记录），这里只读
  // 结果；端点不可用时回退到页面节点计价。↻ 强制 host 重算该会话。
  const [costState, setCostState] = React.useState({ loading: false, data: null, error: null })
  const [costTick, setCostTick] = React.useState(0)
  const forceRefresh = React.useRef(false)
  const currency = React.useSyncExternalStore(subscribeCurrency, getCurrency)

  React.useEffect(() => {
    if (!rightOpen || usage === null) return
    if (sessionId === undefined) return
    let alive = true
    const refresh = forceRefresh.current
    forceRefresh.current = false
    setCostState((s) => ({ ...s, loading: true }))
    loadSessionCost(sessionId, nodes, usage, currency, refresh)
      .then((res) => {
        if (!alive) return
        if (res && res.ok === true) setCostState({ loading: false, data: res, error: null })
        else setCostState((s) => ({ loading: false, data: s.data, error: (res && res.error) || '无响应' }))
      })
      .catch((e) => {
        if (!alive) return
        setCostState((s) => ({ loading: false, data: s.data, error: String((e && e.message) || e) }))
      })
    return () => { alive = false }
  }, [rightOpen, sessionId, costTick, currency, nodes, usage])

  const costLine = (() => {
    const data = costState.data
    if (data && data.ok === true) {
      // 全部步都不在内置价格表：不显示金额。
      if (data.steps === 0 && data.unpriced > 0) return { value: '—', sub: t('cost.notInTable') }
      const pick = data.totals && (data.totals[currency] || data.totals.usd || data.totals.cny)
      return { value: pick ? fmtCost(pick.total, data.currency || currency) : '—', sub: '' }
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
    onClick: (e) => { e.stopPropagation(); forceRefresh.current = true; setCostTick((t) => t + 1) },
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

  // 上下文面板：内容与视觉完全照官方 ContextMeter 的展开面板（标题行 + 占比条
  // + 图例行），只有**背景/边框/阴影**换成我们自己的面板样式（传统实底或
  // 半透明玻璃，跟随背景色与玻璃滑杆设置）。
  const contextPanel = context === null ? null : React.createElement('div', {
    className: 'dsstat-panel dsstat-panel-right dsstat-ctx-panel' + (contextOpen ? ' open' : '') + glass,
    style: panelStyle,
    role: 'dialog',
    'aria-label': t('context.used'),
  },
    React.createElement('div', { className: 'dsstat-ctx-header' },
      React.createElement('span', { className: 'dsstat-ctx-headline' }, contextHeadline[0] ?? ''),
      React.createElement('span', { className: 'dsstat-ctx-percent' }, context.percent + '%'),
      React.createElement('span', { className: 'dsstat-ctx-headline' }, contextHeadline[1] ?? ''),
      React.createElement('span', { className: 'dsstat-ctx-figures' },
        '~' + formatTokens(context.used, t) + ' / ' + formatTokens(context.window, t)),
    ),
    React.createElement('div', { className: 'dsstat-ctx-bar' },
      ...contextSegments.map(part => React.createElement('div', {
        key: part.key,
        className: 'dsstat-ctx-segment' + (part.color === '' ? '' : ' ' + part.color),
        style: { width: part.width + '%' },
      })),
    ),
    contextBreakdown === null ? null : React.createElement('dl', { className: 'dsstat-ctx-rows' },
      ...CONTEXT_ROWS.map(item => React.createElement('div', { className: 'dsstat-ctx-row', key: item.key },
        React.createElement('dt', null,
          React.createElement('span', { className: 'dsstat-ctx-swatch ' + item.color, 'aria-hidden': true }),
          t(item.label),
        ),
        React.createElement('dd', null, '~' + formatTokens(num(contextBreakdown[item.key]) ?? 0, t)),
      )),
    ),
  )

  // 底栏按钮：箭头（▾/▴）已去掉，只留标签 + 数值；开合状态靠 aria-expanded
  // 与展开底色表达。上下文按钮另走官方 trigger 样式（圆环 + 百分比）。
  const seg = (key, panelKey, open, label, value) => React.createElement('div', {
    key,
    role: 'button',
    tabIndex: 0,
    'aria-expanded': open,
    className: 'dsstat-seg' + (open ? ' open' : ''),
    onClick: () => togglePanel(panelKey),
    onKeyDown: onKey(() => togglePanel(panelKey)),
  },
    React.createElement('span', { className: 'dsstat-label' }, label),
    React.createElement('span', { className: 'dsstat-val' }, value),
  )

  const contextButton = context === null ? null : React.createElement('button', {
    type: 'button',
    className: 'dsstat-ctx-trigger' + (contextOpen ? ' open' : ''),
    'aria-haspopup': 'dialog',
    'aria-expanded': contextOpen,
    'aria-label': t('context.aria', { percent: context.percent + '%' }),
    title: t('context.aria', { percent: context.percent + '%' }),
    onClick: () => togglePanel('context'),
  },
    React.createElement(ContextRing, { percent: context.percent }),
    React.createElement('span', null, context.percent + '%'),
  )

  // 插件停用时底栏区域留空（官方统计行由本插件占据，不再渲染）。
  if (!enabled) return null

  // 布局：步数在最左；命中率与上下文包成右侧一组（两组分开，右侧两块相邻）。
  return React.createElement('div', { className: 'dsstat-root' + glass, ref: rootRef },
    seg('seg-steps', 'steps', leftOpen, t('seg.steps'), String(stats.steps)),
    React.createElement('div', { className: 'dsstat-right-group' },
      seg('seg-hit', 'hit', rightOpen, t('seg.hitRate'), hitRate === null ? '—' : hitRate + '%'),
      contextButton,
    ),
    leftPanel,
    rightPanel,
    contextPanel,
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

// Settings → General: 底栏统计坞总开关（与插件卡片同一个偏好）。
// 与其他设置行不同，这一行**在停用时也要渲染**，否则关掉后再也开不回来；
// 切换是即时的：停用即注销本插件的底栏注册，官方统计行自动回位。
export function EnabledRow() {
  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
  useLocale()
  return React.createElement('div', { className: 'dsstat-enabled-row' },
    React.createElement('div', { className: 'dsstat-enabled-text' },
      React.createElement('div', { className: 'dsstat-enabled-label' }, t('enabled.label')),
      React.createElement('div', { className: 'dsstat-enabled-desc' }, t('enabled.desc')),
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

// Settings → General: 背景色 —— 半透明模式与传统模式各一个取色器，未设置时
// 跟随主题（按钮变为可用状态即可恢复默认）。
export function ColorRow() {
  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
  const glassColor = React.useSyncExternalStore(subscribeColors, getGlassColor)
  const solidColor = React.useSyncExternalStore(subscribeColors, getSolidColor)
  useLocale()
  // 只有两个取色窗格：半透明模式 / 传统模式。未选色时窗格以白色为起点
  //（面板此时仍跟随主题默认），选色后固定使用所选颜色；控件是设置页风格的
  // 小圆角色块 + 十六进制值，而不是原生的大黑块。
  const picker = (key, label, value, onChange) => {
    const shown = value === '' ? '#ffffff' : value
    return React.createElement('div', { className: 'dsstat-color-item', key },
      React.createElement('span', { className: 'dsstat-knob-label' }, label),
      React.createElement('input', {
        type: 'color',
        className: 'dsstat-color-input',
        value: shown,
        onChange: (e) => onChange(e.target.value),
        'aria-label': label,
      }),
      React.createElement('span', { className: 'dsstat-color-value' }, shown.toUpperCase()),
    )
  }
  if (!enabled) return null
  return React.createElement('div', { className: 'dsstat-color-row' },
    React.createElement('span', { className: 'dsstat-mode-label' }, t('color.label')),
    React.createElement('div', { className: 'dsstat-color-items' },
      picker('glass', t('color.glass'), glassColor, setGlassColor),
      picker('solid', t('color.solid'), solidColor, setSolidColor),
    ),
  )
}

// Settings → Simple Dock 独立设置区：把所有设置集中在一页（通用设置里不再
// 散落我们的行）。各行组件自带 disabled 处理（总开关行除外，它必须始终可点）。
export function SettingsSection() {
  useLocale()
  return React.createElement('div', { className: 'dsstat-section' },
    React.createElement('div', { className: 'dsstat-section-head' },
      React.createElement('div', { className: 'dsstat-section-title' }, 'Simple Dock'),
      React.createElement('div', { className: 'dsstat-section-desc' }, t('card.desc')),
    ),
    React.createElement('div', { className: 'dsstat-section-body' },
      React.createElement(EnabledRow, {}),
      React.createElement(ModeRow, {}),
      React.createElement(GlassRow, {}),
      React.createElement(ColorRow, {}),
      React.createElement(CurrencyRow, {}),
      React.createElement(PricingRow, {}),
    ),
  )
}

// Settings → Plugins card: master on/off switch. Two owners render it: the
// Settings → Plugins tab (`settings.plugins.tab`, no view prop) and the
// Plugins page's keyed bundle config (`plugins.bundle.config`, which asks for a
// `summary` one-liner and a `page` body).
export function PluginCard(props) {
  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
  useLocale()
  if (props !== null && props !== undefined && props.view === 'summary') {
    return React.createElement('span', { className: 'dsstat-card-summary' },
      t(enabled ? 'card.summary.on' : 'card.summary.off'))
  }
  return React.createElement('div', { className: 'dsstat-card' },
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
