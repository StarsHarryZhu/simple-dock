// client/core.js — 偏好（localStorage + 订阅，工厂消除重复三件套）、
// 展示格式化、快照派生。全部为可独立测试的纯逻辑（除 DOM 相关偏好）。

const PANEL_MODE_KEY = 'dsh.dstat.panel.mode'
const CURRENCY_KEY = 'dsh.dstat.currency'
const BLUR_KEY = 'dsh.dstat.blur'
const FROST_KEY = 'dsh.dstat.frost'

function safeRead(key) {
  try {
    return window.localStorage.getItem(key)
  } catch (e) {
    return null
  }
}

function safeWrite(key, value) {
  try {
    window.localStorage.setItem(key, value)
  } catch (e) {
    // Storage unavailable (private mode): the in-memory fallback still works.
  }
}

// 偏好工厂：localStorage 持久化 + 订阅。validate 返回 undefined 表示拒绝写入。
function createPref(key, read, validate) {
  let value = read()
  const listeners = new Set()
  return {
    get: () => value,
    set: (next) => {
      const v = validate(next)
      if (v === undefined || v === value) return
      value = v
      safeWrite(key, String(v))
      for (const fn of listeners) fn()
    },
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}

// 数值偏好：读时 clamp 到 [min, max]。注意 Number(null) === 0，键缺失
// 时必须走 fallback（否则全新浏览器默认变成 0 而非 14px / 50%）。
function createNumberPref(key, fallback, min, max) {
  return createPref(key,
    () => {
      const raw = safeRead(key)
      const n = Number(raw)
      return raw !== null && raw !== '' && Number.isFinite(n)
        ? Math.min(max, Math.max(min, n))
        : fallback
    },
    (v) => {
      const n = Number(v)
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined
    })
}

// ---- 偏好实例 ----
// 底栏面板样式：默认半透明；仅显式存储 'classic' 才选传统。
const panelMode = createPref(PANEL_MODE_KEY,
  () => (safeRead(PANEL_MODE_KEY) === 'classic' ? 'classic' : 'translucent'),
  (v) => (v === 'translucent' || v === 'classic' ? v : undefined))
// 计价币种：默认美元。
const currency = createPref(CURRENCY_KEY,
  () => (safeRead(CURRENCY_KEY) === 'cny' ? 'cny' : 'usd'),
  (v) => (v === 'usd' || v === 'cny' ? v : undefined))
// 面板玻璃：默认 14px / 50。50 → 1.0 倍 alpha（frost/50，上限 1.4）。
// 展开面板的 --dsstat-* 变量链直接绑定这两个值（见 styles.css），
// 拖动滑杆实时修改明细面板背景。
const blurPref = createNumberPref(BLUR_KEY, 14, 0, 40)
const frostPref = createNumberPref(FROST_KEY, 50, 0, 100)

const getPanelMode = () => panelMode.get()
const setPanelMode = (v) => panelMode.set(v)
const subscribePanelMode = (fn) => panelMode.subscribe(fn)
const getCurrency = () => currency.get()
const setCurrency = (v) => currency.set(v)
const subscribeCurrency = (fn) => currency.subscribe(fn)
const getBlurPref = () => blurPref.get()
const getFrostPref = () => frostPref.get()
function setBlurPref(v) {
  blurPref.set(v)
  applyGlassVars()
}
function setFrostPref(v) {
  frostPref.set(v)
  applyGlassVars()
}
// 任一玻璃旋钮变化都通知（GlassRow 两个滑杆共用）。
function subscribeGlass(fn) {
  const off1 = blurPref.subscribe(fn)
  const off2 = frostPref.subscribe(fn)
  return () => { off1(); off2() }
}

// 把自定义玻璃值写到 <html>（面板 --dsstat-* 变量链消费）。
function applyGlassVars() {
  if (typeof document === 'undefined' || document.documentElement === null) return
  const style = document.documentElement.style
  style.setProperty('--dsh-dstat-blur', blurPref.get() + 'px')
  style.setProperty('--dsh-dstat-frost', String(Math.min(frostPref.get() / 50, 1.4)))
}

// ---- 预估成本缓存：按会话持久化（localStorage）。打开面板先显示缓存、
// 后台更新后替换；插件运行期间后台每小时刷新一次（见 components.js）。 ----
const COST_CACHE_PREFIX = 'dsh.dstat.cost.'

function readCostCache(sessionId) {
  try {
    const raw = window.localStorage.getItem(COST_CACHE_PREFIX + sessionId)
    if (raw === null) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.data) return null
    return parsed
  } catch (e) {
    return null
  }
}

function writeCostCache(sessionId, data) {
  try {
    window.localStorage.setItem(COST_CACHE_PREFIX + sessionId, JSON.stringify({ data, fetchedAt: Date.now() }))
  } catch (e) {
    // Storage unavailable (private mode): the in-memory fallback still works.
  }
}

// ---- timer 服务绑定：动态 client 半区无浏览器 timer 全局（setInterval 等），
// 必须使用 Cordis timer 服务（插件声明 inject: ['timer']，入口 apply 时绑定）。
let timerSvc = null

function bindTimerService(t) {
  timerSvc = t
}

// 周期性调度；返回 disposer（timer 服务不可用时返回 null，调用方降级）。
function scheduleInterval(callback, delayMs) {
  return timerSvc !== null && typeof timerSvc.interval === 'function'
    ? timerSvc.interval(callback, delayMs)
    : null
}

// ---- 展示格式化 ----
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
}

function fmtExact(n) {
  if (!(n >= 0)) return '—'
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function fmtDuration(ms) {
  if (!(ms >= 0)) return '—'
  const s = ms / 1000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

function fmtTps(tps) {
  if (!(tps >= 0)) return '—'
  return tps >= 10 ? String(Math.round(tps)) : String(Math.round(tps * 10) / 10)
}

function fmtCost(value, currency) {
  if (!(typeof value === 'number' && Number.isFinite(value)) || value < 0) return '—'
  const symbol = currency === 'cny' ? '¥' : '$'
  const digits = value >= 1 ? 2 : value > 0 ? 4 : 2
  const text = value.toFixed(digits).replace(/\.?0+$/, '')
  return symbol + text
}

function pad2(v) {
  return v < 10 ? '0' + v : String(v)
}

function formatClock(ms) {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// ---- 快照派生（无投影时的手算兜底，字段与官方投影一致） ----
function stepReading(node) {
  const timing = node.timing
  const ttftMs = timing !== undefined && timing.stepStartTime !== null && timing.firstTokenTime !== null
    ? Math.max(0, timing.firstTokenTime - timing.stepStartTime)
    : null
  const decodeMs = timing !== undefined && timing.firstTokenTime !== null
    ? Math.max(0, timing.completedTime - timing.firstTokenTime)
    : null
  const usage = node.usage
  const outputTokens = usage !== undefined && usage !== null && typeof usage === 'object'
    ? num(usage.outputTokens)
    : null
  return { ttftMs, decodeMs, outputTokens }
}

function foldStats(nodes) {
  const turns = new Set()
  let steps = 0
  let llmMs = 0
  let toolMs = 0
  let toolCalls = 0
  let ttftMs = 0
  let ttftSteps = 0
  let decodeMs = 0
  let decodeTokens = 0
  for (const node of nodes) {
    if (node.kind === 'tool-result') {
      toolCalls += 1
      if (typeof node.callTime === 'number') toolMs += Math.max(0, node.time - node.callTime)
      continue
    }
    if (node.kind !== 'assistant') continue
    turns.add(node.turn)
    steps += 1
    const timing = node.timing
    if (timing !== undefined && timing.stepStartTime !== null) {
      llmMs += Math.max(0, timing.completedTime - timing.stepStartTime)
    }
    const reading = stepReading(node)
    if (reading.ttftMs !== null) {
      ttftMs += reading.ttftMs
      ttftSteps += 1
    }
    if (reading.decodeMs !== null && reading.outputTokens !== null) {
      decodeMs += reading.decodeMs
      decodeTokens += reading.outputTokens
    }
  }
  return { turns: turns.size, steps, llmMs, toolMs, toolCalls, ttftMs, ttftSteps, decodeMs, decodeTokens }
}

function readUsage(u) {
  if (u === undefined || u === null || typeof u !== 'object') return null
  const get = k => {
    const v = u[k]
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
  }
  return { uncached: get('uncachedInputTokens'), out: get('outputTokens'), read: get('cacheReadTokens'), write: get('cacheWriteTokens') }
}
// client/components.js — React 组件：底栏 StatsDock + 设置行（Mode/Pricing/Currency/Glass）。
//
// 组件只依赖 core（偏好/格式化/派生）与 evaluator 注入的 React 全局。
// 新增一个设置行 = 写一个 Row 组件 + 在 index.js 注册一行 slot。


function darkTheme() {
  return typeof document !== 'undefined' && document.body !== null
    ? document.body.hasAttribute('data-ds-dark-theme')
    : false
}

// 磨砂玻璃填充 + 模糊都走 CSS 变量，旋钮改动实时生效、无需重渲染：
//   每块面板的 --dsstat-blur / --dsstat-frost（styles.css 中定义）直接绑定
//   本插件「面板玻璃」滑杆（--dsh-dstat-blur / --dsh-dstat-frost）。内联
//   样式仍保留：这是 VSCode 内嵌浏览器里验证过的可靠机制；inline 值里的
//   var() 会按元素计算后的自定义属性解析，所以变量链照样生效。
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

function StatsDock(props) {
  const [leftOpen, setLeftOpen] = React.useState(false)
  const [rightOpen, setRightOpen] = React.useState(false)
  const rootRef = React.useRef(null)
  const panelMode = React.useSyncExternalStore(subscribePanelMode, getPanelMode)

  // 面板弹出期间把 composerSeat 临时提到「回到底部」按钮（z-8）之上：
  // 明细面板的 z-index 只在 composerSeat（z-7）的层叠上下文内有效，永远
  // 压不过同级 z-8 的按钮；提升 seat 后面板盖住按钮，重叠区不再被按钮
  // 遮挡，按钮其余部分照常可用。关闭面板即恢复。
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

  // ---- 会话费用（Host 半区）：单行「预估成本 金额 ↻」 ----
  // 打开面板：先显示该会话缓存的上次结果（不闪加载），后台更新成功后
  // 替换显示并写回缓存；更新失败时保留当前显示。
  const [costState, setCostState] = React.useState({ loading: false, data: null, error: null })
  const [costTick, setCostTick] = React.useState(0)
  const currency = React.useSyncExternalStore(subscribeCurrency, getCurrency)
  const hasHostCall = typeof host !== 'undefined' && host !== null && typeof host.call === 'function'

  React.useEffect(() => {
    if (!rightOpen || !hasHostCall) return
    let alive = true
    if (sessionId === undefined) return
    const cached = readCostCache(sessionId)
    if (cached !== null && cached.data && cached.data.currency === currency) {
      setCostState({ loading: false, data: cached.data, error: null })
    } else {
      setCostState((s) => ({ ...s, loading: true }))
    }
    Promise.resolve()
      .then(() => host.call('dstat.sessionCost', { sessionId, currency }))
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
  }, [rightOpen, sessionId, costTick, currency])

  // 后台每小时刷新一次当前会话的缓存（即使面板未打开）；启动即刷一次预热。
  // 定时器走 Cordis timer 服务（动态 client 半区无 setInterval 全局），
  // disposer 在 effect cleanup 中调用。
  React.useEffect(() => {
    if (!hasHostCall || sessionId === undefined) return
    const refresh = () => {
      Promise.resolve()
        .then(() => host.call('dstat.sessionCost', { sessionId, currency }))
        .then((res) => { if (res && res.ok === true) writeCostCache(sessionId, res) })
        .catch(() => { /* 后台失败静默，下小时重试 */ })
    }
    refresh()
    const disposer = scheduleInterval(refresh, 60 * 60 * 1000)
    return () => { if (disposer !== null) disposer() }
  }, [sessionId, currency, hasHostCall])

  const costLine = (() => {
    const data = costState.data
    if (data && data.ok === true && data.records > 0) {
      return { value: fmtCost(data.cost.total, data.currency), sub: '' }
    }
    if (data && data.ok === false) {
      const msg = data.error || ''
      // 非 DeepSeek 模型：不显示预估价格（需求约定）。
      if (typeof msg === 'string' && msg.indexOf('未知模型价格') === 0) {
        return { value: '—', sub: '非 DeepSeek 模型，不估算费用' }
      }
      return { value: '不可用', sub: msg }
    }
    if (costState.loading) return { value: '加载中…', sub: '' }
    if (costState.error) return { value: '不可用', sub: costState.error }
    if (data && data.records === 0) {
      return { value: '暂无数据', sub: `来源 ${data.usageSource || '—'} · 事件 ${data.eventCount ?? 0} 条` }
    }
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

  return React.createElement('div', { className: 'dsstat-root', ref: rootRef },
    seg('seg-steps', leftOpen, () => setLeftOpen(!leftOpen), '步数', String(stats.steps)),
    seg('seg-hit', rightOpen, () => setRightOpen(!rightOpen), '命中率', hitRate === null ? '—' : hitRate + '%'),
    leftPanel,
    rightPanel,
  )
}

// Settings row (Settings → General): translucent vs classic panel style.
function ModeRow() {
  const mode = React.useSyncExternalStore(subscribePanelMode, getPanelMode)
  const btn = (label, value) => React.createElement('button', {
    className: 'dsstat-mode-btn' + (mode === value ? ' active' : ''),
    onClick: () => setPanelMode(value),
  }, label)
  return React.createElement('div', { className: 'dsstat-mode-row' },
    React.createElement('span', { className: 'dsstat-mode-label' }, '底栏面板样式'),
    React.createElement('div', { className: 'dsstat-mode-seg' },
      btn('半透明', 'translucent'),
      btn('传统', 'classic'),
    ),
  )
}

// Settings row (Settings → General): real-time price table status + refresh.
function PricingRow() {
  const [state, setState] = React.useState({ loading: false, text: '—' })
  const run = (force) => {
    if (typeof host === 'undefined' || host === null || typeof host.call !== 'function') {
      setState({ loading: false, text: 'Host 半区不可用' })
      return
    }
    setState((s) => ({ ...s, loading: true }))
    Promise.resolve()
      .then(() => host.call('dstat.pricing', { force }))
      .then((res) => {
        if (!res) { setState({ loading: false, text: '无响应' }); return }
        if (res.source === 'models.dev') {
          const when = res.syncedAt ? formatClock(res.syncedAt) : '—'
          const extra = res.error ? ' · ' + res.error : ''
          const via = res.transport === 'shell' ? '（curl）' : ''
          setState({ loading: false, text: `models.dev 实时同步${via} · ${when}${extra}` })
        } else if (res.error) {
          setState({ loading: false, text: `内置表（同步失败: ${res.error}）` })
        } else {
          setState({ loading: false, text: '内置表' })
        }
      })
      .catch((e) => setState({ loading: false, text: '不可用: ' + String((e && e.message) || e) }))
  }
  React.useEffect(() => { run(false) }, [])
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
function CurrencyRow() {
  const currency = React.useSyncExternalStore(subscribeCurrency, getCurrency)
  const btn = (label, value) => React.createElement('button', {
    className: 'dsstat-mode-btn' + (currency === value ? ' active' : ''),
    onClick: () => setCurrency(value),
  }, label)
  return React.createElement('div', { className: 'dsstat-mode-row' },
    React.createElement('span', { className: 'dsstat-mode-label' }, '成本计价币种'),
    React.createElement('div', { className: 'dsstat-mode-seg' },
      btn('美元 USD', 'usd'),
      btn('人民币 CNY', 'cny'),
    ),
  )
}

// Settings row (Settings → General): 面板玻璃模糊度/磨砂度滑杆。
function GlassRow() {
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
  return React.createElement('div', { className: 'dsstat-glass-row' },
    React.createElement('div', { className: 'dsstat-glass-head' },
      React.createElement('span', { className: 'dsstat-mode-label' }, '面板玻璃'),
    ),
    knob('模糊度', blur, 0, 40, 0.5, ' px', setBlurPref),
    knob('磨砂度', frost, 0, 100, 1, ' %', setFrostPref),
  )
}
const css = `/* client/styles.css — Simple Dock 全部样式。构建时由 build.js 注入为
   styles.insert 的模板字符串；类名使用 dsstat- 前缀避免与宿主冲突。 */

.dsstat-root {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 24px;
  box-sizing: border-box;
  width: 100%;
  max-width: var(--dsh-composer-card-max-width, calc(var(--dsh-chat-content-width, 748px) + 32px));
  margin: 0 auto;
  padding: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
  font-family: var(--dsw-font-family);
}
.dsstat-seg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 7px;
  cursor: pointer;
  user-select: none;
  transition: background-color 120ms ease, color 120ms ease;
}
.dsstat-seg:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsstat-seg.open { background: var(--dsw-alias-interactive-bg-hover); }
.dsstat-seg.open .dsstat-val { color: var(--dsw-alias-brand-primary); }
.dsstat-label { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dsstat-val { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsstat-chev { font-size: 9px; color: var(--dsw-alias-label-tertiary); }
.dsstat-panel {
  position: absolute;
  bottom: calc(100% + 10px);
  z-index: 50;
  width: min(320px, 100%);
  padding: 10px 12px 12px;
  overflow: hidden;
  /* 传统模式背景 = 页面主背景（--dsw-alias-bg-base），深浅主题自动一致；
     半透明模式由内联 color-mix 填充覆盖，不受此值影响。 */
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  box-shadow: var(--dsw-shadow-lv2);
  opacity: 0;
  pointer-events: none;
  transition: opacity 140ms ease;
}
.dsstat-panel.open { opacity: 1; pointer-events: auto; }
.dsstat-panel-left { left: 0; }
.dsstat-panel-right { right: 0; }
/* Translucent mode: inline styles carry the fill AND the backdrop blur
   (blur renders in normal browsers; VSCode's embedded browser cannot
   sample scrolled content behind runtime-mounted elements). The stylesheet
   twin adds the border/shadow tint and the glass-style inner glow. */
/* Glass knobs: each panel defines --dsstat-blur / --dsstat-frost, bound to
   the 面板玻璃 sliders (--dsh-dstat-*), so dragging them updates the panel
   background live. NOTE: the panel element carries BOTH classes itself, so
   the selector is the same-element .dsstat-glass.dsstat-panel — a
   descendant combinator would never match. */
.dsstat-glass.dsstat-panel {
  --dsstat-blur: var(--dsh-dstat-blur, 14px);
  --dsstat-frost: var(--dsh-dstat-frost, 1);
}
.dsstat-glass.dsstat-panel {
  border-color: #132d5342;
  box-shadow: inset 0 1px #ffffff80, 0 8px 28px #132d531a;
}
body[data-ds-dark-theme] .dsstat-glass.dsstat-panel {
  border-color: #94b4dc52;
  box-shadow: inset 0 1px #ffffff12, 0 6px 24px #02060e38;
}
.dsstat-glass.dsstat-panel::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background:
    radial-gradient(420px 180px at 18% -10%, rgba(110, 165, 255, 0.12), transparent 70%),
    radial-gradient(360px 160px at 92% 115%, rgba(110, 165, 255, 0.08), transparent 70%);
}
.dsstat-glass.dsstat-panel {
  -webkit-backdrop-filter: blur(var(--dsstat-blur, 14px)) saturate(1.2);
  backdrop-filter: blur(var(--dsstat-blur, 14px)) saturate(1.2);
}
.dsstat-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--dsw-alias-label-tertiary);
  margin-bottom: 6px;
}
.dsstat-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 3px 0;
  font-size: 12px;
}
.dsstat-k { color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dsstat-v { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); text-align: right; }
.dsstat-s { display: block; font-size: 10px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.dsstat-ellip { max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsstat-divider { height: 1px; background: var(--dsw-alias-border-l1); margin: 8px 0; }
.dsstat-empty { font-size: 12px; color: var(--dsw-alias-label-tertiary); padding: 4px 0; }
/* Cost section */
.dsstat-refresh {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 5px;
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}
.dsstat-refresh:hover { color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dsstat-refresh.busy { color: var(--dsw-alias-brand-primary); }
.dsstat-cost-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 3px 0;
}
.dsstat-cost-label { color: var(--dsw-alias-label-secondary); font-size: 12px; white-space: nowrap; }
.dsstat-cost-value {
  flex: 1;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
}
.dsstat-cost-sub {
  display: block;
  font-size: 10px;
  font-weight: 400;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}
/* Settings → General rows: panel style + price table. */
.dsstat-mode-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
}
.dsstat-mode-label { color: var(--dsw-alias-label-secondary); }
.dsstat-mode-seg { display: inline-flex; gap: 4px; align-items: center; }
.dsstat-pricing-text { font-size: 11px; color: var(--dsw-alias-label-tertiary); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsstat-mode-btn {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  border-radius: 8px;
  padding: 3px 10px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
}
.dsstat-mode-btn:hover { background: var(--dsw-alias-interactive-bg-hover-accent); }
.dsstat-mode-btn.active {
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-brand-primary);
}
/* Settings → General: 面板玻璃滑杆。 */
.dsstat-glass-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
}
.dsstat-glass-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.dsstat-knob {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dsstat-knob-label {
  flex: none;
  width: 92px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.dsstat-knob-range {
  flex: 1;
  min-width: 0;
  height: 18px;
  accent-color: var(--dsw-alias-state-business-primary);
  cursor: pointer;
}
.dsstat-knob-num {
  flex: none;
  width: 56px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
}
@media (prefers-reduced-motion: reduce) {
  .dsstat-seg, .dsstat-panel, .dsstat-mode-btn { transition: none; }
}
`

  return {
    // timer 服务：动态 client 半区没有浏览器 timer 全局，定时刷新走 ctx.timer。
    inject: ['timer'],
    apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      bindTimerService(ctx.timer)
      applyGlassVars()
      styles.insert(css)

      slots.inject('conversation.composer.dock', () => slots.register(
        { name: 'conversation.composer.dock', id: 'stats', order: 0, label: 'stats' },
        (props) => React.createElement(StatsDock, props),
      ))
      slots.inject('settings.general.item', () => slots.register(
        { name: 'settings.general.item', id: 'dstat-mode', order: 12, label: '底栏面板样式' },
        (props) => React.createElement(ModeRow, props),
      ))
      slots.inject('settings.general.item', () => slots.register(
        { name: 'settings.general.item', id: 'dstat-pricing', order: 13, label: '价格表（实时）' },
        (props) => React.createElement(PricingRow, props),
      ))
      slots.inject('settings.general.item', () => slots.register(
        { name: 'settings.general.item', id: 'dstat-currency', order: 14, label: '成本计价币种' },
        (props) => React.createElement(CurrencyRow, props),
      ))
      slots.inject('settings.general.item', () => slots.register(
        { name: 'settings.general.item', id: 'dstat-glass', order: 15, label: '面板玻璃' },
        (props) => React.createElement(GlassRow, props),
      ))
    },
  }
