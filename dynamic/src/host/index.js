// host/index.js — Host 半区入口：组装依赖、注册两个 package-private RPC。
//
// 提交形态：buildSimpleDockHost 的【函数体】经 src/build.js 打包为
// code.host（evaluator 闭包注入 ctx / harness / console 等符号）。

import { createPricingSync, readUsageRecords } from './services.js'
import { pickPrice, calcCost } from './prices.js'

export function buildSimpleDockHost() {
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
}
