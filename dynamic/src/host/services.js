// host/services.js — 服务层：价格表同步 + 会话用量读取（依赖以 ctx 注入，
// 便于测试与扩展；新增通道/数据源 = 在此加一个分支）。

import { MODELS_DEV_URL, SYNC_TTL_MS, parseModelsDev } from './prices.js'

// 价格表同步：web 通道 + shell/curl 兜底，内存缓存 1h，返回 { sync }。
export function createPricingSync(ctx) {
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
export function extractUsageRecords(events) {
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
export async function readUsageRecords(ctx, sessionId) {
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
