window.__ModuleLoader__.load({
	id: "dsh-ui-simple-dock",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		// client/i18n.js — 文案字典 + DSH 系统 locale 桥接。
		// 不提供自己的切换按钮：语言跟随 DSH 系统设置（设置 → 通用 → 语言），
		// 组件通过 useSyncExternalStore(subscribeLocale, getLocaleRevision)
		// 订阅 locale 快照 revision，切换即重渲染；文案经 t(key, params) 翻译
		// （{name} 占位符插值，与官方 LocaleRuntime.translate 同构）。
		// 字典注册与桥接在 apply() 中完成（index.js）；locale 服务缺失时降级：
		// t 返回 key 本身。
		
		const NS = 'simple-dock'
		
		const zh = {
		  'panel.perf': '性能',
		  'panel.brief': '简报',
		  'panel.tokens': 'Token 明细',
		  'sub.total': '累计',
		  'row.llm': 'LLM 耗时',
		  'row.tool': '工具耗时',
		  'row.title': '会话标题',
		  'row.status': '状态',
		  'row.updated': '最近更新',
		  'row.inputHit': '输入（命中）',
		  'row.inputMiss': '输入（未命中）',
		  'row.output': '输出',
		  'row.ttft': '首 token 时间',
		  'row.tps': '生成速度',
		  'cost.label': '预估成本',
		  'cost.recalc': '重新计算成本',
		  'cost.notInTable': '不在内置价格表，不估算费用',
		  'cost.unavailable': '不可用',
		  'cost.loading': '加载中…',
		  'empty.noTokens': '暂无 token 数据',
		  'seg.steps': '步数',
		  'seg.hitRate': '命中率',
		  'sub.avg': '平均',
		  'sub.perStep': '均 {value}/步',
		  'sub.calls': '{count} 次 · 均 {value}/次',
		  'sub.tps': '{value} tok/s',
		  'sub.turnsSteps': '第 {turns} 轮 · 共 {steps} 步',
		  'sub.cacheWrite': '含缓存写入 {count}',
		  'status.running': '进行中',
		  'status.idle': '空闲',
		  'mode.label': '底栏面板样式',
		  'mode.translucent': '半透明',
		  'mode.classic': '传统',
		  'pricing.label': '价格表',
		  'pricing.builtin': '内置 · v4-pro/flash 峰谷计价',
		  'currency.label': '成本计价币种',
		  'currency.usd': '美元 USD',
		  'currency.cny': '人民币 CNY',
		  'glass.label': '面板玻璃',
		  'glass.blur': '模糊度',
		  'glass.frost': '磨砂度',
		  'card.desc': '底栏统计坞：性能 / 简报 / Token 明细 / 预估成本',
		  'card.on': '已启用',
		  'card.off': '已停用',
		}
		
		const en = {
		  'panel.perf': 'Performance',
		  'panel.brief': 'Brief',
		  'panel.tokens': 'Token detail',
		  'sub.total': 'total',
		  'row.llm': 'LLM time',
		  'row.tool': 'Tool time',
		  'row.title': 'Session title',
		  'row.status': 'Status',
		  'row.updated': 'Last update',
		  'row.inputHit': 'Input (cache hit)',
		  'row.inputMiss': 'Input (cache miss)',
		  'row.output': 'Output',
		  'row.ttft': 'Time to first token',
		  'row.tps': 'Generation speed',
		  'cost.label': 'Est. cost',
		  'cost.recalc': 'Recalculate cost',
		  'cost.notInTable': 'Not in built-in price table, cost skipped',
		  'cost.unavailable': 'Unavailable',
		  'cost.loading': 'Loading…',
		  'empty.noTokens': 'No token data yet',
		  'seg.steps': 'Steps',
		  'seg.hitRate': 'Hit rate',
		  'sub.avg': 'avg',
		  'sub.perStep': '{value}/step avg',
		  'sub.calls': '{count} calls · {value}/call avg',
		  'sub.tps': '{value} tok/s',
		  'sub.turnsSteps': '{turns} turns · {steps} steps',
		  'sub.cacheWrite': 'incl. cache write {count}',
		  'status.running': 'Running',
		  'status.idle': 'Idle',
		  'mode.label': 'Dock panel style',
		  'mode.translucent': 'Translucent',
		  'mode.classic': 'Classic',
		  'pricing.label': 'Price table',
		  'pricing.builtin': 'Built-in · v4-pro/flash peak pricing',
		  'currency.label': 'Cost currency',
		  'currency.usd': 'USD',
		  'currency.cny': 'CNY',
		  'glass.label': 'Panel glass',
		  'glass.blur': 'Blur',
		  'glass.frost': 'Frost',
		  'card.desc': 'Composer dock stats: performance / brief / tokens / est. cost',
		  'card.on': 'Enabled',
		  'card.off': 'Disabled',
		}
		
		/** 完整字典（zh/en 键集合一致，注册时由 locale 服务校验双语文档）。 */
		const dicts = { zh, en }
		
		// ---- locale 桥（apply 注入；缺失时降级） ----
		let subscribeFn = () => () => { /* no-op */ }
		let revisionFn = () => 0
		let translateFn = (key) => key
		
		function setLocaleFace(subscribe, getRevision, translate) {
		  subscribeFn = subscribe
		  revisionFn = getRevision
		  translateFn = translate
		}
		
		/** uSES 订阅：locale 切换或字典注册时通知。 */
		function subscribeLocale(fn) {
		  return subscribeFn(fn)
		}
		
		/** uSES 快照：monotonic revision（number，稳定）。 */
		function getLocaleRevision() {
		  return revisionFn()
		}
		
		/** 翻译当前命名空间的文案；缺词回退 key（locale 服务处理回退链）。 */
		function t(key, params) {
		  return translateFn(key, params)
		}
		
		// client/prices.js — 内置价格模型（唯一来源，不拉取外部价格表）。
		// 计费原理：金额 = token 用量 × 模型价格表，本地计算。
		//   - 思维链按输出价计费（无独立 reasoning 价目）；
		//   - 未命中输入价已含缓存写入，不重复计费（无 cacheWrite 价目）。
		
		// 峰谷时段定义（UTC 小时，半开区间 [start, end)）：
		//   峰：01:00–04:00、06:00–10:00；其余为谷。
		const PEAK_HOURS_UTC = [[1, 4], [6, 10]]
		// 峰谷计价生效时刻：2026-08-17T00:00:00Z（此前一律按旧统一价）。
		const PEAK_START_MS = Date.UTC(2026, 7, 17)
		// 周末全天谷价生效时刻：2026-08-23 00:00 北京时间（= UTC 2026-08-22 16:00）。
		// 生效后：北京时间周六/周日全天按谷价；工作日维持 PEAK_HOURS_UTC 峰谷。
		const WEEKEND_START_MS = Date.UTC(2026, 7, 22, 16)
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
		const FALLBACK_PRICES = {
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
		// 同价别名：deepseek-v4-flash-vision-exp 与 v4-flash 同价（官方
		// "Vision at Flash Price"），完全按 v4-flash 计费（含峰谷/周末谷价）。
		const ALIAS_SAME_PRICE = {
		  'deepseek-v4-flash-vision-exp': 'deepseek-v4-flash',
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
		
		function cap(s) {
		  return s === 'usd' ? 'Usd' : 'Cny'
		}
		
		// 取某模型在某时刻的适用价格（每 1M tokens）。
		//   - 模型不存在 → null；
		//   - 无峰谷的模型 → 统一价；
		//   - 峰谷生效日（2026-08-17T00:00:00Z）之前 → 统一价；
		//   - 2026-08-23 00:00 北京时间（周末全天谷价）之后：北京时间周六/周日
		//     一律谷价；工作日按 UTC 小时落峰/谷；
		//   - 两生效日之间：仅按 UTC 小时落峰/谷。
		function priceAt(modelId, currency, atMs) {
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
		  const table = inPeak
		    ? (m['peak' + cap(currency)] || m.peakUsd)
		    : (m['offPeak' + cap(currency)] || m.offPeakUsd)
		  return {
		    input: table.input ?? 0,
		    output: table.output ?? 0,
		    cacheRead: table.cacheRead ?? 0,
		  }
		}
		
		// 费用计算（1M 计）。usage = 投影聚合 {uncached, read, write, out}。
		function calcCost(usage, prices) {
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
		
		// client/core.js — 偏好（localStorage + 订阅）、展示格式化、快照派生、
		// 预估成本缓存、按消耗时刻取价。全部为纯浏览器逻辑。
		
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
		
		const getEnabled = () => enabled.get()
		const setEnabled = (v) => enabled.set(v)
		const subscribeEnabled = (fn) => enabled.subscribe(fn)
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
		
		// ---- 预估成本：按每次消耗的精确时间与模型取价（本地计算） ----
		// 数据来源：会话快照 assistant 节点。每步带 timing.completedTime
		// （Unix epoch ms，精确到毫秒）、该步 usage（input/output/cacheRead/
		// cacheWrite）与 requestConfig.model / provenance.model（该步所用模型）。
		// 投影 tokenUsage 只有聚合总量、无时间戳，因此按步扫描节点取价，
		// 与投影总量之差（节点缺 usage 的步）按会话最近时刻补算。
		
		// 每步消耗记录：{ at, model, usage }。at 为 null 表示该步无时间记录
		//（窗口截断/旧会话），计价时按最近已知时刻近似；usage 为 null 表示无用量。
		function stepCosts(nodes) {
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
		function currentModel(nodes) {
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
		async function computeSessionCost(nodes, usage, currencyCode) {
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
		const PRICE_VERSION = 4
		
		function readCostCache(sessionId) {
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
		
		function writeCostCache(sessionId, data) {
		  try {
		    window.localStorage.setItem(COST_CACHE_PREFIX + sessionId,
		      JSON.stringify({ data, fetchedAt: Date.now(), priceVersion: PRICE_VERSION }))
		  } catch (e) {
		    // Storage unavailable (private mode): the in-memory fallback still works.
		  }
		}
		
		// ---- 周期性调度（静态 bundle 运行在页面内，浏览器 timer 可用） ----
		function scheduleInterval(callback, delayMs) {
		  const id = setInterval(callback, delayMs)
		  return () => clearInterval(id)
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
		
		function fmtCost(value, currencyCode) {
		  if (!(typeof value === 'number' && Number.isFinite(value)) || value < 0) return '—'
		  const symbol = currencyCode === 'cny' ? '¥' : '$'
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
		
		// client/components.js — React 组件：底栏 StatsDock、设置行（Mode/Pricing/
		// Currency/Glass）、设置 → 插件卡片。全部 React.createElement，无 JSX。
		
		// 跟随 DSH 系统语言的 hook：locale 快照 revision 变化（系统语言切换、
		// 字典注册）即触发组件重渲染；文案在渲染时经 t() 取当前语言。
		function useLocale() {
		  return React.useSyncExternalStore(subscribeLocale, getLocaleRevision)
		}
		
		function darkTheme() {
		  return typeof document !== 'undefined' && document.body !== null
		    ? document.body.hasAttribute('data-ds-dark-theme')
		    : false
		}
		
		// 磨砂玻璃填充 + 模糊都走 CSS 变量，旋钮改动实时生效、无需重渲染：
		//   每块面板的 --dsstat-blur / --dsstat-frost（styles.css 中定义）直接绑定
		//   本插件「面板玻璃」滑杆（--dsh-dstat-blur / --dsh-dstat-frost）。
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
		  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
		  const [leftOpen, setLeftOpen] = React.useState(false)
		  const [rightOpen, setRightOpen] = React.useState(false)
		  const rootRef = React.useRef(null)
		  const panelMode = React.useSyncExternalStore(subscribePanelMode, getPanelMode)
		  useLocale()
		
		  // 面板弹出期间把 composerSeat 临时提到「回到底部」按钮（z-8）之上。
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
		
		  // ---- 数据源（随 DSH 版本演进，双通道防御） ----
		  // 新版（0.1.2+）：SessionSnapshot 不再携带会话节点，会话内容走 useChat
		  //（ChatSnapshot 选择器，legacy.nodes 为兼容投影，字段与旧版一致）。
		  // 旧版：useSession 返回含 chat.legacy.nodes 的大快照。
		  const useChat = typeof props.useChat === 'function' ? props.useChat : null
		  const chatNodes = useChat === null
		    ? undefined
		    : useChat(s => (s && s.legacy && Array.isArray(s.legacy.nodes) ? s.legacy.nodes : []))
		  const useSession = typeof props.useSession === 'function' ? props.useSession : null
		  const session = useSession === null ? props.session : useSession(s => s)
		  const useProjection = typeof props.useProjection === 'function' ? props.useProjection : null
		  const usageProjection = useProjection === null ? undefined : useProjection('tokenUsage')
		  const statsProjection = useProjection === null ? undefined : useProjection('sessionStats')
		
		  const sessionId = props.sessionId !== undefined && props.sessionId !== null
		    ? props.sessionId
		    : (session ? session.sessionId : undefined)
		  const summary = typeof props.useSessions === 'function'
		    ? props.useSessions(st => (st && st.byId && sessionId !== undefined ? st.byId[sessionId] : undefined))
		    : undefined
		
		  const nodes = chatNodes !== undefined
		    ? chatNodes
		    : (session && session.chat && session.chat.legacy && session.chat.legacy.nodes)
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
		
		  // ---- 会话费用（纯客户端）：单行「预估成本 金额 ↻」 ----
		  // 打开面板：先显示该会话缓存的上次结果（不闪加载），后台更新成功后
		  // 替换显示并写回缓存；更新失败时保留当前显示。
		  const [costState, setCostState] = React.useState({ loading: false, data: null, error: null })
		  const [costTick, setCostTick] = React.useState(0)
		  const currency = React.useSyncExternalStore(subscribeCurrency, getCurrency)
		
		  React.useEffect(() => {
		    if (!rightOpen || usage === null) return
		    let alive = true
		    if (sessionId === undefined) return
		    const cached = readCostCache(sessionId)
		    if (cached !== null && cached.data && cached.data.currency === currency) {
		      setCostState({ loading: false, data: cached.data, error: null })
		    } else {
		      setCostState((s) => ({ ...s, loading: true }))
		    }
		    computeSessionCost(nodes, usage, currency)
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
		  }, [rightOpen, sessionId, costTick, currency, nodes, usage])
		
		  // 后台每小时刷新一次当前会话的缓存（即使面板未打开）；启动即刷一次预热。
		  React.useEffect(() => {
		    if (sessionId === undefined || usage === null) return
		    const refresh = () => {
		      computeSessionCost(nodes, usage, currency)
		        .then((res) => { if (res && res.ok === true) writeCostCache(sessionId, res) })
		        .catch(() => { /* 后台失败静默，下小时重试 */ })
		    }
		    refresh()
		    const disposer = scheduleInterval(refresh, 60 * 60 * 1000)
		    return () => { if (disposer !== null) disposer() }
		  }, [sessionId, currency, nodes, usage])
		
		  const costLine = (() => {
		    const data = costState.data
		    if (data && data.ok === true) {
		      return { value: fmtCost(data.cost.total, data.currency), sub: '' }
		    }
		    if (data && data.ok === false) {
		      const msg = data.error || ''
		      // 不在内置价格表的模型：不显示预估价格。
		      if (typeof msg === 'string' && msg.indexOf('未知模型价格') === 0) {
		        return { value: '—', sub: t('cost.notInTable') }
		      }
		      return { value: t('cost.unavailable'), sub: msg }
		    }
		    if (costState.loading) return { value: t('cost.loading'), sub: '' }
		    if (costState.error) return { value: t('cost.unavailable'), sub: costState.error }
		    return { value: '—', sub: '' }
		  })()
		
		  const refreshCost = React.createElement('button', {
		    className: 'dsstat-refresh' + (costState.loading ? ' busy' : ''),
		    onClick: (e) => { e.stopPropagation(); setCostTick((t) => t + 1) },
		    title: t('cost.recalc'),
		    'aria-label': t('cost.recalc'),
		  }, costState.loading ? '…' : '↻')
		
		  const costSection = React.createElement('div', { className: 'dsstat-cost-line', key: 'cost' },
		    React.createElement('span', { className: 'dsstat-cost-label' }, t('cost.label')),
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
		    heading('h-perf', t('panel.perf')),
		    row('llm', t('row.llm'), fmtDuration(stats.llmMs),
		      stats.steps > 0 && stats.llmMs > 0 ? t('sub.perStep', { value: fmtDuration(stats.llmMs / stats.steps) }) : ''),
		    row('tool', t('row.tool'), fmtDuration(stats.toolMs),
		      stats.toolCalls > 0 ? t('sub.calls', { count: stats.toolCalls, value: fmtDuration(stats.toolMs / stats.toolCalls) }) : ''),
		    divider('d-brief'),
		    heading('h-brief', t('panel.brief')),
		    row('title', t('row.title'),
		      title === undefined
		        ? '—'
		        : React.createElement('span', { className: 'dsstat-v dsstat-ellip', title }, title)),
		    row('status', t('row.status'), running === undefined ? '—' : (running ? t('status.running') : t('status.idle'))),
		    row('update', t('row.updated'), clock === null ? '—' : clock,
		      t('sub.turnsSteps', { turns: stats.turns, steps: stats.steps })),
		  )
		
		  const tokenRows = usage === null || (billed === 0 && usage.out === 0)
		    ? [React.createElement('div', { className: 'dsstat-empty', key: 'empty' }, t('empty.noTokens'))]
		    : [
		      row('in-hit', t('row.inputHit'), fmtExact(usage.read)),
		      row('in-miss', t('row.inputMiss'), fmtExact(usage.uncached + usage.write),
		        usage.write > 0 ? t('sub.cacheWrite', { count: fmtExact(usage.write) }) : ''),
		      row('out', t('row.output'), fmtExact(usage.out)),
		    ]
		
		  const rightPanel = React.createElement('div', {
		    className: 'dsstat-panel dsstat-panel-right' + (rightOpen ? ' open' : '') + glass,
		    style: panelStyle,
		  },
		    heading('h-tokens', t('panel.tokens'), t('sub.total')),
		    ...tokenRows,
		    divider('d-metrics'),
		    row('ttft', t('row.ttft'), avgTtft === null ? '—' : fmtDuration(avgTtft), t('sub.avg')),
		    row('tps', t('row.tps'), tps === null ? '—' : `${fmtTps(tps)} tok/s`, t('sub.avg')),
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
		
		  // 插件停用时底栏区域留空（官方统计行由本插件占据，不再渲染）。
		  if (!enabled) return null
		
		  return React.createElement('div', { className: 'dsstat-root', ref: rootRef },
		    seg('seg-steps', leftOpen, () => setLeftOpen(!leftOpen), t('seg.steps'), String(stats.steps)),
		    seg('seg-hit', rightOpen, () => setRightOpen(!rightOpen), t('seg.hitRate'), hitRate === null ? '—' : hitRate + '%'),
		    leftPanel,
		    rightPanel,
		  )
		}
		
		// Settings row (Settings → General): translucent vs classic panel style.
		function ModeRow() {
		  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
		  const mode = React.useSyncExternalStore(subscribePanelMode, getPanelMode)
		  useLocale()
		  const btn = (label, value) => React.createElement('button', {
		    className: 'dsstat-mode-btn' + (mode === value ? ' active' : ''),
		    onClick: () => setPanelMode(value),
		  }, label)
		  if (!enabled) return null
		  return React.createElement('div', { className: 'dsstat-mode-row' },
		    React.createElement('span', { className: 'dsstat-mode-label' }, t('mode.label')),
		    React.createElement('div', { className: 'dsstat-mode-seg' },
		      btn(t('mode.translucent'), 'translucent'),
		      btn(t('mode.classic'), 'classic'),
		    ),
		  )
		}
		
		// Settings row (Settings → General): 内置价格表说明（无外部拉取）。
		// 成本按每次消耗的精确时间取峰/谷价：v4-pro / v4-flash 自 2026-08-17
		// 起分峰谷（UTC 01–04 与 06–10 为峰，谷为峰价一半），其余模型统一价。
		function PricingRow() {
		  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
		  useLocale()
		  if (!enabled) return null
		  return React.createElement('div', { className: 'dsstat-mode-row' },
		    React.createElement('span', { className: 'dsstat-mode-label' }, t('pricing.label')),
		    React.createElement('div', { className: 'dsstat-mode-seg dsstat-pricing-seg' },
		      React.createElement('span', { className: 'dsstat-pricing-text' }, t('pricing.builtin')),
		    ),
		  )
		}
		
		// Settings row (Settings → General): display currency for session cost.
		function CurrencyRow() {
		  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
		  const currency = React.useSyncExternalStore(subscribeCurrency, getCurrency)
		  useLocale()
		  const btn = (label, value) => React.createElement('button', {
		    className: 'dsstat-mode-btn' + (currency === value ? ' active' : ''),
		    onClick: () => setCurrency(value),
		  }, label)
		  if (!enabled) return null
		  return React.createElement('div', { className: 'dsstat-mode-row' },
		    React.createElement('span', { className: 'dsstat-mode-label' }, t('currency.label')),
		    React.createElement('div', { className: 'dsstat-mode-seg' },
		      btn(t('currency.usd'), 'usd'),
		      btn(t('currency.cny'), 'cny'),
		    ),
		  )
		}
		
		// Settings row (Settings → General): 面板玻璃模糊度/磨砂度滑杆。
		function GlassRow() {
		  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
		  const blur = React.useSyncExternalStore(subscribeGlass, getBlurPref)
		  const frost = React.useSyncExternalStore(subscribeGlass, getFrostPref)
		  useLocale()
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
		  if (!enabled) return null
		  return React.createElement('div', { className: 'dsstat-glass-row' },
		    React.createElement('div', { className: 'dsstat-glass-head' },
		      React.createElement('span', { className: 'dsstat-mode-label' }, t('glass.label')),
		    ),
		    knob(t('glass.blur'), blur, 0, 40, 0.5, ' px', setBlurPref),
		    knob(t('glass.frost'), frost, 0, 100, 1, ' %', setFrostPref),
		  )
		}
		
		// Settings → Plugins card: master on/off switch (same shape as other plugin cards).
		function PluginCard() {
		  const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled)
		  useLocale()
		  return React.createElement('li', { className: 'dsstat-card' },
		    React.createElement('div', { className: 'dsstat-card-head' },
		      React.createElement('div', { className: 'dsstat-card-text' },
		        React.createElement('div', { className: 'dsstat-card-title' }, 'Simple Dock'),
		        React.createElement('div', { className: 'dsstat-card-desc' }, t('card.desc')),
		      ),
		      React.createElement('button', {
		        type: 'button',
		        className: 'dsstat-card-toggle',
		        'aria-pressed': enabled,
		        onClick: () => setEnabled(!enabled),
		      },
		        React.createElement('span', { className: 'dsstat-card-check' }, enabled ? '✓' : ''),
		        enabled ? t('card.on') : t('card.off'),
		      ),
		    ),
		  )
		}
		
		// client/index.js — Simple Dock 客户端插件入口：注入样式 + 注册 6 个 slot。
		// 依赖：slots 服务（bundle 里由 dsh-client-runtime 提供）+ locale 服务
		//（dsh-client-locale，跟随 DSH 系统语言设置，不提供自己的切换按钮）。
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
		
		/* Settings → Plugins card (same shape as other plugin cards). */
		.dsstat-card {
		  list-style: none;
		  margin: 0;
		  padding: 0;
		}
		.dsstat-card-head {
		  display: flex;
		  align-items: center;
		  justify-content: space-between;
		  gap: 16px;
		  padding: 16px;
		  border: 1px solid var(--dsw-alias-border-l2);
		  border-radius: 12px;
		  background: var(--dsw-alias-bg-layer-1);
		}
		.dsstat-card-text {
		  display: flex;
		  flex-direction: column;
		  gap: 2px;
		  min-width: 0;
		}
		.dsstat-card-title {
		  color: var(--dsw-alias-label-primary);
		  font-size: 14px;
		  font-weight: 500;
		  line-height: 22px;
		}
		.dsstat-card-desc {
		  color: var(--dsw-alias-label-tertiary);
		  font-size: 12px;
		  line-height: 18px;
		}
		.dsstat-card-toggle {
		  display: inline-flex;
		  align-items: center;
		  gap: 6px;
		  flex: none;
		  height: 28px;
		  padding: 0 10px 0 6px;
		  border: 1px solid var(--dsw-alias-border-l2);
		  border-radius: 14px;
		  background: transparent;
		  color: var(--dsw-alias-label-primary);
		  font-size: 12px;
		  line-height: 18px;
		  cursor: pointer;
		}
		.dsstat-card-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); }
		.dsstat-card-check {
		  display: inline-flex;
		  align-items: center;
		  justify-content: center;
		  width: 16px;
		  height: 16px;
		  border-radius: 50%;
		  font-size: 11px;
		  line-height: 1;
		  color: var(--dsw-alias-bg-layer-1);
		  background: var(--dsw-alias-state-success-primary, var(--dsw-alias-brand-primary));
		}
		`
		
		/**
		 * Required services: the slot registry plus the locale runtime. Both are
		 * inject-declared so Cordis activates this plugin only after they exist:
		 * the locale roster row (dsh-client-locale) may apply after this one, and a
		 * bare ctx.get('locale') at apply time can then miss it and silently leave
		 * every label on the key-string fallback. Injecting 'locale' makes Cordis
		 * wait for the service instead.
		 */
		const inject = ['slots', 'locale']
		
		/**
		 * Client plugin body: inject the stylesheet (plugin-owned style tag, removed
		 * with the fiber) and register the composer dock plus the settings surfaces.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
		  const slots = ctx.get('slots')
		  if (slots === undefined) return
		
		  // 跟随 DSH 系统语言：注册字典并把 locale 的 subscribe/getSnapshot/bind
		  // 桥给组件（组件用 useSyncExternalStore 订阅 revision 重渲染）。
		  const locale = ctx.get('locale')
		  if (locale !== undefined) {
		    ctx.effect(() => locale.register(NS, dicts), 'simple-dock: dictionaries')
		    setLocaleFace(
		      (fn) => locale.subscribe(fn),
		      () => locale.getSnapshot().revision,
		      locale.bind(NS),
		    )
		  }
		
		  applyGlassVars()
		
		  // Plugin-owned stylesheet: <style data-plugin="…"> is the loader convention;
		  // the fiber disposer removes it on unload.
		  ctx.effect(() => {
		    const style = document.createElement('style')
		    style.setAttribute('data-plugin', 'dsh-ui-simple-dock')
		    style.textContent = css
		    document.head.appendChild(style)
		    return () => { style.remove() }
		  })
		
		  // Composer dock: replaces the official stats line. Official one sits at
		  // priority 0; shadowing needs a strictly lower priority (lowest renders).
		  // 开关（设置 → 插件卡片）关闭时注销本注册，官方 stats 行恢复显示；
		  // 重新开启再注册。StatsDock 内部 enabled=false 返回 null 只是双保险。
		  let dockDisposer = null
		  // 订阅回调是无参调用（createPref 的 listener 不携带新值），所以这里
		  // 不接收参数、直接读当前 pref：停用 → 注销（官方 stats 行恢复显示），
		  // 启用 → 重新注册。StatsDock 内部 enabled=false 返回 null 只是双保险。
		  const syncDock = () => {
		    const on = getEnabled()
		    if (on && dockDisposer === null) {
		      dockDisposer = slots.inject('conversation.composer.dock', () => slots.register(
		        { name: 'conversation.composer.dock', id: 'stats', priority: -1, label: 'stats' },
		        (props) => React.createElement(StatsDock, props),
		      ))
		    } else if (!on && dockDisposer !== null) {
		      dockDisposer()
		      dockDisposer = null
		    }
		  }
		  ctx.effect(() => {
		    syncDock(getEnabled())
		    return subscribeEnabled(syncDock)
		  })
		
		  // Settings → Plugins: master on/off card (same shape as other plugin cards).
		  // This slot is keyed by the settings namespace the card edits; the key must
		  // be one the Host serves — the `simple-dock` namespace registered by the
		  // node half — or the owner never dispatches the card.
		  slots.inject('settings.plugin.item', () => slots.register(
		    { name: 'settings.plugin.item', key: 'simple-dock', order: 6, label: 'Simple Dock' },
		    () => React.createElement(PluginCard, {}),
		  ))
		
		  // Settings → General: four rows (labels follow the system locale).
		  slots.inject('settings.general.item', () => slots.register(
		    { name: 'settings.general.item', id: 'dstat-mode', order: 12, label: () => t('mode.label') },
		    () => React.createElement(ModeRow, {}),
		  ))
		  slots.inject('settings.general.item', () => slots.register(
		    { name: 'settings.general.item', id: 'dstat-pricing', order: 13, label: () => t('pricing.label') },
		    () => React.createElement(PricingRow, {}),
		  ))
		  slots.inject('settings.general.item', () => slots.register(
		    { name: 'settings.general.item', id: 'dstat-currency', order: 14, label: () => t('currency.label') },
		    () => React.createElement(CurrencyRow, {}),
		  ))
		  slots.inject('settings.general.item', () => slots.register(
		    { name: 'settings.general.item', id: 'dstat-glass', order: 15, label: () => t('glass.label') },
		    () => React.createElement(GlassRow, {}),
		  ))
		}
		
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
