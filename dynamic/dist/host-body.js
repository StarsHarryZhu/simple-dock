// host/prices.js — 价格模型：常量、归一化、解析、选价、计费（纯函数，无 DSH 依赖）
//
// 计费原理：金额 = token 用量 × 模型价格表，本地计算（业界通行做法）。
//   - 思维链按输出价计费（无独立 reasoning 价目）；
//   - 未命中输入价已含缓存写入，不重复计费（无 cacheWrite 价目）。

const MODELS_DEV_URL = 'https://models.dev/api.json'
const SYNC_TTL_MS = 60 * 60 * 1000 // 1h 缓存；手动刷新可强制

// 内置回退价格表（USD / CNY，1M tokens）。USD 数值与 models.dev 实时表
// 核对一致；CNY 取自 DeepSeek 官方 CNY 定价（api-docs.deepseek.com）。
const FALLBACK_PRICES = {
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
function normalizeModelId(modelId) {
  if (typeof modelId !== 'string' || modelId === '') return ''
  let id = modelId.slice(modelId.lastIndexOf('/') + 1)
  id = id.split(':')[0] ?? ''
  id = id.trim().replace(/@/g, '-').toLowerCase()
  if (id.endsWith('[1m]')) id = id.slice(0, -'[1m]'.length).trim()
  return id
}

// 解析 models.dev api.json → { 归一化模型id: {input, output, cacheRead} }。
// 载荷按 JSON 解析；失败抛错（回退内置表）。
function parseModelsDev(json) {
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
function pickPrice(syncedPrices, modelId, currency) {
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
function calcCost(records, prices) {
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
// host/services.js — 服务层：价格表同步 + 会话用量读取（依赖以 ctx 注入，
// 便于测试与扩展；新增通道/数据源 = 在此加一个分支）。


// 价格表同步：web 通道 + shell/curl 兜底，内存缓存 1h，返回 { sync }。
function createPricingSync(ctx) {
  const web = ctx.get('web')
  let cache = null // { syncedAt, source, prices, error? }
  let syncing = null

  async function sync(force) {
    if (cache !== null && !force && Date.now() - cache.syncedAt < SYNC_TTL_MS) {
      return cache
    }
    if (syncing !== null) return syncing
    syncing = (async () => {
      let prices = null
      let transport = null
      let failErr = null
      // 1) ctx.web 标准通道（部署未注册 fetch provider 时会失败）
      if (web !== undefined) {
        try {
          const res = await web.fetch({ url: MODELS_DEV_URL })
          const content = res && res.body && typeof res.body.content === 'string'
            ? res.body.content
            : null
          if (!content) throw new Error('web.fetch 无内容')
          if (res.statusCode < 200 || res.statusCode >= 300) {
            throw new Error('models.dev HTTP ' + res.statusCode)
          }
          prices = parseModelsDev(JSON.parse(content))
          transport = 'web'
        } catch (e) {
          failErr = String((e && e.message) || e)
        }
      } else {
        failErr = 'ctx.web 不可用'
      }
      // 2) ctx.shell + curl 兜底（无 web provider 时仍能实时同步）
      if (prices === null) {
        const shell = ctx.get('shell')
        if (shell !== undefined) {
          try {
            const res = await shell.run({
              command: 'curl -sS --max-time 20 --compressed https://models.dev/api.json',
              timeoutMs: 25000,
              stdoutMaxBytes: 8 * 1024 * 1024,
            })
            const text = res && res.stdout && typeof res.stdout.text === 'string'
              ? res.stdout.text
              : null
            if (!text) throw new Error('curl 无输出')
            if (res.exitCode !== 0 && res.exitCode !== null) {
              throw new Error('curl exit ' + res.exitCode)
            }
            prices = parseModelsDev(JSON.parse(text))
            transport = 'shell'
          } catch (e) {
            failErr = String((e && e.message) || e)
          }
        } else {
          failErr = (failErr ? failErr + '；' : '') + 'ctx.shell 不可用'
        }
      }
      if (prices !== null) {
        cache = { syncedAt: Date.now(), source: 'models.dev', transport, prices }
      } else {
        // 回退：内置表（prices.js 兜底），并记录原因供 UI 展示。
        cache = {
          syncedAt: Date.now(),
          source: 'fallback',
          prices: null,
          error: failErr || '同步失败',
        }
      }
      return cache
    })().finally(() => { syncing = null })
    return syncing
  }

  return { sync }
}

// 从事件流提取逐请求用量（与 token-meter 折叠一致：assistant/chunk 的 usage
// 优先、assistant/message 兜底；同一 (turn, step) 只保留最后一次样本，累计
// 快照不重复计费）。只取计算需要的三项：inputTokens（未命中输入，已含缓存
// 写入）、cacheReadTokens（命中）、outputTokens（输出，含思维链）。
function extractUsageRecords(events) {
  const last = new Map()
  for (const event of events || []) {
    if (!event || typeof event !== 'object') continue
    const data = event.data
    if (!data || typeof data !== 'object') continue
    const turn = data.turn
    const step = data.step
    if (typeof turn !== 'number' || typeof step !== 'number') continue
    let usage = null
    if (event.type === 'assistant/chunk' && data.chunk && data.chunk.type === 'usage') {
      usage = data.chunk.usage
    } else if (event.type === 'assistant/message' && data.usage) {
      usage = data.usage
    }
    if (!usage || typeof usage !== 'object') continue
    last.set(turn + ':' + step, {
      inputTokens: typeof usage.inputTokens === 'number' ? Math.max(0, usage.inputTokens) : 0,
      outputTokens: typeof usage.outputTokens === 'number' ? Math.max(0, usage.outputTokens) : 0,
      cacheReadTokens: typeof usage.cacheReadTokens === 'number' ? Math.max(0, usage.cacheReadTokens) : 0,
    })
  }
  return [...last.values()]
}

// 多数据源兜底读取用量（任一源拿到 usage 即止；raw 最重放最后）：
//   1. sessionQuery.readSession —— live 优先的全量重放
//   2. sessionPersistence.inspect —— 持久化逻辑日志（live 时不抛错）
//   3. sessionPersistence.readRaw —— 直接解析底层 JSONL 文本
//     （dsh-delete-dashboard 同款做法，绕开一切重放/校验路径）
// 返回 { records, source, eventCount }；source 为 null 表示无任何可用用量。
async function readUsageRecords(ctx, sessionId) {
  const sessionQuery = ctx.get('sessionQuery')
  const persistence = ctx.get('sessionPersistence')
  let records = []
  let chosen = null
  let eventCount = 0

  if (sessionQuery !== undefined) {
    try {
      const snap = await sessionQuery.readSession(sessionId)
      const events = (snap && snap.events) || []
      const r = extractUsageRecords(events)
      eventCount = events.length
      if (r.length > 0) { records = r; chosen = 'query' }
    } catch (e) { /* 尝试下一源 */ }
  }
  if (chosen === null && persistence !== undefined) {
    try {
      const insp = await persistence.inspect(sessionId)
      const events = (insp && insp.events) || []
      const r = extractUsageRecords(events)
      eventCount = events.length
      if (r.length > 0) { records = r; chosen = 'inspect' }
    } catch (e) { /* 尝试下一源 */ }
  }
  if (chosen === null && persistence !== undefined) {
    try {
      const raw = await persistence.readRaw(sessionId)
      if (raw && typeof raw.content === 'string') {
        const parsed = raw.content.split('\n')
          .filter((line) => line.trim() !== '')
          .map((line) => { try { return JSON.parse(line) } catch { return null } })
          .filter((x) => x !== null)
        const r = extractUsageRecords(parsed)
        eventCount = parsed.length
        if (r.length > 0) { records = r; chosen = 'raw' }
      }
    } catch (e) { /* 尝试下一源 */ }
  }

  return { records, source: chosen, eventCount }
}
  return {
    apply(ctx) {
      const pricingSync = createPricingSync(ctx)
      const agentDefaultModel = ctx.get('agentDefaultModel')

      harness.handle('dstat.pricing', async (args) => {
        const arg = args && typeof args === 'object' ? args : {}
        const state = await pricingSync.sync(arg.force === true)
        return {
          source: state.source,
          syncedAt: state.syncedAt,
          transport: state.transport || null,
          error: state.error || null,
        }
      })

      harness.handle('dstat.sessionCost', async (args) => {
        const arg = args && typeof args === 'object' ? args : {}
        const sessionId = arg.sessionId
        if (typeof sessionId !== 'string' || sessionId === '') {
          return { ok: false, error: '缺少 sessionId' }
        }
        try {
          const { records, source, eventCount } = await readUsageRecords(ctx, sessionId)

          const pricing = await pricingSync.sync(false)
          let model = typeof arg.model === 'string' && arg.model !== '' ? arg.model : null
          if (model === null && agentDefaultModel !== undefined) {
            try {
              const sel = agentDefaultModel.currentSelection()
              if (sel && typeof sel.model === 'string') model = sel.model
            } catch (e) { /* 忽略选择器异常 */ }
          }
          const currency = arg.currency === 'cny' ? 'cny' : 'usd'
          const price = pickPrice(pricing.prices, model || 'deepseek-v4-flash', currency)
          if (price === null) {
            return {
              ok: false,
              error: '未知模型价格: ' + (model || '(空)'),
              records: records.length,
            }
          }
          const result = calcCost(records, price)
          return {
            ok: true,
            currency,
            records: records.length,
            usageSource: source,
            eventCount,
            ...result,
          }
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) }
        }
      })
    },
  }
