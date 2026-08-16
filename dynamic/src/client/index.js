// client/index.js — Client 半区入口：注入样式、注册底栏与设置行 slots。
//
// 提交形态：buildSimpleDockPlugin 的【函数体】经 src/build.js 打包为
// code.client（evaluator 闭包注入 React / styles / host / harness 等符号）。
// 这里的 `import css from './styles.css'` 由 build.js 替换为样式文本。

import css from './styles.css'
import { applyGlassVars, bindTimerService } from './core.js'
import { StatsDock, ModeRow, PricingRow, CurrencyRow, GlassRow } from './components.js'

export function buildSimpleDockPlugin() {
  return {
    // timer 服务：动态 client 半区没有浏览器 timer 全局，定时刷新走 ctx.timer。
    inject: ['timer'],
    apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      bindTimerService(ctx.timer)
      applyGlassVars()
      styles.insert(css)

      slots.inject('conversation.composer.dock', () => slots.register(
        { name: 'conversation.composer.dock', id: 'stats', order: 0, label: 'stats' },
        (props) => React.createElement(StatsDock, props),
      ))
      slots.inject('settings.general.item', () => slots.register(
        { name: 'settings.general.item', id: 'dstat-mode', order: 12, label: '底栏面板样式' },
        (props) => React.createElement(ModeRow, props),
      ))
      slots.inject('settings.general.item', () => slots.register(
        { name: 'settings.general.item', id: 'dstat-pricing', order: 13, label: '价格表（实时）' },
        (props) => React.createElement(PricingRow, props),
      ))
      slots.inject('settings.general.item', () => slots.register(
        { name: 'settings.general.item', id: 'dstat-currency', order: 14, label: '成本计价币种' },
        (props) => React.createElement(CurrencyRow, props),
      ))
      slots.inject('settings.general.item', () => slots.register(
        { name: 'settings.general.item', id: 'dstat-glass', order: 15, label: '面板玻璃' },
        (props) => React.createElement(GlassRow, props),
      ))
    },
  }
}
