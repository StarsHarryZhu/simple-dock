// client/prices.js — 内置价格模型（唯一来源，不拉取外部价格表）。
// 计费原理：金额 = token 用量 × 模型价格表，本地计算。
//   - 思维链按输出价计费（无独立 reasoning 价目）；
//   - 未命中输入价已含缓存写入，不重复计费（无 cacheWrite 价目）。

// 峰谷时段定义（UTC 小时，半开区间 [start, end)）：
//   峰：01:00–04:00、06:00–10:00；其余为谷。
export const PEAK_HOURS_UTC = [[1, 4], [6, 10]]
// 峰谷计价生效时刻：2026-08-17T00:00:00Z（此前一律按旧统一价）。
export const PEAK_START_MS = Date.UTC(2026, 7, 17)
// 周末全天谷价生效时刻：2026-08-23 00:00 北京时间（= UTC 2026-08-22 16:00）。
// 生效后：北京时间周六/周日全天按谷价；工作日维持 PEAK_HOURS_UTC 峰谷。
export const WEEKEND_START_MS = Date.UTC(2026, 7, 22, 16)
// flash 系列新价生效时刻：2026-09-10 12:00 北京时间（= UTC 04:00）。
// 生效后：v4-flash（含 vision-exp 同价别名）改用 revised 峰谷价目；
// 峰 = 谷 × 2；周末全天谷价规则继续适用。pro 不受影响。
export const FLASH_REVISION_START_MS = Date.UTC(2026, 8, 10, 4)
// 北京时间 = UTC+8。
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

// 消耗时刻的北京时间星期几（0=周日 … 6=周六）。
function beijingDayOfWeek(atMs) {
  return new Date(atMs + BEIJING_OFFSET_MS).getUTCDay()
}

// 内置价格表（每 1M tokens）。字段顺序与 DeepSeek 官方价目一致：
// cacheRead（缓存命中输入）/ input（未命中输入）/ output（输出）。
//   usd / cny     —— 统一价（2026-08-17 前）
//   peakUsd/peakCny  —— 峰时段价；offPeak* —— 谷时段价（峰 × 0.5）
//   revised（仅 flash）—— 2026-09-10 12:00 北京时间起的新峰谷价目，
//     峰 = 谷 × 2；结构同 peak*/offPeak*。
// flash 系列的主 id 是 deepseek-flash：2026-09-10 12:00 北京时间起，
// deepseek-v4-flash 与 deepseek-v4-flash-vision-exp 都只是它的别称，
// 一律引用这张 flash 价目（详见下方 ALIAS_SAME_PRICE）。
export const FALLBACK_PRICES = {
  'deepseek-flash': {
    usd: { input: 0.14, output: 0.28, cacheRead: 0.0028 },
    cny: { input: 1, output: 2, cacheRead: 0.02 },
    peakUsd: { input: 0.44, output: 1.32, cacheRead: 0.014 },
    peakCny: { input: 3, output: 9, cacheRead: 0.1 },
    offPeakUsd: { input: 0.22, output: 0.66, cacheRead: 0.007 },
    offPeakCny: { input: 1.5, output: 4.5, cacheRead: 0.05 },
    // flash 新价（2026-09-10 12:00 北京时间 / UTC 04:00 生效）：
    // 谷 0.003/0.15/0.6 USD = 0.02/1/4 CNY；峰 = 谷 × 2。
    revised: {
      peakUsd: { input: 0.3, output: 1.2, cacheRead: 0.006 },
      peakCny: { input: 2, output: 8, cacheRead: 0.04 },
      offPeakUsd: { input: 0.15, output: 0.6, cacheRead: 0.003 },
      offPeakCny: { input: 1, output: 4, cacheRead: 0.02 },
    },
  },
  'deepseek-v4-pro': {
    usd: { input: 0.435, output: 0.87, cacheRead: 0.003625 },
    cny: { input: 3, output: 6, cacheRead: 0.025 },
    peakUsd: { input: 1.32, output: 3.96, cacheRead: 0.044 },
    peakCny: { input: 9, output: 27, cacheRead: 0.3 },
    offPeakUsd: { input: 0.66, output: 1.98, cacheRead: 0.022 },
    offPeakCny: { input: 4.5, output: 13.5, cacheRead: 0.15 },
  },
}

// 旧模型定向：deepseek-chat / deepseek-reasoner 按 flash 的统一价
// （旧价格表）计价，不参与峰谷。
const ALIAS_UNIFIED = {
  'deepseek-chat': 'deepseek-flash',
  'deepseek-reasoner': 'deepseek-flash',
}
// flash 系列的别称：全部引用 deepseek-flash 价目（含峰谷、周末谷价与
// 2026-09-10 12:00 北京时间起的新价）。
//   deepseek-v4-flash             —— flash 的旧 id（9/10 12:00 起成为别称）
//   deepseek-v4-flash-vision-exp  —— 官方 "Vision at Flash Price"
const ALIAS_SAME_PRICE = {
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
}

// 模型 id 归一化：去 provider 前缀、冒号、@ 与 [1m] 后缀，统一小写。
export function normalizeModelId(modelId) {
  if (typeof modelId !== 'string' || modelId === '') return ''
  let id = modelId.slice(modelId.lastIndexOf('/') + 1)
  id = id.split(':')[0] ?? ''
  id = id.trim().replace(/@/g, '-').toLowerCase()
  if (id.endsWith('[1m]')) id = id.slice(0, -'[1m]'.length).trim()
  return id
}

function cap(s) {
  return s === 'usd' ? 'Usd' : 'Cny'
}

// 取某模型在某时刻的适用价格（每 1M tokens）。
//   - 模型不存在 → null；
//   - 无峰谷的模型 → 统一价；
//   - 峰谷生效日（2026-08-17T00:00:00Z）之前 → 统一价；
//   - 2026-08-23 00:00 北京时间（周末全天谷价）之后：北京时间周六/周日
//     一律谷价；工作日按 UTC 小时落峰/谷；
//   - 两生效日之间：仅按 UTC 小时落峰/谷；
//   - 2026-09-10 12:00 北京时间（flash 新价）之后：flash 系列
//     （主 id deepseek-flash 及其别称 v4-flash / vision-exp）
//     改取 revised 峰谷价目，峰 = 谷 × 2；时段与周末规则不变。
export function priceAt(modelId, currency, atMs) {
  const id = normalizeModelId(modelId)
  if (id === '') return null
  const alias = ALIAS_UNIFIED[id]
  if (alias !== undefined) {
    const base = FALLBACK_PRICES[alias]
    return base ? (base[currency] || base.usd || base.cny) : null
  }
  const m = FALLBACK_PRICES[ALIAS_SAME_PRICE[id] ?? id]
  if (!m) return null
  const unified = m[currency] || m.usd || m.cny
  if (m.peakUsd === undefined || m.peakCny === undefined) return unified
  if (!(atMs >= PEAK_START_MS)) return unified
  const hour = new Date(atMs).getUTCHours()
  let inPeak = PEAK_HOURS_UTC.some(([s, e]) => hour >= s && hour < e)
  if (atMs >= WEEKEND_START_MS) {
    const dow = beijingDayOfWeek(atMs)
    if (dow === 0 || dow === 6) inPeak = false // 北京时间周末：全天谷价
  }
  // flash 新价生效后换用新价目（仅 flash 携带 revised；pro 无 → 旧价目）。
  const source = atMs >= FLASH_REVISION_START_MS && m.revised !== undefined ? m.revised : m
  const table = inPeak
    ? (source['peak' + cap(currency)] || source.peakUsd)
    : (source['offPeak' + cap(currency)] || source.offPeakUsd)
  return {
    input: table.input ?? 0,
    output: table.output ?? 0,
    cacheRead: table.cacheRead ?? 0,
  }
}

// 费用计算（1M 计）。usage = 投影聚合 {uncached, read, write, out}。
export function calcCost(usage, prices) {
  const hit = usage.read
  const miss = usage.uncached + usage.write
  const out = usage.out
  return {
    cost: {
      hit: (hit * (prices.cacheRead || 0)) / 1e6,
      miss: (miss * (prices.input || 0)) / 1e6,
      out: (out * (prices.output || 0)) / 1e6,
      total: (hit * (prices.cacheRead || 0) + miss * (prices.input || 0) + out * (prices.output || 0)) / 1e6,
    },
  }
}
