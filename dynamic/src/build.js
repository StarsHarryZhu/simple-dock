#!/usr/bin/env node
// src/build.js — 零依赖打包器：把 src/host、src/client 模块树拼接成动态插件
// 需要的两个函数体（code.host / code.client 提交形态）。
//
// 约定（保持简单，避免引入转译器）：
//   - 模块间只用具名 import/export；构建时删除 import/export 关键字，
//     全部声明合并进同一个函数作用域（同名冲突由我们自行避免）；
//   - 入口文件的 `import css from './styles.css'` 由本脚本替换为模板字符串；
//   - CSS 内不得出现反引号或 ${。
//
// 用法：node src/build.js   →  输出 dist/host-body.js、dist/client-body.js，
// 并自动做语法校验与 host 半区冒烟测试（构建即验证）。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const DIST = join(ROOT, 'dist')

const IMPORT_RE = /^import[\s\S]*?from '[^']*'\n/gm // 单行/多行 import 均匹配
const EXPORT_RE = /^export /gm

function read(file) {
  return readFileSync(join(SRC, file), 'utf8')
}

// 普通模块 → 函数体内的顶层声明（去 import/export）。
function moduleBody(file) {
  return read(file).replace(IMPORT_RE, '').replace(EXPORT_RE, '').trimEnd() + '\n'
}

// 入口模块 → CSS 常量（如有）+ 入口函数体（花括号平衡提取）。
function entryParts(file, fnName) {
  let text = read(file)
  let cssConst = ''
  if (/^import css from '\.\/styles\.css'\n/m.test(text)) {
    const css = readFileSync(join(SRC, 'client', 'styles.css'), 'utf8')
    if (css.includes('`') || css.includes('${')) {
      throw new Error('styles.css 含反引号或 ${，无法注入模板字符串')
    }
    cssConst = 'const css = `' + css + '`\n'
  }
  const mark = 'export function ' + fnName + '() {'
  const start = text.indexOf(mark)
  if (start < 0) throw new Error('入口函数未找到: ' + fnName)
  const open = start + mark.length - 1
  let depth = 0
  let i = open
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) break }
  }
  if (depth !== 0) throw new Error('括号不平衡: ' + fnName)
  const fnBody = text.slice(open + 1, i).replace(/^\n/, '').replace(/\n$/, '')
  return { cssConst, fnBody }
}

// 按依赖序拼接一侧：普通模块 + 入口（CSS 常量 + 函数体）。
function buildSide(order, entryFile, fnName) {
  let body = ''
  for (const file of order) {
    if (file === entryFile) {
      const { cssConst, fnBody } = entryParts(file, fnName)
      body += (cssConst !== '' ? cssConst + '\n' : '') + fnBody + '\n'
    } else {
      body += moduleBody(file)
    }
  }
  return body.trimEnd() + '\n'
}

// 模块清单：新模块加入对应列表（依赖在前），入口恒为最后一项。
const HOST_ORDER = ['host/prices.js', 'host/services.js', 'host/index.js']
const CLIENT_ORDER = ['client/core.js', 'client/components.js', 'client/index.js']

mkdirSync(DIST, { recursive: true })
const hostBody = buildSide(HOST_ORDER, 'host/index.js', 'buildSimpleDockHost')
const clientBody = buildSide(CLIENT_ORDER, 'client/index.js', 'buildSimpleDockPlugin')
writeFileSync(join(DIST, 'host-body.js'), hostBody)
writeFileSync(join(DIST, 'client-body.js'), clientBody)

// 语法校验（符号对应 evaluator 闭包注入）。
new Function('ctx', 'harness', 'console', 'btoa', 'atob', 'TextEncoder', 'TextDecoder', hostBody)
new Function('React', 'styles', 'host', 'harness', 'console', clientBody)
console.log('host-body.js  :', Buffer.byteLength(hostBody), 'bytes')
console.log('client-body.js:', Buffer.byteLength(clientBody), 'bytes')
console.log('syntax OK')

// ---- host 冒烟测试：折叠语义 / 计费 / 响应结构 / 未知模型 ----
{
  const handlers = {}
  const harness = { handle: (n, fn) => { handlers[n] = fn } }
  const factory = new Function('ctx', 'harness', 'console', 'btoa', 'atob', 'TextEncoder', 'TextDecoder', hostBody)
  const ctx = {
    get: (name) => ({
      sessionQuery: {
        readSession: async () => ({ events: [
          { type: 'assistant/chunk', time: 1, data: { turn: 0, step: 0, chunk: { type: 'usage', usage: { inputTokens: 1000, outputTokens: 2000, cacheReadTokens: 5000, cacheWriteTokens: 999, reasoningTokens: 888 } } } },
          // 同 (turn, step) 只取最后一次
          { type: 'assistant/chunk', time: 2, data: { turn: 0, step: 0, chunk: { type: 'usage', usage: { inputTokens: 1100, outputTokens: 2100, cacheReadTokens: 5100 } } } },
          { type: 'assistant/chunk', time: 3, data: { turn: 0, step: 1, chunk: { type: 'usage', usage: { inputTokens: 200, outputTokens: 400, cacheReadTokens: 0 } } } },
        ] }),
      },
      agentDefaultModel: { currentSelection: () => ({ model: 'deepseek-v4-flash' }) },
      web: undefined,
      shell: undefined,
    })[name],
  }
  factory(ctx, harness).apply(ctx)
  const res = await handlers['dstat.sessionCost']({ sessionId: 's1', currency: 'usd' })
  const expect = 0.00089628 // hit=5100 miss=1300 out=2500 @ flash 单价
  if (!res.ok || res.records !== 2 || res.usageSource !== 'query' || Math.abs(res.cost.total - expect) > 1e-9) {
    throw new Error('sessionCost 冒烟失败: ' + JSON.stringify(res))
  }
  if (Object.keys(res).length !== 6) throw new Error('sessionCost 响应字段数异常')
  const unk = await handlers['dstat.sessionCost']({ sessionId: 's1', currency: 'usd', model: 'gpt-5' })
  if (unk.ok !== false || !unk.error.startsWith('未知模型价格')) throw new Error('未知模型分支失败')
  const pricing = await handlers['dstat.pricing']({ force: false })
  if (pricing.source !== 'fallback' || !pricing.error) throw new Error('pricing 兜底分支失败')
  console.log('host smoke OK（折叠/计费/未知模型/响应结构）')
}
