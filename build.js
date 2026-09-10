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
const CLIENT_ORDER = ['i18n.js', 'prices.js', 'core.js', 'components.js', 'index.js']

function buildClientBody() {
  let body = ''
  for (const file of CLIENT_ORDER) {
    const text = file === 'index.js'
      ? entryParts(join(CLIENT_SRC, file))
      : moduleBody(join(CLIENT_SRC, file))
    body += text + '\n'
  }
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

// node 半区：原样复制（纯 ESM，无转换）。
const nodeHalf = read(join(SRC, 'index.js'))
writeFileSync(join(LIB, 'index.js'), nodeHalf)

// 手写类型声明（JS 包的最小契约）。
writeFileSync(join(LIB, 'types', 'index.d.ts'), `/** Simple Dock node half: registers the simple-dock settings namespace. */
import type { Context } from '@deepseek-ai/cordis';
/** Register the namespace once the optional settings service is composed. */
export declare function apply(ctx: Context): void;
`)
writeFileSync(join(LIB, 'types', 'client', 'index.d.ts'), `/** Simple Dock client plugin body. */
import type { Context } from '@deepseek-ai/cordis';
/** Required services: the slot registry. */
export declare const inject: string[];
export declare function apply(ctx: Context): void;
`)

// ---- 验证 ----
// 语法校验 + 执行冒烟：打桩 window/react 真正跑一次 factory，确保 bundle
// 顶层无游离语句、且导出 apply 函数与 inject 数组（历史 bug 回归防护）。
{
  globalThis.window = {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        const exports = factory((name) => {
          if (name === 'react') return {} // 只验证可加载，不执行组件
          throw new Error('unexpected require: ' + name)
        })
        if (typeof exports.apply !== 'function') throw new Error('bundle 未导出 apply 函数')
        if (!Array.isArray(exports.inject)) throw new Error('bundle 未导出 inject 数组')
      },
    },
  }
  new Function(clientBundle)()
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
const { normalizeModelId, priceAt, PEAK_START_MS, WEEKEND_START_MS, FLASH_REVISION_START_MS } = await import(join(CLIENT_SRC, 'prices.js'))
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
// deepseek-flash（flash 系列短 id）与 v4-flash 完全同价：调价前旧谷价、调价后新峰/谷价
const shortPre = priceAt('deepseek-flash', 'cny', Date.UTC(2026, 8, 1, 5))
if (!shortPre || Math.abs(shortPre.input - 1.5) > 1e-9) throw new Error('deepseek-flash 调价前应为旧谷价')
const shortOff = priceAt('deepseek-flash', 'cny', Date.UTC(2026, 8, 10, 4))
if (!shortOff || Math.abs(shortOff.input - 1) > 1e-9 || Math.abs(shortOff.cacheRead - 0.02) > 1e-9) throw new Error('deepseek-flash 调价后应为新谷价')
const shortPeak = priceAt('deepseek-flash', 'usd', Date.UTC(2026, 8, 10, 6))
if (!shortPeak || Math.abs(shortPeak.input - 0.3) > 1e-9 || Math.abs(shortPeak.output - 1.2) > 1e-9 || Math.abs(shortPeak.cacheRead - 0.006) > 1e-9) throw new Error('deepseek-flash 调价后应为新峰价 (USD)')
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
const model = core.currentModel([{ kind: 'user' }, { kind: 'assistant', provenance: { model: 'deepseek-v4-flash' } }])
if (model !== 'deepseek-v4-flash') throw new Error('currentModel 失败')
console.log('smoke OK（i18n/归一化/峰谷取价/格式化/折叠/按步成本管线/未知模型）')
