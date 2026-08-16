// client/components.js — React 组件：底栏 StatsDock、设置行（Mode/Pricing/
// Currency/Glass）、设置 → 插件卡片。全部 React.createElement，无 JSX。
import {
  getEnabled, setEnabled, subscribeEnabled,
  getPanelMode, setPanelMode, subscribePanelMode,
  getCurrency, setCurrency, subscribeCurrency,
  getBlurPref, getFrostPref, setBlurPref, setFrostPref, subscribeGlass,
  readCostCache, writeCostCache, scheduleInterval, syncPrices,
  computeSessionCost,
  num, fmtExact, fmtDuration, fmtTps, fmtCost, formatClock,
  foldStats, stepReading, readUsage,
} from './core.js'

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
      // 非 DeepSeek 模型：不显示预估价格。
      if (typeof msg === 'string' && msg.indexOf('未知模型价格') === 0) {
        return { value: '—', sub: '非 DeepSeek 模型，不估算费用' }
      }
      return { value: '不可用', sub: msg }
    }
    if (costState.loading) return { value: '加载中…', sub: '' }
    if (costState.error) return { value: '不可用', sub: costState.error }
    return { value: '—', sub: '' }
  })()

  const refreshCost = React.createElement('button', {
    className: 'dsstat-refresh' + (costState.loading ? ' busy' : ''),
    onClick: (e) => { e.stopPropagation(); setCostTick((t) => t + 1) },
    title: '刷新价格表与成本',
    'aria-label': '刷新成本',
  }, costState.loading ? '…' : '↻')

  const costSection = React.createElement('div', { className: 'dsstat-cost-line', key: 'cost' },
    React.createElement('span', { className: 'dsstat-cost-label' }, '预估成本'),
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
    heading('h-perf', '性能'),
    row('llm', 'LLM 耗时', fmtDuration(stats.llmMs), stats.steps > 0 && stats.llmMs > 0 ? `均 ${fmtDuration(stats.llmMs / stats.steps)}/步` : ''),
    row('tool', '工具耗时', fmtDuration(stats.toolMs), stats.toolCalls > 0 ? `${stats.toolCalls} 次 · 均 ${fmtDuration(stats.toolMs / stats.toolCalls)}/次` : ''),
    divider('d-brief'),
    heading('h-brief', '简报'),
    row('title', '会话标题',
      title === undefined
        ? '—'
        : React.createElement('span', { className: 'dsstat-v dsstat-ellip', title }, title)),
    row('status', '状态', running === undefined ? '—' : (running ? '进行中' : '空闲')),
    row('update', '最近更新', clock === null ? '—' : clock, `第 ${stats.turns} 轮 · 共 ${stats.steps} 步`),
  )

  const tokenRows = usage === null || (billed === 0 && usage.out === 0)
    ? [React.createElement('div', { className: 'dsstat-empty', key: 'empty' }, '暂无 token 数据')]
    : [
      row('in-hit', '输入（命中）', fmtExact(usage.read)),
      row('in-miss', '输入（未命中）', fmtExact(usage.uncached + usage.write),
        usage.write > 0 ? `含缓存写入 ${fmtExact(usage.write)}` : ''),
      row('out', '输出', fmtExact(usage.out)),
    ]

  const rightPanel = React.createElement('div', {
    className: 'dsstat-panel dsstat-panel-right' + (rightOpen ? ' open' : '') + glass,
    style: panelStyle,
  },
    heading('h-tokens', 'Token 明细', '累计'),
    ...tokenRows,
    divider('d-metrics'),
    row('ttft', '首 token 时间', avgTtft === null ? '—' : fmtDuration(avgTtft), '平均'),
    row('tps', '生成速度', tps === null ? '—' : `${fmtTps(tps)} tok/s`, '平均'),
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
    seg('seg-steps', leftOpen, () => setLeftOpen(!leftOpen), '步数', String(stats.steps)),
    seg('seg-hit', rightOpen, () => setRightOpen(!rightOpen), '命中率', hitRate === null ? '—' : hitRate + '%'),
    leftPanel,
    rightPanel,
  )
}

// Settings row (Settings → General): translucent vs classic panel style.
export function ModeRow() {
  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
  const mode = React.useSyncExternalStore(subscribePanelMode, getPanelMode)
  const btn = (label, value) => React.createElement('button', {
    className: 'dsstat-mode-btn' + (mode === value ? ' active' : ''),
    onClick: () => setPanelMode(value),
  }, label)
  if (!enabled) return null
  return React.createElement('div', { className: 'dsstat-mode-row' },
    React.createElement('span', { className: 'dsstat-mode-label' }, '底栏面板样式'),
    React.createElement('div', { className: 'dsstat-mode-seg' },
      btn('半透明', 'translucent'),
      btn('传统', 'classic'),
    ),
  )
}

// Settings row (Settings → General): real-time price table status + refresh.
export function PricingRow() {
  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
  const [state, setState] = React.useState({ loading: false, text: '—' })
  const run = (force) => {
    setState((s) => ({ ...s, loading: true }))
    Promise.resolve()
      .then(() => syncPrices(force))
      .then((res) => {
        if (!res) { setState({ loading: false, text: '无响应' }); return }
        if (res.source === 'models.dev') {
          const when = res.syncedAt ? formatClock(res.syncedAt) : '—'
          const extra = res.error ? ' · ' + res.error : ''
          setState({ loading: false, text: `models.dev 实时同步 · ${when}${extra}` })
        } else if (res.error) {
          setState({ loading: false, text: `内置表（同步失败: ${res.error}）` })
        } else {
          setState({ loading: false, text: '内置表' })
        }
      })
      .catch((e) => setState({ loading: false, text: '不可用: ' + String((e && e.message) || e) }))
  }
  React.useEffect(() => { run(false) }, [])
  if (!enabled) return null
  return React.createElement('div', { className: 'dsstat-mode-row' },
    React.createElement('span', { className: 'dsstat-mode-label' }, '价格表（实时）'),
    React.createElement('div', { className: 'dsstat-mode-seg dsstat-pricing-seg' },
      React.createElement('span', { className: 'dsstat-pricing-text' }, state.text),
      React.createElement('button', {
        className: 'dsstat-mode-btn' + (state.loading ? ' active' : ''),
        onClick: () => run(true),
      }, state.loading ? '…' : '刷新'),
    ),
  )
}

// Settings row (Settings → General): display currency for session cost.
export function CurrencyRow() {
  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
  const currency = React.useSyncExternalStore(subscribeCurrency, getCurrency)
  const btn = (label, value) => React.createElement('button', {
    className: 'dsstat-mode-btn' + (currency === value ? ' active' : ''),
    onClick: () => setCurrency(value),
  }, label)
  if (!enabled) return null
  return React.createElement('div', { className: 'dsstat-mode-row' },
    React.createElement('span', { className: 'dsstat-mode-label' }, '成本计价币种'),
    React.createElement('div', { className: 'dsstat-mode-seg' },
      btn('美元 USD', 'usd'),
      btn('人民币 CNY', 'cny'),
    ),
  )
}

// Settings row (Settings → General): 面板玻璃模糊度/磨砂度滑杆。
export function GlassRow() {
  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
  const blur = React.useSyncExternalStore(subscribeGlass, getBlurPref)
  const frost = React.useSyncExternalStore(subscribeGlass, getFrostPref)
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
      React.createElement('span', { className: 'dsstat-mode-label' }, '面板玻璃'),
    ),
    knob('模糊度', blur, 0, 40, 0.5, ' px', setBlurPref),
    knob('磨砂度', frost, 0, 100, 1, ' %', setFrostPref),
  )
}

// Settings → Plugins card: master on/off switch (same shape as other plugin cards).
export function PluginCard() {
  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
  return React.createElement('li', { className: 'dsstat-card' },
    React.createElement('div', { className: 'dsstat-card-head' },
      React.createElement('div', { className: 'dsstat-card-text' },
        React.createElement('div', { className: 'dsstat-card-title' }, 'Simple Dock'),
        React.createElement('div', { className: 'dsstat-card-desc' }, '底栏统计坞：性能 / 简报 / Token 明细 / 预估成本'),
      ),
      React.createElement('button', {
        type: 'button',
        className: 'dsstat-card-toggle',
        'aria-pressed': enabled,
        onClick: () => setEnabled(!enabled),
      },
        React.createElement('span', { className: 'dsstat-card-check' }, enabled ? '✓' : ''),
        enabled ? '已启用' : '已停用',
      ),
    ),
  )
}
