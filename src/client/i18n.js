// client/i18n.js — 文案字典 + DSH 系统 locale 桥接。
// 不提供自己的切换按钮：语言跟随 DSH 系统设置（设置 → 通用 → 语言），
// 组件通过 useSyncExternalStore(subscribeLocale, getLocaleRevision)
// 订阅 locale 快照 revision，切换即重渲染；文案经 t(key, params) 翻译
// （{name} 占位符插值，与官方 LocaleRuntime.translate 同构）。
// 字典注册与桥接在 apply() 中完成（index.js）；locale 服务缺失时降级：
// t 返回 key 本身。

export const NS = 'simple-dock'

const zh = {
  'panel.perf': '性能',
  'panel.brief': '简报',
  'panel.tokens': 'Token 明细',
  'context.aria': '上下文已用 {percent}',
  'context.used': '上下文已用',
  'context.system': '系统提示词',
  'context.tools': '工具定义',
  'context.messages': '对话消息',
  'number.thousand': '{value}K',
  'number.million': '{value}M',
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
  'pricing.builtin': '内置 · 更新于 2026-09-10',
  'currency.label': '成本计价币种',
  'currency.usd': '美元 USD',
  'currency.cny': '人民币 CNY',
  'glass.label': '面板玻璃',
  'glass.blur': '模糊度',
  'glass.frost': '磨砂度',
  'color.label': '背景色',
  'color.glass': '半透明模式',
  'color.solid': '传统模式',
  'card.desc': '底栏统计坞：性能 / 简报 / Token 明细 / 预估成本；关闭后恢复 DSH 官方底栏',
  'card.on': '已启用',
  'card.off': '已停用',
  'card.summary.on': '已启用 · 底栏显示性能 / 简报 / Token / 成本',
  'card.summary.off': '已停用 · 使用 DSH 官方底栏统计行',
  'enabled.label': '底栏统计坞',
  'enabled.desc': '由本插件接管底栏统计行；关闭后立即恢复 DSH 官方底栏',
}

const en = {
  'panel.perf': 'Performance',
  'panel.brief': 'Brief',
  'panel.tokens': 'Token detail',
  'context.aria': '{percent} of context used',
  'context.used': 'of context used',
  'context.system': 'System prompt',
  'context.tools': 'Tool definitions',
  'context.messages': 'Messages',
  'number.thousand': '{value}K',
  'number.million': '{value}M',
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
  'pricing.builtin': 'Built-in · updated 2026-09-10',
  'currency.label': 'Cost currency',
  'currency.usd': 'USD',
  'currency.cny': 'CNY',
  'glass.label': 'Panel glass',
  'glass.blur': 'Blur',
  'glass.frost': 'Frost',
  'color.label': 'Background',
  'color.glass': 'Translucent',
  'color.solid': 'Classic',
  'card.desc': 'Composer dock stats: performance / brief / tokens / est. cost; off restores the official line',
  'card.on': 'Enabled',
  'card.off': 'Disabled',
  'card.summary.on': 'Enabled · performance / brief / tokens / cost in the composer dock',
  'card.summary.off': "Disabled · DSH's official stats line is used",
  'enabled.label': 'Composer dock',
  'enabled.desc': 'This plugin takes over the composer stats line; turning it off restores the official one',
}

/** 完整字典（zh/en 键集合一致，注册时由 locale 服务校验双语文档）。 */
export const dicts = { zh, en }

// ---- locale 桥（apply 注入；缺失时降级） ----
let subscribeFn = () => () => { /* no-op */ }
let revisionFn = () => 0
let translateFn = (key) => key

export function setLocaleFace(subscribe, getRevision, translate) {
  subscribeFn = subscribe
  revisionFn = getRevision
  translateFn = translate
}

/** uSES 订阅：locale 切换或字典注册时通知。 */
export function subscribeLocale(fn) {
  return subscribeFn(fn)
}

/** uSES 快照：monotonic revision（number，稳定）。 */
export function getLocaleRevision() {
  return revisionFn()
}

/** 翻译当前命名空间的文案；缺词回退 key（locale 服务处理回退链）。 */
export function t(key, params) {
  return translateFn(key, params)
}
