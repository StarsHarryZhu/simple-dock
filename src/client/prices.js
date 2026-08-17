// client/prices.js — 内置价格模型（唯一来源，不拉取外部价格表）。
// 计费原理：金额 = token 用量 × 模型价格表，本地计算。
//   - 思维链按输出价计费（无独立 reasoning 价目）；
//   - 未命中输入价已含缓存写入，不重复计费（无 cacheWrite 价目）。

// 峰谷时段定义（UTC 小时，半开区间 [start, end)）：
//   峰：01:00–04:00、06:00–10:00；其余为谷。
export const PEAK_HOURS_UTC = [[1, 4], [6, 10]]
// 峰谷计价生效时刻：2026-08-17T00:00:00Z（此前一律按旧统一价）。
export const PEAK_START_MS = Date.UTC(2026, 7, 17)

// 内置价格表（每 1M tokens）。字段顺序与 DeepSeek 官方价目一致：
// cacheRead（缓存命中输入）/ input（未命中输入）/ output（输出）。
//   usd / cny     —— 统一价（2026-08-17 前）
//   peakUsd/peakCny  —— 峰时段价；offPeak* —— 谷时段价（峰 × 0.5）
export const FALLBACK_PRICES = {
  'deepseek-v4-flash': {
    usd: { input: 0.14, output: 0.28, cacheRead: 0.0028 },
    cny: { input: 1, output: 2, cacheRead: 0.02 },
    peakUsd: { input: 0.44, output: 1.32, cacheRead: 0.014 },
    peakCny: { input: 3, output: 9, cacheRead: 0.1 },
    offPeakUsd: { input: 0.22, output: 0.66, cacheRead: 0.007 },
    offPeakCny: { input: 1.5, output: 4.5, cacheRead: 0.05 },
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

// 旧模型定向：deepseek-chat / deepseek-reasoner 按 v4-flash 的统一价
// （旧价格表）计价，不参与峰谷。
const ALIAS_UNIFIED = {
  'deepseek-chat': 'deepseek-v4-flash',
  'deepseek-reasoner': 'deepseek-v4-flash',
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
//   - 之后按消耗时刻的 UTC 小时落峰/谷时段取对应价。
export function priceAt(modelId, currency, atMs) {
  const id = normalizeModelId(modelId)
  if (id === '') return null
  const alias = ALIAS_UNIFIED[id]
  if (alias !== undefined) {
    const base = FALLBACK_PRICES[alias]
    return base ? (base[currency] || base.usd || base.cny) : null
  }
  const m = FALLBACK_PRICES[id]
  if (!m) return null
  const unified = m[currency] || m.usd || m.cny
  if (m.peakUsd === undefined || m.peakCny === undefined) return unified
  if (!(atMs >= PEAK_START_MS)) return unified
  const hour = new Date(atMs).getUTCHours()
  const table = PEAK_HOURS_UTC.some(([s, e]) => hour >= s && hour < e)
    ? (m['peak' + cap(currency)] || m.peakUsd)
    : (m['offPeak' + cap(currency)] || m.offPeakUsd)
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
