/**
 * Simple Dock node half. Three jobs:
 *   1. Register the plugin's own settings namespace so the "设置 → 插件" card
 *      dispatches by it (the card's enabled state lives in the browser half).
 *   2. Own the cost engine: at startup precompute every stored session and, for
 *      a session that has no cost records yet (a fresh install), fully backfill
 *      it; then keep each session current from `session/event`, so the browser
 *      half only reads a number instead of re-pricing the conversation.
 *   3. Persist each priced step back into its own session log as one
 *      `simple-dock/cost` event, so the cost lives with the session record and
 *      survives a restart without recomputation.
 *
 * Log writes are limited to that single event type on format-v3 sessions and
 * always carry `ignorable: true`: first-party readers skip an unrecognized
 * ignorable event instead of refusing the log (see the Agent Note on retaining
 * ignorable external session events). A session still held by its agent cannot
 * be opened for writing, so its steps stay in memory until the session is
 * disposed or the next startup backfills them.
 *
 * Everything else (pricing rules) comes from the shared `./prices.js` module.
 */
import z from '@deepseek-ai/schemastery'
import { priceAt, PRICE_VERSION } from './prices.js'

/** Same-origin read-only endpoint returning one session's priced cost. */
const COST_ROUTE = '/dsh-simple-dock/api/cost'
/** Session event type carrying one step's cost plus the running total. */
const COST_EVENT = 'simple-dock/cost'
/** Session log format this plugin is allowed to append to. */
const SESSION_FORMAT_VERSION = 3
/** Sessions priced in parallel during the startup warm-up. */
const WARM_CONCURRENCY = 2
/** Every currency the engine prices at once, so the UI can switch instantly. */
const CURRENCIES = ['usd', 'cny']
/** Log prefix for startup warm-up and write failures. */
const LOG_TAG = '[simple-dock]'

/** Coerce a possibly-absent token count to a finite number. */
function count(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Zero cost breakdown for one currency. */
function zeroCost() {
  return { hit: 0, miss: 0, out: 0, total: 0 }
}

/** Zero totals across every priced currency. */
export function zeroTotals() {
  const totals = {}
  for (const currency of CURRENCIES) totals[currency] = zeroCost()
  return totals
}

/** Sum two cost breakdowns field by field. */
function addCost(left, right) {
  return {
    hit: left.hit + right.hit,
    miss: left.miss + right.miss,
    out: left.out + right.out,
    total: left.total + right.total,
  }
}

/**
 * Add one step's per-currency cost onto running totals. A currency the step
 * could not be priced in (unknown model) keeps its previous total.
 * @param totals - running totals keyed by currency.
 * @param stepCost - per-currency breakdown from {@link costOfStep}.
 * @returns the new totals object (inputs are not mutated).
 */
export function addTotals(totals, stepCost) {
  const next = {}
  for (const currency of CURRENCIES) {
    const add = stepCost === null || stepCost === undefined ? undefined : stepCost[currency]
    next[currency] = add === null || add === undefined ? { ...totals[currency] } : addCost(totals[currency], add)
  }
  return next
}

/**
 * Project stored session events onto the per-step rows the cost engine prices.
 * Only assistant messages that carry usage contribute.
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
      seq: typeof event.seq === 'number' ? event.seq : null,
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
 * Price one step in every currency at its own completion time.
 * @param step - one row from {@link stepsFromEvents}.
 * @returns per-currency breakdowns, or null when no currency knows the model.
 */
export function costOfStep(step) {
  const at = step.time === null ? 0 : step.time
  const result = {}
  let priced = false
  for (const currency of CURRENCIES) {
    const price = step.model === null ? null : priceAt(step.model, currency, at)
    if (price === null) {
      result[currency] = null
      continue
    }
    const hit = (step.read * (price.cacheRead || 0)) / 1e6
    const miss = ((step.uncached + step.write) * (price.input || 0)) / 1e6
    const out = (step.out * (price.output || 0)) / 1e6
    result[currency] = { hit, miss, out, total: hit + miss + out }
    priced = true
  }
  return priced ? result : null
}

/** The cost record one step writes into the session log. */
export function costEventData(step, stepCost, totals, steps) {
  return {
    at: step.time,
    model: step.model,
    sourceSeq: step.seq,
    step: stepCost,
    cumulative: totals,
    steps,
    priceVersion: PRICE_VERSION,
  }
}

/** Normalize a stored cumulative breakdown back into full per-currency totals. */
function normalizeTotals(raw) {
  const totals = zeroTotals()
  if (raw === null || typeof raw !== 'object') return totals
  for (const currency of CURRENCIES) {
    const value = raw[currency]
    if (value === null || typeof value !== 'object') continue
    totals[currency] = {
      hit: count(value.hit),
      miss: count(value.miss),
      out: count(value.out),
      total: count(value.total),
    }
  }
  return totals
}

/**
 * Find the newest usable cost record in a stored log. A record written under a
 * different price version is stale and ignored, so the session is re-priced.
 * @param events - session events read from persistence.
 * @returns `{ seq, steps, totals }`, or null when the log has no usable record.
 */
export function baselineFromEvents(events) {
  let baseline = null
  for (const event of events) {
    if (event === null || typeof event !== 'object' || event.type !== COST_EVENT) continue
    const data = event.data
    if (data === null || typeof data !== 'object') continue
    if (data.priceVersion !== PRICE_VERSION) continue
    if (typeof data.steps !== 'number' || data.cumulative === undefined) continue
    baseline = {
      seq: typeof data.sourceSeq === 'number' ? data.sourceSeq : null,
      steps: data.steps,
      totals: normalizeTotals(data.cumulative),
    }
  }
  return baseline
}

/** Detached header facts: lineage for merging, format version for write safety. */
function pickHeader(header) {
  if (header === null || header === undefined || typeof header !== 'object') {
    return { parentSession: null, origin: null, version: null }
  }
  return {
    parentSession: typeof header.parentSession === 'string' ? header.parentSession : null,
    origin: typeof header.origin === 'string' ? header.origin : null,
    version: typeof header.version === 'number' ? header.version : null,
  }
}

/** Accumulate one step onto an entry in place (total, step count, pending row). */
function stepInto(entry, step) {
  const stepCost = costOfStep(step)
  if (step.seq !== null) entry.seq = step.seq
  if (stepCost === null) {
    entry.unpriced += 1
    return
  }
  entry.totals = addTotals(entry.totals, stepCost)
  entry.steps += 1
  entry.pending.push(costEventData(step, stepCost, entry.totals, entry.steps))
}

/**
 * Build one session's cost entry from its stored log: reuse the newest usable
 * record as the baseline and price only the steps after it. A session with no
 * record (fresh install) is fully priced, which is the startup backfill.
 * @param id - session id.
 * @param header - the session header (lineage and format version).
 * @param events - session events read from persistence.
 * @returns the entry: `{ id, header, seq, steps, totals, pending, unpriced }`.
 */
export function entryFromEvents(id, header, events) {
  const baseline = baselineFromEvents(events)
  const entry = {
    id,
    header: pickHeader(header),
    seq: baseline === null ? null : baseline.seq,
    steps: baseline === null ? 0 : baseline.steps,
    totals: baseline === null ? zeroTotals() : baseline.totals,
    pending: [],
    unpriced: 0,
  }
  for (const step of stepsFromEvents(events)) {
    if (baseline !== null && baseline.seq !== null && step.seq !== null && step.seq <= baseline.seq) continue
    stepInto(entry, step)
  }
  return entry
}

/** Accumulate one live step onto an existing entry; false when already priced. */
export function applyLiveStep(entry, step) {
  if (step.seq !== null && entry.seq !== null && step.seq <= entry.seq) return false
  stepInto(entry, step)
  return true
}

/**
 * Merge one session with every descendant reached through `header.parentSession`,
 * so a parent view reports what its subagent sessions also spent.
 * @param entries - sessionId → entry map.
 * @param id - the session to report.
 * @returns `{ steps, totals, subagents: { sessions, steps, totals } }`.
 */
export function mergeLineage(entries, id) {
  const subagents = { sessions: 0, steps: 0, totals: zeroTotals() }
  let steps = 0
  let totals = zeroTotals()
  const seen = new Set()
  const queue = [id]
  while (queue.length > 0) {
    const current = queue.shift()
    if (seen.has(current)) continue
    seen.add(current)
    const entry = entries.get(current)
    if (entry !== undefined) {
      steps += entry.steps
      totals = addTotals(totals, entry.totals)
      if (current !== id) {
        subagents.sessions += 1
        subagents.steps += entry.steps
        subagents.totals = addTotals(subagents.totals, entry.totals)
      }
    }
    for (const [childId, child] of entries) {
      if (childId !== current && child.header !== undefined && child.header.parentSession === current) {
        queue.push(childId)
      }
    }
  }
  return { steps, totals, subagents }
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

/** The id of the live session an event belongs to. */
function sessionIdOf(session) {
  if (session === null || session === undefined || typeof session !== 'object') return null
  return typeof session.id === 'string' && session.id !== '' ? session.id : null
}

/** One usage-bearing assistant event as a priced step row, or null. */
function stepOfEvent(event) {
  const steps = stepsFromEvents([event])
  return steps.length > 0 ? steps[0] : null
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

  // Cost engine: warm every stored session at startup, stay current from the
  // append feed, and persist each step's cost into its own session log.
  ctx.inject(['sessionPersistence'], (sessionCtx) => {
    /** sessionId → entry (see {@link entryFromEvents}). */
    const entries = new Map()

    /** Replace/keep an entry: a longer (higher-seq) entry wins over a warm-up read. */
    const store = (entry) => {
      const current = entries.get(entry.id)
      if (current !== undefined && current.seq !== null && (entry.seq === null || current.seq >= entry.seq)) return current
      entries.set(entry.id, entry)
      return entry
    }

    /**
     * Write one session's unpriced-in-log steps back into its session log.
     * An active session still owns its writer, so a rejection just keeps the
     * steps in memory for the dispose hook or the next startup.
     */
    const flushSession = async (id) => {
      const entry = entries.get(id)
      if (entry === undefined || entry.pending.length === 0) return
      if (entry.header.version !== SESSION_FORMAT_VERSION) return
      let handle
      try {
        handle = await sessionCtx.sessionPersistence.open(id, 'write')
      } catch (error) {
        // SessionStillOwned by its agent: keep pending for later.
        return
      }
      try {
        const read = await handle.read()
        const events = read.events ?? []
        const lastSeq = events.length > 0 ? events[events.length - 1].seq : -1
        const batch = entry.pending.map((data, index) => ({
          type: COST_EVENT,
          seq: lastSeq + 1 + index,
          time: Date.now(),
          data,
          ignorable: true,
        }))
        await handle.append(batch)
        await handle.flush()
        entry.pending = []
      } catch (error) {
        console.error(LOG_TAG, 'cost write failed for', id, error instanceof Error ? error.message : error)
      } finally {
        try {
          await handle.close()
        } catch {
          // The batch is already committed; a close failure changes nothing.
        }
      }
    }

    /** Read+price one stored session from its log. */
    const warmOne = async (snapshot) => {
      const id = snapshot.header.id
      let handle
      try {
        handle = await sessionCtx.sessionPersistence.open(id, 'read')
      } catch (error) {
        return
      }
      let entry
      try {
        const read = await handle.read()
        entry = entryFromEvents(id, snapshot.header, read.events ?? [])
      } finally {
        try {
          await handle.close()
        } catch {
          // A read-only handle carries nothing to drain.
        }
      }
      const kept = store(entry)
      if (kept === entry && entry.pending.length > 0) await flushSession(id)
    }

    /** Ensure one session is priced; used when a request arrives before warm-up. */
    const ensure = async (id) => {
      const current = entries.get(id)
      if (current !== undefined) return current
      let snapshot
      try {
        snapshot = await sessionCtx.sessionPersistence.stat(id)
      } catch (error) {
        snapshot = undefined
      }
      if (snapshot === undefined) return undefined
      await warmOne(snapshot)
      return entries.get(id)
    }

    /** Price every stored session, WARM_CONCURRENCY at a time. */
    const warmAll = async () => {
      let snapshots
      try {
        snapshots = await sessionCtx.sessionPersistence.list()
      } catch (error) {
        console.error(LOG_TAG, 'session list failed:', error instanceof Error ? error.message : error)
        return
      }
      const queue = [...snapshots]
      let backfilled = 0
      let written = 0
      const workers = Array.from({ length: WARM_CONCURRENCY }, async () => {
        while (queue.length > 0) {
          const snapshot = queue.shift()
          if (snapshot === undefined) return
          try {
            await warmOne(snapshot)
            const entry = entries.get(snapshot.header.id)
            if (entry !== undefined && entry.pending.length === 0 && entry.steps > 0) backfilled += 1
            written += 1
          } catch (error) {
            console.error(LOG_TAG, 'warm-up failed for', snapshot.header.id, error instanceof Error ? error.message : error)
          }
        }
      })
      await Promise.all(workers)
      console.log(LOG_TAG, `cost warm-up done: ${String(written)}/${String(snapshots.length)} session(s) priced, ${String(backfilled)} complete`)
    }

    // Append feed: price each new step, keep the entry current, queue it for
    // the log. Scope-filtered dispatch means a root listener sees every session.
    sessionCtx.effect(() => sessionCtx.on('session/event', (session, event) => {
      if (event === null || typeof event !== 'object' || event.type !== 'assistant/message') return
      const id = sessionIdOf(session)
      if (id === null) return
      const step = stepOfEvent(event)
      if (step === null) return
      let entry = entries.get(id)
      if (entry === undefined) {
        entry = {
          id,
          header: pickHeader(session.header),
          seq: null,
          steps: 0,
          totals: zeroTotals(),
          pending: [],
          unpriced: 0,
        }
        entries.set(id, entry)
      }
      applyLiveStep(entry, step)
    }))

    // A disposed session released its writer: persist what memory still holds.
    sessionCtx.effect(() => sessionCtx.on('session/disposed', (session) => {
      const id = sessionIdOf(session)
      if (id === null) return
      void flushSession(id)
    }))

    // Startup backfill: sessions with no cost record yet are fully priced.
    sessionCtx.effect(() => {
      void warmAll()
      return () => {
        // Best effort: DSH shutdown does not wait for async writers.
        for (const id of entries.keys()) void flushSession(id)
      }
    })

    // Same-origin read-only cost endpoint for the browser half.
    sessionCtx.inject(['webServer'], (webCtx) => {
      webCtx.effect(() => webCtx.webServer.register({
        kind: 'exact',
        path: COST_ROUTE,
        handler: async (req, res) => {
          if (req.method !== 'GET' || !sameOrigin(req)) {
            res.writeHead(403).end()
            return
          }
          let url = null
          let sessionId = null
          try {
            url = new URL(req.url ?? '/', 'http://dsh.invalid')
            sessionId = url.searchParams.get('sessionId')
          } catch {
            sessionId = null
          }
          if (sessionId === null || sessionId === '') {
            json(res, 400, { ok: false, reason: 'bad-request' })
            return
          }
          try {
            if (url !== null && url.searchParams.get('refresh') === '1') entries.delete(sessionId)
            let entry = await ensure(sessionId)
            // A session created after warm-up is picked up on first read.
            if (entry === undefined && entries.size === 0) {
              await warmAll()
              entry = await ensure(sessionId)
            }
            if (entry === undefined) {
              json(res, 404, { ok: false, reason: 'session-unreadable' })
              return
            }
            const merged = mergeLineage(entries, sessionId)
            json(res, 200, {
              ok: true,
              steps: merged.steps,
              totals: merged.totals,
              subagents: merged.subagents,
              unpriced: entry.unpriced,
              pending: entry.pending.length,
              updatedAt: Date.now(),
            })
          } catch (error) {
            json(res, 404, {
              ok: false,
              reason: 'session-unreadable',
              message: error instanceof Error ? error.message : String(error),
            })
          }
        },
      }))
    })
  })
}
