// client/core.js — 偏好（localStorage + 订阅）、展示格式化、快照派生、
// 预估成本缓存、按消耗时刻取价。全部为纯浏览器逻辑。
import { priceAt } from './prices.js'

const PANEL_MODE_KEY = 'dsh.dstat.panel.mode'
const CURRENCY_KEY = 'dsh.dstat.currency'
const BLUR_KEY = 'dsh.dstat.blur'
const FROST_KEY = 'dsh.dstat.frost'
const ENABLED_KEY = 'dsh.dstat.enabled'

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
// 插件总开关（设置 → 插件卡片）：默认启用。
const enabled = createPref(ENABLED_KEY,
  () => safeRead(ENABLED_KEY) !== '0',
  (v) => (typeof v === 'boolean' ? v : undefined))
// 底栏面板样式：默认半透明；仅显式存储 'classic' 才选传统。
const panelMode = createPref(PANEL_MODE_KEY,
  () => (safeRead(PANEL_MODE_KEY) === 'classic' ? 'classic' : 'translucent'),
  (v) => (v === 'translucent' || v === 'classic' ? v : undefined))
// 计价币种：默认美元。
const currency = createPref(CURRENCY_KEY,
  () => (safeRead(CURRENCY_KEY) === 'cny' ? 'cny' : 'usd'),
  (v) => (v === 'usd' || v === 'cny' ? v : undefined))
// 面板玻璃：默认 14px / 50。50 → 1.0 倍 alpha（frost/50，上限 1.4）。
const blurPref = createNumberPref(BLUR_KEY, 14, 0, 40)
const frostPref = createNumberPref(FROST_KEY, 50, 0, 100)

export const getEnabled = () => enabled.get()
export const setEnabled = (v) => enabled.set(v)
export const subscribeEnabled = (fn) => enabled.subscribe(fn)
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

// ---- 预估成本：按每次消耗的精确时间与模型取价（本地计算） ----
// 数据来源：会话快照 assistant 节点。每步带 timing.completedTime
// （Unix epoch ms，精确到毫秒）、该步 usage（input/output/cacheRead/
// cacheWrite）与 requestConfig.model / provenance.model（该步所用模型）。
// 投影 tokenUsage 只有聚合总量、无时间戳，因此按步扫描节点取价，
// 与投影总量之差（节点缺 usage 的步）按会话最近时刻补算。

// 每步消耗记录：{ at, model, usage }。at 为 null 表示该步无时间记录
//（窗口截断/旧会话），计价时按最近已知时刻近似；usage 为 null 表示无用量。
export function stepCosts(nodes) {
  const rows = []
  let fallbackModel = null
  for (const node of nodes) {
    if (!node || node.kind !== 'assistant') continue
    const timing = node.timing
    const at = timing !== undefined && typeof timing.completedTime === 'number'
      ? timing.completedTime
      : (typeof node.time === 'number' ? node.time : null)
    const cfg = node.requestConfig
    const prov = node.provenance
    let model = (cfg && typeof cfg.model === 'string' && cfg.model !== '') ? cfg.model
      : (prov && typeof prov.model === 'string' && prov.model !== '') ? prov.model
      : null
    if (model !== null) fallbackModel = model
    const u = node.usage
    const usage = u !== undefined && u !== null && typeof u === 'object'
      ? {
          uncached: num(u.inputTokens) ?? 0,
          out: num(u.outputTokens) ?? 0,
          read: num(u.cacheReadTokens) ?? 0,
          write: num(u.cacheWriteTokens) ?? 0,
        }
      : null
    rows.push({ at, model, usage })
  }
  return rows
}

// 读取会话快照中最后一个 assistant 节点的模型身份（requestConfig /
// provenance 均为官方记录字段）；没有则按默认模型计价。
export function currentModel(nodes) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]
    if (!node || node.kind !== 'assistant') continue
    const cfg = node.requestConfig
    if (cfg && typeof cfg.model === 'string' && cfg.model !== '') return cfg.model
    const prov = node.provenance
    if (prov && typeof prov.model === 'string' && prov.model !== '') return prov.model
  }
  return null
}

// 计算某会话的预估成本：{ ok, currency, model, cost, skipped }。
// nodes = 会话快照节点（时间 + 每步模型 + 每步用量）；usage = readUsage()
// 投影聚合（兜底差额）。每步按其消耗时刻取峰/谷价累加。
export async function computeSessionCost(nodes, usage, currencyCode) {
  const fallbackModel = currentModel(nodes) || 'deepseek-v4-flash'
  const rows = stepCosts(nodes)
  const priced = { uncached: 0, out: 0, read: 0, write: 0 }
  let total = { hit: 0, miss: 0, out: 0, total: 0 }
  let lastAt = null
  let skipped = 0
  let skippedModel = null
  for (const row of rows) {
    if (row.usage === null) continue
    const at = row.at !== null ? row.at : (lastAt !== null ? lastAt : Date.now())
    if (row.at !== null) lastAt = row.at
    const model = row.model || fallbackModel
    const price = priceAt(model, currencyCode, at)
    if (price === null) {
      skipped += 1
      if (skippedModel === null) skippedModel = model
      continue
    }
    priced.uncached += row.usage.uncached
    priced.out += row.usage.out
    priced.read += row.usage.read
    priced.write += row.usage.write
    const hit = (row.usage.read * (price.cacheRead || 0)) / 1e6
    const miss = ((row.usage.uncached + row.usage.write) * (price.input || 0)) / 1e6
    const out = (row.usage.out * (price.output || 0)) / 1e6
    total.hit += hit
    total.miss += miss
    total.out += out
    total.total += hit + miss + out
  }
  // 差额兜底：节点缺 usage 的步（或节点外用量），按最近一次消耗时刻取价。
  const u = usage || { uncached: 0, out: 0, read: 0, write: 0 }
  const leftover = {
    uncached: Math.max(0, u.uncached - priced.uncached),
    out: Math.max(0, u.out - priced.out),
    read: Math.max(0, u.read - priced.read),
    write: Math.max(0, u.write - priced.write),
  }
  if (leftover.uncached > 0 || leftover.out > 0 || leftover.read > 0 || leftover.write > 0) {
    const price = priceAt(fallbackModel, currencyCode, lastAt !== null ? lastAt : Date.now())
    if (price !== null) {
      const hit = (leftover.read * (price.cacheRead || 0)) / 1e6
      const miss = ((leftover.uncached + leftover.write) * (price.input || 0)) / 1e6
      const out = (leftover.out * (price.output || 0)) / 1e6
      total.hit += hit
      total.miss += miss
      total.out += out
      total.total += hit + miss + out
    } else {
      skipped += 1
      if (skippedModel === null) skippedModel = fallbackModel
    }
  }
  if (priced.uncached + priced.out + priced.read + priced.write === 0 && total.total === 0) {
    return { ok: false, error: '未知模型价格: ' + (skippedModel || fallbackModel) }
  }
  return {
    ok: true,
    currency: currencyCode,
    model: fallbackModel,
    cost: total,
    skipped,
    skippedModel,
  }
}

// ---- 预估成本缓存：按会话持久化（localStorage）。打开面板先显示缓存、
// 后台更新后替换；插件运行期间后台每小时刷新一次。 ----
// 缓存带 PRICE_VERSION：内置价格表升级后旧条目自动失效（版本不符视为无缓存）。
const COST_CACHE_PREFIX = 'dsh.dstat.cost.'
export const PRICE_VERSION = 4

export function readCostCache(sessionId) {
  try {
    const raw = window.localStorage.getItem(COST_CACHE_PREFIX + sessionId)
    if (raw === null) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.data) return null
    if (parsed.priceVersion !== PRICE_VERSION) return null
    return parsed
  } catch (e) {
    return null
  }
}

export function writeCostCache(sessionId, data) {
  try {
    window.localStorage.setItem(COST_CACHE_PREFIX + sessionId,
      JSON.stringify({ data, fetchedAt: Date.now(), priceVersion: PRICE_VERSION }))
  } catch (e) {
    // Storage unavailable (private mode): the in-memory fallback still works.
  }
}

// ---- 周期性调度（静态 bundle 运行在页面内，浏览器 timer 可用） ----
export function scheduleInterval(callback, delayMs) {
  const id = setInterval(callback, delayMs)
  return () => clearInterval(id)
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

export function fmtCost(value, currencyCode) {
  if (!(typeof value === 'number' && Number.isFinite(value)) || value < 0) return '—'
  const symbol = currencyCode === 'cny' ? '¥' : '$'
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
