// host/prices.js — 价格模型：常量、归一化、解析、选价、计费（纯函数，无 DSH 依赖）
//
// 计费原理：金额 = token 用量 × 模型价格表，本地计算（业界通行做法）。
//   - 思维链按输出价计费（无独立 reasoning 价目）；
//   - 未命中输入价已含缓存写入，不重复计费（无 cacheWrite 价目）。

export const MODELS_DEV_URL = 'https://models.dev/api.json'
export const SYNC_TTL_MS = 60 * 60 * 1000 // 1h 缓存；手动刷新可强制

// 内置回退价格表（USD / CNY，1M tokens）。USD 数值与 models.dev 实时表
// 核对一致；CNY 取自 DeepSeek 官方 CNY 定价（api-docs.deepseek.com）。
export const FALLBACK_PRICES = {
  'deepseek-v4-flash': {
    usd: { input: 0.14, output: 0.28, cacheRead: 0.0028 },
    cny: { input: 1, output: 2, cacheRead: 0.02 },
  },
  'deepseek-v4-pro': {
    usd: { input: 0.435, output: 0.87, cacheRead: 0.003625 },
    cny: { input: 3, output: 6, cacheRead: 0.025 },
  },
  'deepseek-chat': {
    usd: { input: 0.14, output: 0.28, cacheRead: 0.0028 },
    cny: { input: 1, output: 2, cacheRead: 0.02 },
  },
  'deepseek-reasoner': {
    usd: { input: 0.14, output: 0.28, cacheRead: 0.0028 },
    cny: { input: 1, output: 2, cacheRead: 0.02 },
  },
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

// 解析 models.dev api.json → { 归一化模型id: {input, output, cacheRead} }。
// 载荷按 JSON 解析；失败抛错（回退内置表）。
export function parseModelsDev(json) {
  const deepseek = json && json.deepseek && json.deepseek.models
  if (!deepseek) throw new Error('models.dev: deepseek provider 缺失')
  const out = {}
  for (const [rawId, model] of Object.entries(deepseek)) {
    const cost = model && model.cost
    if (!cost) continue
    if (typeof cost.input !== 'number' && typeof cost.output !== 'number') continue
    const id = normalizeModelId(rawId)
    if (id === '') continue
    out[id] = {
      input: typeof cost.input === 'number' ? cost.input : 0,
      output: typeof cost.output === 'number' ? cost.output : 0,
      cacheRead: typeof cost.cache_read === 'number' ? cost.cache_read : 0,
    }
  }
  if (Object.keys(out).length === 0) throw new Error('models.dev: 无可用价格条目')
  return out
}

// 取某模型价格：实时表优先，内置表兜底；都不认识返回 null。
// usd：models.dev 实时表优先，失败回退内置 USD 表；cny：仅内置官方 CNY 表。
export function pickPrice(syncedPrices, modelId, currency) {
  const id = normalizeModelId(modelId)
  if (id === '') return null
  const synced = syncedPrices && syncedPrices[id]
  const fallback = FALLBACK_PRICES[id]
  const rates = currency === 'cny'
    ? (fallback ? (fallback.cny || fallback.usd) : null)
    : (synced || (fallback ? (fallback.usd || fallback.cny) : null))
  if (!rates) return null
  return {
    input: rates.input ?? 0,
    output: rates.output ?? 0,
    cacheRead: rates.cacheRead ?? 0,
  }
}

// 费用计算（1M 计）。未命中输入价已含缓存写入，不重复计费。
export function calcCost(records, prices) {
  let hit = 0
  let miss = 0
  let out = 0
  for (const r of records || []) {
    hit += r.cacheReadTokens
    miss += r.inputTokens
    out += r.outputTokens
  }
  return {
    cost: {
      hit: hit * (prices.cacheRead || 0) / 1e6,
      miss: miss * (prices.input || 0) / 1e6,
      out: out * (prices.output || 0) / 1e6,
      total: (hit * (prices.cacheRead || 0) + miss * (prices.input || 0) + out * (prices.output || 0)) / 1e6,
    },
  }
}
