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

export const getPanelMode = () => panelMode.get()
export const setPanelMode = (v) => panelMode.set(v)
export const subscribePanelMode = (fn) => panelMode.subscribe(fn)
export const getCurrency = () => currency.get()
export const setCurrency = (v) => currency.set(v)
export const subscribeCurrency = (fn) => currency.subscribe(fn)
export const getBlurPref = () => blurPref.get()
export const getFrostPref = () => frostPref.get()
export function setBlurPref(v) {
  blurPref.set(v)
  applyGlassVars()
}
export function setFrostPref(v) {
  frostPref.set(v)
  applyGlassVars()
}
// 任一玻璃旋钮变化都通知（GlassRow 两个滑杆共用）。
export function subscribeGlass(fn) {
  const off1 = blurPref.subscribe(fn)
  const off2 = frostPref.subscribe(fn)
  return () => { off1(); off2() }
}

// 把自定义玻璃值写到 <html>（面板 --dsstat-* 变量链消费）。
export function applyGlassVars() {
  if (typeof document === 'undefined' || document.documentElement === null) return
  const style = document.documentElement.style
  style.setProperty('--dsh-dstat-blur', blurPref.get() + 'px')
  style.setProperty('--dsh-dstat-frost', String(Math.min(frostPref.get() / 50, 1.4)))
}

// ---- 预估成本缓存：按会话持久化（localStorage）。打开面板先显示缓存、
// 后台更新后替换；插件运行期间后台每小时刷新一次（见 components.js）。 ----
const COST_CACHE_PREFIX = 'dsh.dstat.cost.'

export function readCostCache(sessionId) {
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

export function writeCostCache(sessionId, data) {
  try {
    window.localStorage.setItem(COST_CACHE_PREFIX + sessionId, JSON.stringify({ data, fetchedAt: Date.now() }))
  } catch (e) {
    // Storage unavailable (private mode): the in-memory fallback still works.
  }
}

// ---- timer 服务绑定：动态 client 半区无浏览器 timer 全局（setInterval 等），
// 必须使用 Cordis timer 服务（插件声明 inject: ['timer']，入口 apply 时绑定）。
let timerSvc = null

export function bindTimerService(t) {
  timerSvc = t
}

// 周期性调度；返回 disposer（timer 服务不可用时返回 null，调用方降级）。
export function scheduleInterval(callback, delayMs) {
  return timerSvc !== null && typeof timerSvc.interval === 'function'
    ? timerSvc.interval(callback, delayMs)
    : null
}

// ---- 展示格式化 ----
export function num(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
}

export function fmtExact(n) {
  if (!(n >= 0)) return '—'
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function fmtDuration(ms) {
  if (!(ms >= 0)) return '—'
  const s = ms / 1000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

export function fmtTps(tps) {
  if (!(tps >= 0)) return '—'
  return tps >= 10 ? String(Math.round(tps)) : String(Math.round(tps * 10) / 10)
}

export function fmtCost(value, currency) {
  if (!(typeof value === 'number' && Number.isFinite(value)) || value < 0) return '—'
  const symbol = currency === 'cny' ? '¥' : '$'
  const digits = value >= 1 ? 2 : value > 0 ? 4 : 2
  const text = value.toFixed(digits).replace(/\.?0+$/, '')
  return symbol + text
}

function pad2(v) {
  return v < 10 ? '0' + v : String(v)
}

export function formatClock(ms) {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// ---- 快照派生（无投影时的手算兜底，字段与官方投影一致） ----
export function stepReading(node) {
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

export function foldStats(nodes) {
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

export function readUsage(u) {
  if (u === undefined || u === null || typeof u !== 'object') return null
  const get = k => {
    const v = u[k]
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
  }
  return { uncached: get('uncachedInputTokens'), out: get('outputTokens'), read: get('cacheReadTokens'), write: get('cacheWriteTokens') }
}
