#!/usr/bin/env node
// build.js — 零依赖打包器：把 src/client 模块树打包成 bundle 客户端产物
// lib/client.js（window.__ModuleLoader__.load({id, factory}) 格式），并生成
// node 半区 lib/index.js 与手写类型声明。构建即验证（语法 + 冒烟）。
//
// 约定（保持简单，避免引入转译器）：
//   - 模块间只用具名 import/export；构建时删除 import/export 关键字，
//     全部声明合并进同一个函数作用域（同名冲突由我们自行避免）；
//   - 入口的 `import { css } from './styles.js'` 由本脚本替换为模板字符串；
//   - CSS 内不得出现反引号或 ${；
//   - 外部依赖只有 'react'（loader 模块表平台项），其余全靠注入的 ctx。
//
// 用法：node build.js   →  输出 lib/index.js、lib/client.js、lib/types/*

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)))
const SRC = join(ROOT, 'src')
const CLIENT_SRC = join(SRC, 'client')
const LIB = join(ROOT, 'lib')

const PACKAGE_NAME = 'dsh-ui-simple-dock'

const IMPORT_RE = /^import[\s\S]*?from '[^']*'\n/gm // 单行/多行 import 均匹配
const EXPORT_RE = /^export /gm

function read(file) {
  return readFileSync(file, 'utf8')
}

// 普通模块 → 函数体内的顶层声明（去 import/export）。
function moduleBody(file) {
  return read(file).replace(IMPORT_RE, '').replace(EXPORT_RE, '').trimEnd() + '\n'
}

// 入口模块：替换 styles.js 具名导入 → CSS 常量，去掉其余具名 import 与
// `export ` 关键字，保留 `const inject` 与 `function apply(ctx)` 完整声明，
// 这样 bundle 顶层不会出现游离的 apply 函数体（否则 ctx 未定义）。
function entryParts(file) {
  let text = read(file)
  if (/^import \{ css \} from '\.\/styles\.js'\n/m.test(text)) {
    const css = read(join(CLIENT_SRC, 'styles.css'))
    if (css.includes('`') || css.includes('${')) {
      throw new Error('styles.css 含反引号或 ${，无法注入模板字符串')
    }
    text = text.replace(/^import \{ css \} from '\.\/styles\.js'\n/m, 'const css = `' + css + '`\n')
  }
  text = text.replace(IMPORT_RE, '').replace(EXPORT_RE, '').trimEnd() + '\n'
  if (!text.includes('function apply(ctx)')) throw new Error('入口函数未找到: apply')
  return text
}

// 按依赖序拼接：普通模块 + 入口（CSS 常量 + apply 函数体）。
// prices.js 放在 src/ 根：浏览器半区与 node 半区共用同一份价格表。
const CLIENT_MODULES = [
  join(CLIENT_SRC, 'i18n.js'),
  join(SRC, 'prices.js'),
  join(CLIENT_SRC, 'core.js'),
  join(CLIENT_SRC, 'components.js'),
]

function buildClientBody() {
  let body = ''
  for (const file of CLIENT_MODULES) body += moduleBody(file) + '\n'
  body += entryParts(join(CLIENT_SRC, 'index.js')) + '\n'
  return body.trimEnd() + '\n'
}

function buildClientBundle(body) {
  return `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(PACKAGE_NAME)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
\t\tconst React = require("react");
${body.replace(/^/gm, '\t\t')}
\t\texports.apply = apply;
\t\texports.inject = inject;
\t\treturn module.exports;
\t}
});
`
}

mkdirSync(LIB, { recursive: true })
mkdirSync(join(LIB, 'types', 'client'), { recursive: true })

const clientBody = buildClientBody()
const clientBundle = buildClientBundle(clientBody)
writeFileSync(join(LIB, 'client.js'), clientBundle)

// node 半区：原样复制（纯 ESM，无转换）+ 共享价格表（相对 import）。
const nodeHalf = read(join(SRC, 'index.js'))
writeFileSync(join(LIB, 'index.js'), nodeHalf)
writeFileSync(join(LIB, 'prices.js'), read(join(SRC, 'prices.js')))

// 手写类型声明（JS 包的最小契约）。
writeFileSync(join(LIB, 'types', 'index.d.ts'), `/** Simple Dock node half: settings namespace + cost engine + cost endpoint. */
import type { Context } from '@deepseek-ai/cordis';

/** Cost breakdown for one currency, per 1M-token rates. */
export interface CostBreakdown {
  readonly hit: number;
  readonly miss: number;
  readonly out: number;
  readonly total: number;
}
/** Totals keyed by the currencies the engine prices. */
export type CostTotals = Record<string, CostBreakdown>;
/** One usage-bearing assistant step read from a stored session log. */
export interface StepUsageRow {
  readonly seq: number | null;
  readonly time: number | null;
  readonly model: string | null;
  readonly uncached: number;
  readonly read: number;
  readonly write: number;
  readonly out: number;
}
/** One session's priced cost plus the steps not yet written to its log. */
export interface SessionCostEntry {
  readonly id: string;
  readonly header: { readonly parentSession: string | null; readonly origin: string | null; readonly version: number | null };
  seq: number | null;
  steps: number;
  totals: CostTotals;
  pending: readonly unknown[];
  unpriced: number;
}
/** Project stored session events onto per-step usage rows. */
export declare function stepsFromEvents(events: readonly unknown[]): StepUsageRow[];
/** Price one step in every currency; null when no currency knows the model. */
export declare function costOfStep(step: StepUsageRow): CostTotals | null;
/** Zero totals across every priced currency. */
export declare function zeroTotals(): CostTotals;
/** Add one step's per-currency cost onto running totals. */
export declare function addTotals(totals: CostTotals, stepCost: CostTotals | null): CostTotals;
/** Newest usable cost record in a log, or null ({} when absent). */
export declare function baselineFromEvents(events: readonly unknown[]): { seq: number | null; steps: number; totals: CostTotals } | null;
/** Full backfill (no cost record) or incremental pricing from the baseline. */
export declare function entryFromEvents(id: string, header: unknown, events: readonly unknown[]): SessionCostEntry;
/** Accumulate one live step; false when it was already priced. */
export declare function applyLiveStep(entry: SessionCostEntry, step: StepUsageRow): boolean;
/** Merge a session with every descendant reached through header.parentSession. */
export declare function mergeLineage(entries: Map<string, SessionCostEntry>, id: string): { steps: number; totals: CostTotals; subagents: { sessions: number; steps: number; totals: CostTotals } };
/**
 * Register the settings namespace, warm/price every stored session, persist
 * each priced step as an ignorable 'simple-dock/cost' session event, and serve
 * GET /dsh-simple-dock/api/cost?sessionId=&lt;id&gt;[&refresh=1].
 */
export declare function apply(ctx: Context): void;
`)
writeFileSync(join(LIB, 'types', 'client', 'index.d.ts'), `/** Simple Dock client plugin body. */
import type { Context } from '@deepseek-ai/cordis';
/** Required services: the slot registry plus the locale runtime. */
export declare const inject: string[];
export declare function apply(ctx: Context): void;
`)

// ---- 验证 ----
// 语法校验 + 执行冒烟：打桩 window/react/document/slots/locale 真正跑一次
// apply，确保 bundle 顶层无游离语句、导出 apply 与 inject，并把注册到的
// 槽位核对一遍（注册进已删除的槽位会抛错，这层断言防止回归）。
{
  const registrations = []
  const slots = {
    inject: (name, callback) => { callback(); return () => {} },
    register: (options) => { registrations.push(options); return () => {} },
  }
  const locale = {
    register: () => () => {},
    subscribe: () => () => {},
    getSnapshot: () => ({ revision: 0 }),
    bind: () => (key) => key,
  }
  const ctx = {
    get: (name) => (name === 'slots' ? slots : name === 'locale' ? locale : undefined),
    effect: (fn) => {
      const disposer = fn()
      return () => { if (typeof disposer === 'function') disposer() }
    },
  }
  globalThis.window = {
    localStorage: { getItem: () => null, setItem: () => {} },
    __ModuleLoader__: {
      load: ({ factory }) => {
        const exports = factory((name) => {
          if (name === 'react') return {} // 组件函数不执行，桩只需存在
          throw new Error('unexpected require: ' + name)
        })
        if (typeof exports.apply !== 'function') throw new Error('bundle 未导出 apply 函数')
        if (!Array.isArray(exports.inject)) throw new Error('bundle 未导出 inject 数组')
        exports.apply(ctx)
      },
    },
  }
  globalThis.document = {
    createElement: () => ({ setAttribute: () => {}, remove: () => {}, textContent: '' }),
    head: { appendChild: () => {} },
    documentElement: { style: { setProperty: () => {} } },
    body: { hasAttribute: () => false },
  }
  new Function(clientBundle)()
  const names = registrations.map((entry) => entry.name)
  // 0.1.6 的槽位契约：dock 遮蔽官方 stats 行、Settings → Plugins 的 tab、
  // Plugins 页的 keyed bundle 配置、以及通用设置四行。
  for (const required of [
    'conversation.composer.dock',
    'settings.general.item',
    'settings.plugins.tab',
    'plugins.bundle.config',
  ]) {
    if (!names.includes(required)) throw new Error('缺少槽位注册: ' + required + '（实际: ' + names.join(', ') + '）')
  }
  if (names.includes('settings.plugin.item')) {
    throw new Error('settings.plugin.item 在新版已不存在，不应再注册')
  }
  const generalRows = registrations.filter((entry) => entry.name === 'settings.general.item')
  if (generalRows.length !== 4) throw new Error('settings.general.item 应有 4 行，实际 ' + String(generalRows.length))
  const bundleConfig = registrations.find((entry) => entry.name === 'plugins.bundle.config')
  if (bundleConfig.key !== 'dsh-ui-simple-dock') throw new Error('plugins.bundle.config 的 key 应为 bundle 包名')
  const dock = registrations.find((entry) => entry.name === 'conversation.composer.dock')
  if (dock.priority !== -1) throw new Error('dock 需以 priority -1 遮蔽官方 stats 行')
}
console.log('lib/client.js :', Buffer.byteLength(clientBundle), 'bytes')
console.log('lib/index.js  :', Buffer.byteLength(nodeHalf), 'bytes')
console.log('syntax OK')

// ---- 冒烟：i18n（zh/en 键集合一致）/价格（峰谷取价）/格式化/折叠/成本 ----
const i18n = await import(join(CLIENT_SRC, 'i18n.js'))
const zhKeys = Object.keys(i18n.dicts.zh).sort()
const enKeys = Object.keys(i18n.dicts.en).sort()
if (zhKeys.length === 0 || zhKeys.join('|') !== enKeys.join('|')) throw new Error('zh/en 字典键集合不一致')
i18n.setLocaleFace(() => () => { /* no-op */ }, () => 0, (key, params) => {
  const raw = i18n.dicts.zh[key] ?? key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
})
if (i18n.t('seg.steps') !== '步数') throw new Error('i18n zh 翻译失败')
if (i18n.t('sub.calls', { count: 3, value: '1.2s' }) !== '3 次 · 均 1.2s/次') throw new Error('i18n 插值失败')
const { normalizeModelId, priceAt, PRICE_VERSION, PEAK_START_MS, WEEKEND_START_MS, FLASH_REVISION_START_MS } = await import(join(SRC, 'prices.js'))
const core = await import(join(CLIENT_SRC, 'core.js'))

if (normalizeModelId('openai/gpt-5@2025[1m]') !== 'gpt-5-2025') throw new Error('normalizeModelId 失败')
if (normalizeModelId('deepseek/deepseek-v4-flash') !== 'deepseek-v4-flash') throw new Error('normalizeModelId 前缀剥离失败')
// 峰谷生效前：统一价（flash USD 0.14 / 0.28 / 0.0028）
const pre = priceAt('deepseek-v4-flash', 'usd', Date.UTC(2026, 7, 16, 2))
if (!pre || Math.abs(pre.input - 0.14) > 1e-9 || Math.abs(pre.cacheRead - 0.0028) > 1e-9) throw new Error('生效前应走统一价')
// 生效日零点起峰谷（UTC 00:00 为谷）
const atStart = priceAt('deepseek-v4-flash', 'cny', PEAK_START_MS)
if (!atStart || Math.abs(atStart.input - 1.5) > 1e-9) throw new Error('生效日零点应为谷价')
// 峰（UTC 02:00）与谷（UTC 05:00）、半开边界 04:00 为谷
const peak = priceAt('deepseek-v4-flash', 'cny', Date.UTC(2026, 8, 1, 2))
if (!peak || Math.abs(peak.input - 3) > 1e-9 || Math.abs(peak.output - 9) > 1e-9 || Math.abs(peak.cacheRead - 0.1) > 1e-9) throw new Error('峰价失败')
const off = priceAt('deepseek-v4-flash', 'cny', Date.UTC(2026, 8, 1, 5))
if (!off || Math.abs(off.input - 1.5) > 1e-9) throw new Error('谷价失败')
const edge = priceAt('deepseek-v4-flash', 'cny', Date.UTC(2026, 8, 1, 4))
if (!edge || Math.abs(edge.input - 1.5) > 1e-9) throw new Error('04:00 半开边界应为谷价')
const proPeak = priceAt('deepseek-v4-pro', 'usd', Date.UTC(2026, 8, 1, 6))
if (!proPeak || Math.abs(proPeak.input - 1.32) > 1e-9) throw new Error('pro 峰价失败')
// 周末全天谷价（2026-08-23 00:00 北京时间 = UTC 8/22 16:00 起）：
// 生效前北京周六（UTC 8/22 02:00 = 北京 10:00 周六）仍按旧规则 → 峰价
const preWeekend = priceAt('deepseek-v4-flash', 'cny', Date.UTC(2026, 7, 22, 2))
if (!preWeekend || Math.abs(preWeekend.input - 3) > 1e-9) throw new Error('周末规则生效前周六应仍按峰谷')
// 生效瞬间（UTC 8/22 16:00 = 北京 8/23 00:00 周日）→ 谷价
const weekendStart = priceAt('deepseek-v4-flash', 'cny', WEEKEND_START_MS)
if (!weekendStart || Math.abs(weekendStart.input - 1.5) > 1e-9) throw new Error('周末规则生效瞬间应为谷价')
// 生效后北京周六（UTC 9/5 02:00 = 北京 10:00 周六）峰小时 → 全天谷价
const satPeakHour = priceAt('deepseek-v4-flash', 'cny', Date.UTC(2026, 8, 5, 2))
if (!satPeakHour || Math.abs(satPeakHour.input - 1.5) > 1e-9) throw new Error('生效后周六峰小时应为谷价')
// 生效后北京周日峰小时 → 谷价
const sunPeakHour = priceAt('deepseek-v4-flash', 'cny', Date.UTC(2026, 8, 6, 7))
if (!sunPeakHour || Math.abs(sunPeakHour.input - 1.5) > 1e-9) throw new Error('生效后周日峰小时应为谷价')
// 生效后工作日（周二 9/1 UTC 02:00）→ 峰价不变（上文 peak 已覆盖 9/1）
// chat / reasoner 定向到 v4-flash 旧统一价：任意时刻（含峰谷时段）统一价
const chat = priceAt('deepseek-chat', 'cny', Date.UTC(2026, 8, 1, 2))
if (!chat || Math.abs(chat.input - 1) > 1e-9 || Math.abs(chat.cacheRead - 0.02) > 1e-9) throw new Error('chat 应定向 v4-flash 统一价')
const chatUsd = priceAt('deepseek-chat', 'usd', Date.UTC(2026, 8, 1, 2))
if (!chatUsd || Math.abs(chatUsd.input - 0.14) > 1e-9) throw new Error('chat USD 定向失败')
const reasoner = priceAt('deepseek-reasoner', 'cny', Date.UTC(2026, 8, 1, 7))
if (!reasoner || Math.abs(reasoner.input - 1) > 1e-9) throw new Error('reasoner 应定向 v4-flash 统一价')
// vision-exp 与 v4-flash 完全同价：峰/谷/周末/生效前逐点与 flash 一致
const visionPeak = priceAt('deepseek-v4-flash-vision-exp', 'cny', Date.UTC(2026, 8, 1, 2))
if (!visionPeak || Math.abs(visionPeak.input - 3) > 1e-9) throw new Error('vision-exp 峰价应等于 flash')
const visionOff = priceAt('deepseek-v4-flash-vision-exp', 'cny', Date.UTC(2026, 8, 1, 5))
if (!visionOff || Math.abs(visionOff.input - 1.5) > 1e-9) throw new Error('vision-exp 谷价应等于 flash')
const visionSat = priceAt('deepseek-v4-flash-vision-exp', 'cny', Date.UTC(2026, 8, 5, 2))
if (!visionSat || Math.abs(visionSat.input - 1.5) > 1e-9) throw new Error('vision-exp 周末应谷价')
const visionPre = priceAt('deepseek-v4-flash-vision-exp', 'usd', Date.UTC(2026, 7, 16, 2))
if (!visionPre || Math.abs(visionPre.input - 0.14) > 1e-9) throw new Error('vision-exp 生效前应统一价')
if (priceAt('gpt-5', 'usd', Date.now()) !== null) throw new Error('未知模型应返回 null')
// flash 调价（2026-09-10 12:00 北京时间 = UTC 04:00）：
// 生效前一刻（UTC 9/9 02:00 峰小时）→ 旧峰价（CNY 3）
const sep9Peak = priceAt('deepseek-v4-flash', 'cny', Date.UTC(2026, 8, 9, 2))
if (!sep9Peak || Math.abs(sep9Peak.input - 3) > 1e-9) throw new Error('9/9 应仍为旧峰价')
// 生效瞬间（UTC 9/10 04:00，周四谷时段）→ 新谷价 CNY 0.02/1/4、USD 0.003/0.15/0.6
const revOff = priceAt('deepseek-v4-flash', 'cny', FLASH_REVISION_START_MS)
if (!revOff || Math.abs(revOff.input - 1) > 1e-9 || Math.abs(revOff.output - 4) > 1e-9 || Math.abs(revOff.cacheRead - 0.02) > 1e-9) throw new Error('9/10 生效瞬间应为新谷价 (CNY)')
const revOffUsd = priceAt('deepseek-v4-flash', 'usd', FLASH_REVISION_START_MS)
if (!revOffUsd || Math.abs(revOffUsd.input - 0.15) > 1e-9 || Math.abs(revOffUsd.output - 0.6) > 1e-9 || Math.abs(revOffUsd.cacheRead - 0.003) > 1e-9) throw new Error('9/10 生效瞬间应为新谷价 (USD)')
// 新峰价（UTC 9/10 06:00 峰小时）：谷 × 2 → CNY 0.04/2/8、USD 0.006/0.3/1.2
const revPeak = priceAt('deepseek-v4-flash', 'cny', Date.UTC(2026, 8, 10, 6))
if (!revPeak || Math.abs(revPeak.input - 2) > 1e-9 || Math.abs(revPeak.output - 8) > 1e-9 || Math.abs(revPeak.cacheRead - 0.04) > 1e-9) throw new Error('9/10 新峰价失败 (CNY)')
const revPeakUsd = priceAt('deepseek-v4-flash', 'usd', Date.UTC(2026, 8, 10, 6))
if (!revPeakUsd || Math.abs(revPeakUsd.input - 0.3) > 1e-9 || Math.abs(revPeakUsd.output - 1.2) > 1e-9 || Math.abs(revPeakUsd.cacheRead - 0.006) > 1e-9) throw new Error('9/10 新峰价失败 (USD)')
// pro 不受 flash 调价影响（UTC 9/10 06:00 峰 → 旧 CNY 9）
const proRev = priceAt('deepseek-v4-pro', 'cny', Date.UTC(2026, 8, 10, 6))
if (!proRev || Math.abs(proRev.input - 9) > 1e-9) throw new Error('pro 不应受 flash 调价影响')
// 调价后的周末：北京周六（UTC 9/12 02:00）全天谷 → 新谷价 1
const revSat = priceAt('deepseek-v4-flash', 'cny', Date.UTC(2026, 8, 12, 2))
if (!revSat || Math.abs(revSat.input - 1) > 1e-9) throw new Error('调价后周末应新谷价')
// vision-exp 调价后跟随 flash 新价（峰 2 / 谷 1）
const visionRev = priceAt('deepseek-v4-flash-vision-exp', 'cny', Date.UTC(2026, 8, 10, 6))
if (!visionRev || Math.abs(visionRev.input - 2) > 1e-9) throw new Error('vision-exp 调价后应等于 flash 新峰价')
// flash 系列主 id deepseek-flash：调价前旧谷价、调价后新峰/谷价
const shortPre = priceAt('deepseek-flash', 'cny', Date.UTC(2026, 8, 1, 5))
if (!shortPre || Math.abs(shortPre.input - 1.5) > 1e-9) throw new Error('deepseek-flash 调价前应为旧谷价')
const shortOff = priceAt('deepseek-flash', 'cny', Date.UTC(2026, 8, 10, 4))
if (!shortOff || Math.abs(shortOff.input - 1) > 1e-9 || Math.abs(shortOff.cacheRead - 0.02) > 1e-9) throw new Error('deepseek-flash 调价后应为新谷价')
const shortPeak = priceAt('deepseek-flash', 'usd', Date.UTC(2026, 8, 10, 6))
if (!shortPeak || Math.abs(shortPeak.input - 0.3) > 1e-9 || Math.abs(shortPeak.output - 1.2) > 1e-9 || Math.abs(shortPeak.cacheRead - 0.006) > 1e-9) throw new Error('deepseek-flash 调价后应为新峰价 (USD)')
// v4-flash 与 vision-exp 是 deepseek-flash 的别称：任意时刻取价逐字段一致
for (const [label, at] of [['调价前峰', Date.UTC(2026, 8, 1, 2)], ['调价前谷', Date.UTC(2026, 8, 1, 5)], ['调价后峰', Date.UTC(2026, 8, 10, 6)], ['调价后谷', Date.UTC(2026, 8, 10, 4)], ['调价后周末', Date.UTC(2026, 8, 12, 2)]]) {
  const main = priceAt('deepseek-flash', 'cny', at)
  for (const alias of ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']) {
    const got = priceAt(alias, 'cny', at)
    if (!main || !got || got.input !== main.input || got.output !== main.output || got.cacheRead !== main.cacheRead) {
      throw new Error(`${alias} 应与 deepseek-flash 同价（${label}）`)
    }
  }
}
// 大小写/前缀归一化后同样命中
if (priceAt('DeepSeek/DeepSeek-Flash', 'cny', Date.UTC(2026, 8, 10, 6)) === null) throw new Error('deepseek-flash 归一化失败')
// chat / reasoner 仍定向 flash 旧统一价（不随峰谷/调价）
const chatRev = priceAt('deepseek-chat', 'cny', Date.UTC(2026, 8, 10, 6))
if (!chatRev || Math.abs(chatRev.input - 1) > 1e-9 || Math.abs(chatRev.cacheRead - 0.02) > 1e-9) throw new Error('chat 调价后应仍为 flash 旧统一价')
// 调价后按步成本管线（UTC 9/10 峰/谷两步，CNY）
const revStepNodes = [
  { kind: 'assistant', time: Date.UTC(2026, 8, 10, 6), timing: { completedTime: Date.UTC(2026, 8, 10, 6) }, requestConfig: { model: 'deepseek-v4-flash' }, usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000 } },
  { kind: 'assistant', time: Date.UTC(2026, 8, 10, 4), timing: { completedTime: Date.UTC(2026, 8, 10, 4) }, requestConfig: { model: 'deepseek-v4-flash' }, usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000 } },
]
const revCost = await core.computeSessionCost(revStepNodes, { uncached: 2000, read: 4000, write: 0, out: 1000 }, 'cny')
const revExpect = (2000 * 0.04 + 1000 * 2 + 500 * 8) / 1e6 + (2000 * 0.02 + 1000 * 1 + 500 * 4) / 1e6
if (!revCost.ok || Math.abs(revCost.cost.total - revExpect) > 1e-9) throw new Error('调价后按步取价失败: ' + JSON.stringify(revCost))

if (core.fmtCost(0.00089628, 'usd') !== '$0.0009') throw new Error('fmtCost 失败')
const folded = core.foldStats([
  { kind: 'assistant', turn: 0, step: 0, timing: { stepStartTime: 0, firstTokenTime: 100, completedTime: 1100 }, usage: { outputTokens: 100 } },
  { kind: 'tool-result', callTime: 0, time: 500 },
  { kind: 'assistant', turn: 0, step: 1, timing: { stepStartTime: 0, firstTokenTime: 50, completedTime: 550 }, usage: { outputTokens: 50 } },
])
if (folded.steps !== 2 || folded.turns !== 1 || folded.toolCalls !== 1 || folded.llmMs !== 1650) throw new Error('foldStats 失败')

// 成本管线：两步分别落在峰/谷，按各自时刻取价累加（CNY）
const PK = Date.UTC(2026, 8, 1, 2) // 峰
const OP = Date.UTC(2026, 8, 1, 5) // 谷
const usage = { uncached: 2000, read: 4000, write: 0, out: 1000 }
const stepNodes = [
  { kind: 'assistant', time: PK, timing: { completedTime: PK }, requestConfig: { model: 'deepseek-v4-flash' }, usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000 } },
  { kind: 'assistant', time: OP, timing: { completedTime: OP }, requestConfig: { model: 'deepseek-v4-flash' }, usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000 } },
]
const cost = await core.computeSessionCost(stepNodes, usage, 'cny')
const expect = (2000 * 0.1 + 1000 * 3 + 500 * 9) / 1e6 + (2000 * 0.05 + 1000 * 1.5 + 500 * 4.5) / 1e6
if (!cost.ok || Math.abs(cost.cost.total - expect) > 1e-9) throw new Error('computeSessionCost 按步取价失败: ' + JSON.stringify(cost))
// 生效前节点：统一价（USD flash）
const preNodes = [{ kind: 'assistant', timing: { completedTime: Date.UTC(2026, 7, 16, 2) }, requestConfig: { model: 'deepseek-v4-flash' }, usage: { inputTokens: 1300, outputTokens: 2500, cacheReadTokens: 5100 } }]
const preCost = await core.computeSessionCost(preNodes, { uncached: 1300, read: 5100, write: 0, out: 2500 }, 'usd')
const preExpect = (5100 * 0.0028 + 1300 * 0.14 + 2500 * 0.28) / 1e6
if (!preCost.ok || Math.abs(preCost.cost.total - preExpect) > 1e-9) throw new Error('生效前统一价失败: ' + JSON.stringify(preCost))
// 未知模型：全部步无价 → ok:false
const unk = await core.computeSessionCost([{ kind: 'assistant', requestConfig: { model: 'gpt-5' } }], usage, 'usd')
if (unk.ok !== false || !unk.error.startsWith('未知模型价格')) throw new Error('未知模型分支失败')
// 差额兜底：缺 usage 的用量按「已计价部分的平均单价」补算，不因末步落在
// 调价后的新价区间而把历史用量整体按新价折算（调价后尤其明显）。
const mixNodes = [
  { kind: 'assistant', time: PK, timing: { completedTime: PK }, requestConfig: { model: 'deepseek-v4-flash' }, usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000 } },
  { kind: 'assistant', time: Date.UTC(2026, 8, 10, 6), timing: { completedTime: Date.UTC(2026, 8, 10, 6) }, requestConfig: { model: 'deepseek-flash' } },
]
const mixUsage = { uncached: 4000, read: 8000, write: 0, out: 2000 }
const mixCost = await core.computeSessionCost(mixNodes, mixUsage, 'cny')
const mixPriced = (2000 * 0.1 + 1000 * 3 + 500 * 9) / 1e6
const mixExpect = mixPriced + (6000 * 0.1 + 3000 * 3 + 1500 * 9) / 1e6
if (!mixCost.ok || Math.abs(mixCost.cost.total - mixExpect) > 1e-9) throw new Error('兜底应按平均单价补算失败: ' + JSON.stringify(mixCost))
const mixWrong = mixPriced + (6000 * 0.04 + 3000 * 2 + 1500 * 8) / 1e6
if (Math.abs(mixCost.cost.total - mixWrong) < 1e-9) throw new Error('兜底不应按末次时刻（新价）折算')
// 无任何已计价样本时仍退回末次时刻价（不回归为 0）
const onlyLeftover = await core.computeSessionCost(
  [{ kind: 'assistant', time: OP, timing: { completedTime: OP }, requestConfig: { model: 'deepseek-v4-flash' } }],
  { uncached: 0, read: 1000, write: 0, out: 0 }, 'cny')
if (!onlyLeftover.ok || Math.abs(onlyLeftover.cost.total - (1000 * 0.05) / 1e6) > 1e-9) throw new Error('无样本兜底失败: ' + JSON.stringify(onlyLeftover))
// ---- node half 成本引擎（纯函数） ----
const hostHalf = await import(join(SRC, 'index.js'))
const events = [
  { type: 'user/message', seq: 0, time: 1, data: {} },
  { type: 'assistant/message', seq: 1, time: PK, data: { message: { source: { model: 'deepseek-v4-flash' } }, usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000 } } },
  { type: 'assistant/message', seq: 2, time: Date.UTC(2026, 8, 10, 6), data: { message: { source: { model: 'deepseek-flash' } }, usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000 } } },
  { type: 'assistant/message', seq: 3, time: 5, data: {} },
  { type: 'tool/result', seq: 4, time: 6, data: { usage: { outputTokens: 99 } } },
]
const projected = hostHalf.stepsFromEvents(events)
if (projected.length !== 2) throw new Error('stepsFromEvents 应只收带 usage 的 assistant 消息')
if (projected[0].seq !== 1 || projected[0].read !== 2000 || projected[0].write !== 0) throw new Error('stepsFromEvents 字段失败')
if (projected[1].model !== 'deepseek-flash' || projected[1].seq !== 2) throw new Error('stepsFromEvents 第二行失败')
// 单步计价：峰价 CNY 0.1/3/9 与 USD 0.014/0.44/1.32
const stepOne = hostHalf.costOfStep(projected[0])
const stepOneCny = (2000 * 0.1 + 1000 * 3 + 500 * 9) / 1e6
const stepOneUsd = (2000 * 0.014 + 1000 * 0.44 + 500 * 1.32) / 1e6
if (Math.abs(stepOne.cny.total - stepOneCny) > 1e-12) throw new Error('costOfStep CNY 失败')
if (Math.abs(stepOne.usd.total - stepOneUsd) > 1e-12) throw new Error('costOfStep USD 失败')
if (hostHalf.costOfStep({ seq: 9, time: PK, model: 'gpt-5', uncached: 1, read: 0, write: 0, out: 0 }) !== null) throw new Error('未知模型应计为无价')
// 启动完整回填：没有成本记录的会话全量计价（两币种累计 + 两步待写）
const backfilled = hostHalf.entryFromEvents('sess-a', { version: 3 }, events)
const bothStepsCny = stepOneCny + (2000 * 0.04 + 1000 * 2 + 500 * 8) / 1e6
if (backfilled.steps !== 2 || backfilled.pending.length !== 2 || backfilled.seq !== 2) throw new Error('回填步数/待写失败')
if (Math.abs(backfilled.totals.cny.total - bothStepsCny) > 1e-12) throw new Error('回填累计失败: ' + JSON.stringify(backfilled.totals.cny))
if (backfilled.pending[0].priceVersion !== PRICE_VERSION) throw new Error('成本事件应带当前价格版本')
if (backfilled.pending[1].cumulative.cny.total !== backfilled.totals.cny.total) throw new Error('待写事件应带至当步累计')
// 已有基线：只补基线之后的新步（不重复计价）
const withBaseline = events.concat([{ type: 'simple-dock/cost', seq: 5, time: 100, data: backfilled.pending[1] }])
const reused = hostHalf.entryFromEvents('sess-a', { version: 3 }, withBaseline)
if (reused.steps !== 2 || reused.pending.length !== 0) throw new Error('基线复用失败: ' + JSON.stringify(reused))
// 价格版本不符：丢弃旧记录并全量重算
const stale = events.concat([{ type: 'simple-dock/cost', seq: 5, time: 100, data: Object.assign({}, backfilled.pending[1], { priceVersion: 0 }) }])
if (hostHalf.entryFromEvents('sess-a', { version: 3 }, stale).pending.length !== 2) throw new Error('价格版本失效失败')
// 运行期增量：新步累加 + 入待写；同一步不重复计价
const liveEvent = { type: 'assistant/message', seq: 6, time: OP, data: { message: { source: { model: 'deepseek-v4-flash' } }, usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000 } } }
const liveStep = hostHalf.stepsFromEvents([liveEvent])[0]
if (!hostHalf.applyLiveStep(reused, liveStep)) throw new Error('增量应用失败')
if (reused.steps !== 3 || reused.pending.length !== 1) throw new Error('增量累计失败')
if (hostHalf.applyLiveStep(reused, liveStep)) throw new Error('重复步不应再次计价')
// 子任务合并：父会话视图含后代
const entriesMap = new Map()
entriesMap.set('parent', hostHalf.entryFromEvents('parent', { version: 3 }, events))
entriesMap.set('child', hostHalf.entryFromEvents('child', { version: 3, parentSession: 'parent' }, events))
entriesMap.set('other', hostHalf.entryFromEvents('other', { version: 3 }, events))
const merged = hostHalf.mergeLineage(entriesMap, 'parent')
if (merged.steps !== 4 || merged.subagents.sessions !== 1) throw new Error('父子合并失败: ' + JSON.stringify(merged))
if (Math.abs(merged.totals.cny.total - 2 * backfilled.totals.cny.total) > 1e-12) throw new Error('合并金额失败')

// ---- node half 桩上下文：预热回填 / 活动会话延后 / 端点分支 ----
const makeCtx = (state) => ({
  // 桩：依赖服务视为已就绪，注入回调立即执行（并展开为 ctx 属性）。
  inject(services, callback) { state.injections.push({ services }); callback(makeCtx(state)); return () => {} },
  effect(fn) { state.effects.push(fn()); return () => {} },
  on(event, handler) {
    const list = state.listeners.get(event) ?? []
    list.push(handler)
    state.listeners.set(event, list)
    return () => {}
  },
  get(name) { return state.services[name] },
  // Cordis 把注入的服务暴露为 ctx 属性；桩按当前服务表展开。
  ...state.services,
})
const state = { injections: [], effects: [], listeners: new Map(), routes: [], services: {} }
const logs = new Map()
const active = new Set(['sess-live'])
const writes = []
state.services.settings = { register: () => {} }
state.services.sessionPersistence = {
  list: async () => [
    { header: { id: 'sess-a', version: 3 } },
    { header: { id: 'sess-live', version: 3 } },
  ],
  stat: async (id) => (logs.has(id) ? { header: { id, version: 3 } } : undefined),
  open: async (id, access) => {
    if (access === 'write' && active.has(id)) throw new Error('session already owned')
    return {
      read: async () => ({ events: logs.get(id) ?? [] }),
      append: async (batch) => {
        writes.push({ id, batch })
        const list = logs.get(id) ?? []
        logs.set(id, list.concat(batch))
      },
      flush: async () => {},
      close: async () => {},
    }
  },
}
state.services.webServer = { register: (route) => { state.routes.push(route); return () => {} } }
logs.set('sess-a', events)
logs.set('sess-live', events.slice(0, 2))
const rootCtx = makeCtx(state)
hostHalf.apply(rootCtx)
const flushAsync = async () => { for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve)) }
await flushAsync()
// 回填写回：sess-a 两步各一条可忽略事件、seq 连续
const sessAWrite = writes.find((w) => w.id === 'sess-a')
if (sessAWrite === undefined || sessAWrite.batch.length !== 2) throw new Error('启动回填未写回日志')
if (sessAWrite.batch[0].type !== 'simple-dock/cost' || sessAWrite.batch[0].ignorable !== true) throw new Error('成本事件类型/可忽略标记失败')
if (sessAWrite.batch[0].seq !== 5 || sessAWrite.batch[1].seq !== 6) throw new Error('成本事件 seq 应接续日志: ' + JSON.stringify(sessAWrite.batch.map((e) => e.seq)))
if (writes.some((w) => w.id === 'sess-live')) throw new Error('活动会话不应写入日志')
// 端点：正常 200、缺少参数 400、非 GET 403、未知会话 404
if (state.routes.length !== 1) throw new Error('未注册 cost 端点')
const callRoute = async (method, url, origin) => {
  let status = 0
  let body = ''
  const res = { writeHead: (code) => { status = code; return res }, end: (text) => { body = text ?? '' } }
  await state.routes[0].handler({ method, url, headers: { host: '127.0.0.1:3080', ...(origin === undefined ? {} : { origin }) } }, res)
  return { status, body }
}
const okCall = await callRoute('GET', '/dsh-simple-dock/api/cost?sessionId=sess-a')
const okBody = JSON.parse(okCall.body)
if (okCall.status !== 200 || okBody.ok !== true || okBody.steps !== 2) throw new Error('端点应与内存缓存一致: ' + okCall.body)
if (Math.abs(okBody.totals.cny.total - bothStepsCny) > 1e-12) throw new Error('端点金额失败: ' + okCall.body)
if ((await callRoute('GET', '/dsh-simple-dock/api/cost')).status !== 400) throw new Error('缺 sessionId 应 400')
if ((await callRoute('POST', '/dsh-simple-dock/api/cost?sessionId=sess-a')).status !== 403) throw new Error('非 GET 应 403')
if ((await callRoute('GET', '/dsh-simple-dock/api/cost?sessionId=ghost')).status !== 404) throw new Error('未知会话应 404')
if ((await callRoute('GET', '/dsh-simple-dock/api/cost?sessionId=sess-a', 'http://evil.example')).status !== 403) throw new Error('跨源应 403')
// 运行期事件 → 会话离场后补写
const liveEvent2 = { type: 'assistant/message', seq: 2, time: OP, data: { message: { source: { model: 'deepseek-v4-flash' } }, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 20 } } }
for (const handler of state.listeners.get('session/event') ?? []) handler({ id: 'sess-live' }, liveEvent2)
active.delete('sess-live')
for (const handler of state.listeners.get('session/disposed') ?? []) handler({ id: 'sess-live' })
await flushAsync()
const liveWrite = writes.find((w) => w.id === 'sess-live')
if (liveWrite === undefined || liveWrite.batch.length !== 2) throw new Error('离场后应补写全部未落盘步')
if (liveWrite.batch[0].ignorable !== true || liveWrite.batch[1].seq !== liveWrite.batch[0].seq + 1) throw new Error('增量补写事件格式失败')

const model = core.currentModel([{ kind: 'user' }, { kind: 'assistant', provenance: { model: 'deepseek-v4-flash' } }])
if (model !== 'deepseek-v4-flash') throw new Error('currentModel 失败')
console.log('smoke OK（i18n/归一化/峰谷取价/格式化/折叠/按步成本管线/差额兜底/成本引擎回填/增量/合并/端点/未知模型）')
