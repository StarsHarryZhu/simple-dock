# Simple Dock V0.1 — DSH 底栏统计插件

> **⚠️ 已弃用（Deprecated，2026-09-21）** —— 本项目已停止维护。插件已从作者的 DSH web profile **取消挂载**：`~/.dsh/profiles/web/cordis.patch.yml` 中的挂载行与 `~/.dsh/profiles/node_modules/dsh-ui-simple-dock` 软链接均已移除（重启 DSH 后不再加载）。源码、文档与安装步骤原样保留，供参考或自行恢复；不再更新、不再处理 issue 或修复缺陷。
>
> **Deprecated (2026-09-21)** — no longer maintained. The plugin has been **unmounted** from the author's DSH web profile (both the `cordis.patch.yml` row and the `node_modules` symlink are gone, so a restarted DSH no longer loads it). The source, docs and install steps remain for reference or self-restoration; no further updates, issue triage or fixes are planned.

替换 DeepSeek Harness 网页端底栏的官方统计行，改成**左右双区、点击展开明细**的交互式统计坞。深浅色自适应，不依赖任何其他插件。界面文案**中英文双语，跟随 DSH 系统语言设置**（`设置 → 通用 → 语言`），无需单独切换。

## 安装

### 方式一：一行命令（推荐，标准 bundle 安装）

本包声明了 `dsh.bundle`（自带 patch 层），安装后自动注册进 web profile 层栈，**无需手动改任何配置**：

```sh
# 从 npm registry（发布后）：
dsh plugin --profile web add dsh-ui-simple-dock

# 或本地源码（file: 复制快照 / link: 保持链接，改代码即生效）：
dsh plugin --profile web add file:/path/to/simple-dock
dsh plugin --profile web add link:/path/to/simple-dock

# 重启 DSH 生效
```

> 若之前用手动方式装过（`cordis.patch.yml` 里手写过 `- insert: simple-dock`），**请删掉手动行**再装，避免同一行被 bundle 层与用户层各插入一次。

### 方式二：手动（macOS / Linux）

### 1. 获取源码

```sh
git clone <本仓库地址> simple-dock
cd simple-dock
```

（也可以直接下载 zip 解压；需要 **Node.js 18+**。）

### 2. 构建

```sh
node build.js    # 生成 lib/（构建即语法校验 + 冒烟测试，全绿才继续）
```

### 3. 链接到 DSH profile

```sh
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
ln -sfn "$PWD" "$DSH_HOME/profiles/node_modules/dsh-ui-simple-dock"
```

### 4. 链接 node half 依赖

node 半区注册 `simple-dock` 设置命名空间，需要 host 的 `@deepseek-ai/dsh-settings` 与 `@deepseek-ai/schemastery`。插件通过 symlink 链接到 profile 的共享 store（跳过这些的包仍能链接插件，但卡片不会渲染）：

```sh
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
mkdir -p node_modules/@deepseek-ai
ln -sfn "$DSH_HOME/profiles/node_modules/@deepseek-ai/dsh-settings" node_modules/@deepseek-ai/dsh-settings
ln -sfn "$DSH_HOME/profiles/node_modules/@deepseek-ai/schemastery"  node_modules/@deepseek-ai/schemastery
```

### 5. 注册 bundle

编辑 `$DSH_HOME/profiles/web/cordis.patch.yml`，在文件末尾追加：

```yaml
- insert:
    - id: simple-dock
      name: 'dsh-ui-simple-dock'
```

### 6. 重启 DSH

重启后自动生效（bundle **无需审批**）。验证：

- 底栏出现 `步数 N`（最左）｜ `命中率 X%` + `上下文 Y%`（右侧，两组分开）
- `设置 → 插件` 出现 **Simple Dock** 标签页（开关在里面）；侧栏 **插件** 页里本 bundle 的配置处也有同一个开关
- `设置` 里出现独立的 **Simple Dock** 设置页（总开关 / 底栏面板样式 / 面板玻璃 / 背景色 / 成本计价币种 / 价格表）

### 卸载

```sh
rm "$DSH_HOME/profiles/node_modules/dsh-ui-simple-dock"
# 删除 cordis.patch.yml 里对应的 - insert 块
# 重启 DSH
```

### Windows（PowerShell）

```powershell
# 1. 获取源码后执行 node build.js
# 2. 链接（junction）
New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\node_modules\dsh-ui-simple-dock" -Target "C:\path\to\simple-dock"
# 3. 链接 node half 依赖（junction 同样可以指向目录）
New-Item -ItemType Junction -Path "C:\path\to\simple-dock\node_modules\@deepseek-ai\dsh-settings" -Target "$env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai\dsh-settings"
New-Item -ItemType Junction -Path "C:\path\to\simple-dock\node_modules\@deepseek-ai\schemastery"  -Target "$env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai\schemastery"
# 4. 编辑 $env:USERPROFILE\.dsh\profiles\web\cordis.patch.yml，追加：
#    - insert:
#        - id: simple-dock
#          name: 'dsh-ui-simple-dock'
# 5. 重启 DSH
```

## 功能

收起时为一行三个按钮：**最左 `步数 N`**，**右侧 `命中率 X%` 与 `上下文 Y%`**（两组分开）。三个按钮外观一致（**无箭头、收起态无背景**），点任意一个展开对应面板，**同一时刻只开一个**（点其它按钮或面板外、按 Esc 即关闭）。上下文按钮与展开面板的**结构与配色完全照官方**（圆环 + 百分比；标题行 + 占比条 + 系统提示词 / 工具定义 / 对话消息图例），但**背景用本插件的面板样式**（传统实底 / 半透明玻璃，跟随模糊、磨砂与背景色设置），因此与另外两个面板观感一致。

| 说明 | 效果 |
|---|---|
| **收起状态**：`步数 N`（左）｜ `命中率 X%` `上下文 Y%`（右），点开、点外部或 Esc 关闭 | <img src="assets/thumbs/01-collapsed.png" alt="收起状态" width="480" /> |
| **左面板**：**性能**（LLM 耗时：总计 + 均/步；工具耗时：次数 + 均/次）＋ **简报**（会话标题、状态、最近更新） | <img src="assets/thumbs/02-left-open.png" alt="左面板" width="480" /> |
| **中/右面板**：**Token 明细**（输入命中/未命中、输出）＋ 首 token 时间、生成速度 ＋ **预估成本**（单行「预估成本 金额 ↻」） | <img src="assets/thumbs/03-right-open.png" alt="右面板" width="480" /> |
| **上下文面板**：官方同款设计 —— 标题行（本地化句子 + 百分比 + `~已用 / 上限`）、占比条、系统提示词 / 工具定义 / 对话消息图例；**背景用本插件的面板样式** | — |

## 设置（`设置 → Simple Dock`）

| 说明 | 效果 |
|---|---|
| **底栏统计坞**：总开关，关闭后立即恢复 DSH 官方底栏（停用时这一行仍在，方便再开回来）<br>**底栏面板样式**：半透明（玻璃）/ 传统（实底）<br>**面板玻璃**：模糊度 0–40 px、磨砂度 0–100% 滑杆，拖动实时生效<br>**背景色**：两个窗格（半透明模式色 / 传统模式色），未选色时以白色为起点、面板仍跟随主题，选色后即固定使用<br>**成本计价币种**：美元 USD / 人民币 CNY<br>**价格表**：内置价目，显示最近更新日期（不联网） | <img src="assets/thumbs/04-settings.png" alt="设置项" width="480" /> |
| **传统模式**：实底背景与页面主背景一致，深浅主题自适应 | <img src="assets/thumbs/05-classic-left.png" alt="传统模式" width="480" /> |

## 其他

- 面板弹出时自动避让「回到底部」按钮；键盘可操作（Enter/空格）
- 成本由 node 半区（host）维护：打开面板即显示已算好的值，点「↻」可强制重算该会话
- 非 DeepSeek 模型不显示预估费用
- 插件开关（三处同一状态：`设置 → Simple Dock` 第一行、`设置 → 插件` 的 Simple Dock 标签页、侧栏**插件**页里本 bundle 的配置）：关闭后**立即恢复 DSH 官方底栏**（本插件的底栏注册随之注销），重新开启即恢复统计坞，**不需要刷新或重启**

## 成本计算（内置价格表，不联网）

预估成本由 node 半区（host）维护，**不拉取任何外部价格表**：内置价格表按每次消耗的精确时刻取价，逐条累加。

- **v4-pro / v4-flash**：2026-08-17（UTC）起分峰谷计价；峰时段为 UTC 01:00–04:00 与 06:00–10:00，谷时段价格为峰价的一半；此前消耗按统一价
- **周末全天谷价**：2026-08-23 00:00（北京时间）起，北京时间周六、周日全天按谷价（谷时段价）；工作日维持峰谷时段
- **flash 新价**：2026-09-10 12:00（北京时间）起 flash 系列（主 id `deepseek-flash`）改用新价目：谷 = 缓存命中 0.02 / 未命中 1 / 输出 4 元（USD 0.003 / 0.15 / 0.6），峰 = 谷 × 2；周末规则不变；v4-pro 不受影响
- **deepseek-chat / deepseek-reasoner**：自动按 flash 的旧统一价计价（不参与峰谷）
- **flash 系列 id**：主 id 为 `deepseek-flash`；2026-09-10 12:00（北京时间）起 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 都是它的别称，一律引用 flash 价目（含峰谷、周末与 9/10 新价）
- 每次推理请求都会读取它的完成时刻与该步所用模型，峰/谷价互不串算
- **预计算与增量**：DSH 启动后 node 半区扫描全部会话——**还没有成本记录的会话（如刚装插件）完整回填**，已有记录的会话只补算之后的新步；运行期只在每步完成后计算该步并累加，面板直接读取结果
- **随会话记录持久化**：每一步的成本（该步金额 + 至该步累计）作为一条 `simple-dock/cost` 事件写回**该会话自己的记录**（带可忽略标记，旧版 DSH 读到会跳过而不是拒载）；重启后直接由记录恢复，不需要重算。会话仍在运行时其记录被占用，未落盘的步会在会话结束或下次启动时补写
- **子任务**：subagent 子会话的成本合并计入父会话显示值（按会话头的 parentSession 关系递归）
- **回退**：node 端点不可用（非 web 环境）时，面板按页面可见步估算；其他不在内置表中的模型不显示预估费用

## 与 DSH-Transparent-UI-Plugin（Aqua 透明玻璃主题）并用

> <https://github.com/WYH66666666/DSH-Transparent-UI-Plugin>

同时启用时，需把 Aqua 的模式设为**兼容模式**（`设置 → 通用设置 → 外观 → 模式`）才能拥有面板模糊效果。

| 说明 | 效果 |
|---|---|
| **漂浮玻璃**模式：布局被重排成悬浮玻璃卡片，Simple Dock 面板的模糊失效 | <img src="assets/thumbs/06-aqua-mica.png" alt="Aqua 漂浮玻璃：面板模糊失效" width="480" /> |
| **兼容模式**：保持原版排版，Simple Dock 面板的模糊正常 | <img src="assets/thumbs/07-aqua-compat.png" alt="Aqua 兼容模式：面板模糊正常" width="480" /> |

停止插件即恢复官方底栏，无残留。

## 构建与结构

```sh
node build.js    # 生成 lib/index.js（node 半区）+ lib/client.js（浏览器 bundle），构建即语法校验 + 冒烟测试
```

```
simple-dock/                # bundle 包（dsh-ui-simple-dock）
├── src/
│   ├── index.js            #   node 半区（注册 simple-dock 设置命名空间，其余纯客户端）
│   └── client/             #   浏览器半区：prices / core / components / index + styles.css
├── lib/                    # 构建产物（client.js = __ModuleLoader__.load 格式）
├── build.js                # 零依赖打包器
├── assets/                 # README 截图
└── dynamic/                # 旧版动态插件源码（会话级，已不再需要）
```
