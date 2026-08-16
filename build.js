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
const CLIENT_ORDER = ['prices.js', 'core.js', 'components.js', 'index.js']

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
writeFileSync(join(LIB, 'types', 'index.d.ts'), `/** Simple Dock node half. No host-side behavior. */
export declare function apply(): void;
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

// ---- 冒烟：价格/计费/格式化/成本管线（fetch 打桩为离线 → 内置表兜底） ----
const { normalizeModelId, pickPrice, parseModelsDev, FALLBACK_PRICES } = await import(join(CLIENT_SRC, 'prices.js'))
const core = await import(join(CLIENT_SRC, 'core.js'))

if (normalizeModelId('openai/gpt-5@2025[1m]') !== 'gpt-5-2025') throw new Error('normalizeModelId 失败')
if (normalizeModelId('deepseek/deepseek-v4-flash') !== 'deepseek-v4-flash') throw new Error('normalizeModelId 前缀剥离失败')
const p = pickPrice(null, 'deepseek-v4-flash', 'usd')
if (!p || Math.abs(p.input - 0.14) > 1e-9 || Math.abs(p.cacheRead - 0.0028) > 1e-9) throw new Error('内置 USD 表失败')
const pc = pickPrice(null, 'deepseek-v4-flash', 'cny')
if (!pc || Math.abs(pc.input - 1) > 1e-9) throw new Error('内置 CNY 表失败')
if (pickPrice(null, 'gpt-5', 'usd') !== null) throw new Error('未知模型应返回 null')
const parsed = parseModelsDev({ deepseek: { models: { 'deepseek-chat': { cost: { input: 0.1, output: 0.2, cache_read: 0.01 } } } } })
if (parsed['deepseek-chat'].input !== 0.1) throw new Error('parseModelsDev 失败')

if (core.fmtCost(0.00089628, 'usd') !== '$0.0009') throw new Error('fmtCost 失败')
const folded = core.foldStats([
  { kind: 'assistant', turn: 0, step: 0, timing: { stepStartTime: 0, firstTokenTime: 100, completedTime: 1100 }, usage: { outputTokens: 100 } },
  { kind: 'tool-result', callTime: 0, time: 500 },
  { kind: 'assistant', turn: 0, step: 1, timing: { stepStartTime: 0, firstTokenTime: 50, completedTime: 550 }, usage: { outputTokens: 50 } },
])
if (folded.steps !== 2 || folded.turns !== 1 || folded.toolCalls !== 1 || folded.llmMs !== 1650) throw new Error('foldStats 失败')

// 成本管线：离线 fetch → 内置表兜底 → 按模型计价
globalThis.fetch = async () => { throw new Error('offline (smoke)') }
const usage = { uncached: 1300, read: 5100, write: 0, out: 2500 }
const cost = await core.computeSessionCost([{ kind: 'assistant', requestConfig: { model: 'deepseek-v4-flash' } }], usage, 'usd')
const expect = (5100 * 0.0028 + 1300 * 0.14 + 2500 * 0.28) / 1e6
if (!cost.ok || Math.abs(cost.cost.total - expect) > 1e-9) throw new Error('computeSessionCost 失败: ' + JSON.stringify(cost))
const unk = await core.computeSessionCost([{ kind: 'assistant', requestConfig: { model: 'gpt-5' } }], usage, 'usd')
if (unk.ok !== false || !unk.error.startsWith('未知模型价格')) throw new Error('未知模型分支失败')
const model = core.currentModel([{ kind: 'user' }, { kind: 'assistant', provenance: { model: 'deepseek-reasoner' } }])
if (model !== 'deepseek-reasoner') throw new Error('currentModel 失败')
console.log('smoke OK（归一化/内置表/解析/格式化/折叠/成本管线/未知模型）')
