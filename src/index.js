/**
 * Simple Dock node half. Two jobs:
 *   1. Register the plugin's own settings namespace so the "设置 → 插件" card
 *      dispatches by it (the card's enabled state lives in the browser half).
 *   2. Serve a same-origin, read-only per-step usage log for one session, so
 *      the cost engine can price the *whole* conversation. The browser half
 *      only sees the conversation rows its window has loaded (the Client's
 *      legacy node projection is windowed), which made the estimate drift with
 *      the visible range; this endpoint reads the stored log through the Host's
 *      own persistence instead, so compression and format migrations stay the
 *      Host's business.
 */
import z from '@deepseek-ai/schemastery'

/** Same-origin read-only endpoint returning one session's per-step usage. */
const STEPS_ROUTE = '/dsh-simple-dock/api/steps'
/** How long one session's parsed steps are reused before re-reading its log. */
const STEPS_TTL_MS = 30 * 1000

/** Coerce a possibly-absent token count to a finite number. */
function count(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Project stored session events onto the per-step rows the cost engine prices:
 * `{ time, model, uncached, read, write, out }`. Only assistant messages that
 * carry usage contribute; every other event is skipped.
 * @param events - session events read from persistence.
 * @returns one row per usage-bearing assistant message, in log order.
 */
export function stepsFromEvents(events) {
  const steps = []
  for (const event of events) {
    if (event === null || typeof event !== 'object' || event.type !== 'assistant/message') continue
    const data = event.data
    if (data === null || typeof data !== 'object') continue
    const usage = data.usage
    if (usage === null || typeof usage !== 'object') continue
    const message = data.message
    const source = message !== null && typeof message === 'object' ? message.source : undefined
    const model = source !== null && source !== undefined && typeof source === 'object'
      && typeof source.model === 'string' && source.model !== ''
      ? source.model
      : null
    steps.push({
      time: typeof event.time === 'number' ? event.time : null,
      model,
      uncached: count(usage.inputTokens),
      read: count(usage.cacheReadTokens),
      write: count(usage.cacheWriteTokens),
      out: count(usage.outputTokens),
    })
  }
  return steps
}

/**
 * Same-origin gate. A browser sends `Origin` only for cross-origin requests,
 * POSTs and WebSocket handshakes, so an absent header is a same-origin GET.
 */
function sameOrigin(req) {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/** Write one JSON response body with the fixed no-store headers. */
function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/**
 * Register the `simple-dock` namespace once the optional settings service is
 * composed. The empty schema means the namespace owns no editable fields —
 * the card stores its state in localStorage; the namespace exists purely so
 * the plugin's card is served and dispatched in Settings → Plugins.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx) {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register('simple-dock', z.object({}))
  })

  // Complete per-step usage for the cost engine (see the module comment).
  ctx.inject(['webServer', 'sessionPersistence'], (webCtx) => {
    /** sessionId → { at, steps }: avoids re-parsing a long log on every open. */
    const cache = new Map()
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: STEPS_ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'GET' || !sameOrigin(req)) {
          res.writeHead(403).end()
          return
        }
        let sessionId = null
        try {
          sessionId = new URL(req.url ?? '/', 'http://dsh.invalid').searchParams.get('sessionId')
        } catch {
          sessionId = null
        }
        if (sessionId === null || sessionId === '') {
          json(res, 400, { ok: false, reason: 'bad-request' })
          return
        }
        const cached = cache.get(sessionId)
        if (cached !== undefined && Date.now() - cached.at < STEPS_TTL_MS) {
          json(res, 200, { ok: true, steps: cached.steps })
          return
        }
        let handle
        try {
          handle = await webCtx.sessionPersistence.open(sessionId, 'read')
          const read = await handle.read()
          const steps = stepsFromEvents(read.events ?? [])
          cache.set(sessionId, { at: Date.now(), steps })
          json(res, 200, { ok: true, steps })
        } catch (error) {
          json(res, 404, {
            ok: false,
            reason: 'session-unreadable',
            message: error instanceof Error ? error.message : String(error),
          })
        } finally {
          if (handle !== undefined) {
            try {
              await handle.close()
            } catch {
              // The read already produced its answer; a close failure changes nothing.
            }
          }
        }
      },
    }))
  })
}
