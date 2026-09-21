# AGENTS.md

Agent guide for installing, building, and verifying **Simple Dock**
(`dsh-ui-simple-dock`) — a DSH web-client bundle that
replaces the composer dock stats line with interactive performance / brief /
token / estimated-cost panels.

## What this package is

- **Bundle type**: UI plugin with a node half that owns the cost engine. The
  node half (a) registers the `simple-dock` settings namespace the browser card
  is keyed by, (b) prices every stored session at startup — a session with no
  cost record yet (fresh install) is **fully backfilled** — then keeps each
  session current from the `session/event` append feed, and (c) persists each
  priced step into its own session log as one `simple-dock/cost` event
  (`ignorable: true`), so the cost travels with the session record and survives
  a restart without recomputation. It also serves one same-origin endpoint,
  `/dsh-simple-dock/api/cost`, that returns the session's — plus its subagent
  descendants' — merged totals. The browser half only renders that number; it
  re-prices locally only when the endpoint is unavailable, because the Client's
  own conversation nodes are just the rows its window has loaded.
- **Registration**: `dsh.client` declaration in `package.json` + one insert
  row in the web profile's `cordis.patch.yml`. No approval flow: bundles load
  automatically once the composition includes them.
- **Runtime dependencies**: the browser half needs only `react` (loader
  platform module) plus the `slots` and `locale` services — both must be
  inject-declared (`export const inject = ['slots', 'locale']`): the locale
  roster row (dsh-client-locale) can apply after this plugin, and a bare
  `ctx.get('locale')` at apply time would then miss it and leave every label
  on the raw-key fallback. The node half imports `@deepseek-ai/schemastery`
  plus the shared `./prices.js`, and injects `sessionPersistence` (the engine;
  required) plus the optional `settings` and `webServer` (no endpoint is
  registered where `webServer` is absent). schemastery must resolve from the
  package's local `node_modules` when installed manually via symlink (see
  Install). Pricing rules and the price table live in `src/prices.js`, shared
  by both halves, and never fetch an external price table.

## Install

**Recommended — one command (standard bundle)**: the package declares
`dsh.bundle.patch` (its own `cordis.patch.yml`), so installing it as a
profile dependency registers the row automatically — no manual patch edit:

```sh
dsh plugin --profile web add dsh-ui-simple-dock   # registry (after publish)
dsh plugin --profile web add file:/path/to/simple-dock   # or link:/path for live dev
# restart DSH
```

> If the row was previously added by hand in `cordis.patch.yml`, remove the
> manual lines before installing to avoid a duplicate insert.

**Manual (macOS / Linux)** — no install scripts; users install by hand
(full tutorial in `README.md`):

```sh
# 1. get the source and build (requires Node.js 18+)
git clone <repo-url> simple-dock && cd simple-dock
node build.js

# 2. link the package root into the profile's hoisted node_modules
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
ln -sfn "$PWD" "$DSH_HOME/profiles/node_modules/dsh-ui-simple-dock"

# 3. link the node-half dep into the package's local node_modules
#    (the node half imports @deepseek-ai/schemastery for the empty schema;
#    Node resolves symlinked packages by realpath, so it must exist locally)
mkdir -p node_modules/@deepseek-ai
ln -sfn "$DSH_HOME/profiles/node_modules/@deepseek-ai/schemastery"  node_modules/@deepseek-ai/schemastery

# 4. register the bundle: append to $DSH_HOME/profiles/web/cordis.patch.yml
#    - insert:
#        - id: simple-dock
#          name: 'dsh-ui-simple-dock'

# 5. restart DSH
```

> `$DSH_HOME/profiles/node_modules` is a shared hoisted store: the symlink
> target must be the package root (the directory containing `package.json`),
> and the link name must be the exact package name (scoped path included).
> Windows users: use a junction instead of a symlink
> (`New-Item -ItemType Junction`), same patch row, same restart requirement —
> and junction the node-half deps into `node_modules/@deepseek-ai/` the same way.

## Activate

**A DSH restart is required.** The running process only reads
`cordis.patch.yml` and the loader entries at boot; there is no live reload for
new bundle rows. After restart, the dynamic per-session copy of this plugin
(if any) is gone — the bundle takes over automatically, no approval needed.

## Verify

1. `node build.js` — must print `syntax OK` and `smoke OK …` before shipping.
2. Package resolvability from the profile:

   ```sh
   cd "$DSH_HOME/profiles" && node --input-type=module -e \
     "const m = await import('dsh-ui-simple-dock'); console.log(typeof m.apply)"
   ```

   → prints `function`.
3. After restart, in the web UI: the dock row is **`步数 N` on the far left,
   `命中率 X%` on the right**, followed by DSH's own context indicator whose
   capsule background follows this plugin's panel style / glass sliders;
   the on/off switch appears in `设置 → 通用设置` (first row), in
   `设置 → 插件` (a **Simple Dock** tab) and on the sidebar **Plugins** page as
   this bundle's configuration — toggling it must swap the official stats line
   in and out **without a refresh**. `设置 → 通用设置` shows five rows
   (底栏统计坞 / 底栏面板样式 / 价格表 / 成本计价币种 / 面板玻璃). Check the
   browser console for `client-modules` load errors if anything is missing.
4. Cost engine and endpoint (web profile only):

   ```sh
   curl -s "http://127.0.0.1:3080/dsh-simple-dock/api/cost?sessionId=<session-id>"
   ```

   → `{"ok":true,"steps":N,"totals":{"usd":{…},"cny":{…}},"subagents":{…},…}`.
   A `401` means the web session is not authenticated, `403` an off-origin
   caller, `404 {ok:false,"reason":"session-unreadable"}` an unknown session —
   none of those is a plugin defect, and each one makes the browser half fall
   back to its own node path. Warm-up is silent on success (only failures log);
   check that a session's cost is served, not that a line was printed.
5. Persistence check: after a step completes (or after a restart backfills an
   old session), the session log carries one `simple-dock/cost` event per
   assistant step:

   ```sh
   zstd -dc "$DSH_HOME/sessions/<encoded-cwd>/<session-dir>/session.v3.jsonl.zstd" | grep -c simple-dock/cost
   ```

   Each event must be `ignorable: true` with a contiguous `seq`, and the
   session must still reload in DSH (an unrecognized *ignorable* event is
   skipped on read; an unrecognizable required one would refuse the log — never
   write a cost event without the marker).

## Uninstall

```sh
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
rm "$DSH_HOME/profiles/node_modules/dsh-ui-simple-dock"
# remove the - insert block for simple-dock from cordis.patch.yml
# restart DSH
```

## Build

```sh
node build.js
```

Zero-dependency bundler: merges `src/client/*.js` plus the shared
`src/prices.js` into `lib/client.js`
(`window.__ModuleLoader__.load({ id, factory })` format, `react` external),
copies the node half to `lib/index.js` and the shared price module to
`lib/prices.js`, writes hand-typed `lib/types/*`.
Build-time checks: syntax + smoke tests (zh/en dictionary key parity,
model normalization, peak/off-peak price lookup with the 2026-08-17
effective date and UTC peak-hour boundaries, the 2026-08-23 Beijing-time
weekend all-day off-peak rule, per-step cost pipeline priced at each step's
completion time, the averaged leftover fallback, and the node-half cost
engine through a stubbed Host context: full backfill of a session without
cost records, baseline reuse, price-version invalidation, live increments
without double pricing, parent/subagent merging, cost-event shape
(`ignorable`, contiguous `seq`), deferred writes while a session is still
owned, and every endpoint branch). Do not edit `lib/` by hand — it is
generated.

## Layout

```
src/index.js        node half (settings namespace + cost engine + /api/cost)
src/prices.js       shared price table and pricing rules (both halves)
src/client/         i18n.js · core.js · components.js · index.js · styles.css
lib/                built outputs (committed for git installs)
build.js            the bundler
dynamic/            legacy session-scoped dynamic-plugin sources (not used)
assets/ demo/       screenshots and recordings
```

## Portfolio archival

- When this project has an intro brief, mirror it into the personal
  portfolio repo under `projects/` as `<proj_name>_intro.md` (project
  directory name; here `simple-dock_intro.md`):
  `/Users/starfield/Documents/projets/StarsHarryZhu.github.io/projects/simple-dock_intro.md`
  Generate the brief if missing; overwrite the file when the intro changes.

## Notes

- The node half owns the cost engine and is otherwise inert. Its only session
  write is the `simple-dock/cost` event, only on format-v3 sessions, always
  with `ignorable: true` and a contiguous `seq`; it never writes message text,
  never mutates other events, and never reaches the network. Pricing reads are
  read-only handles; a session still held by its agent refuses `open(id,'write')`
  and its steps stay in memory until `session/disposed` or the next startup.
  No endpoint is registered when `webServer` is absent, and any read/write
  failure degrades silently (endpoint `{ ok:false }`, browser half falls back
  to its own node path).
- Startup warm-up prices every stored session with `WARM_CONCURRENCY` workers
  and stays silent on success (only failures reach `console.error`); a session
  with a usable cost record is reused as its baseline — only later steps are
  priced, and none at all when the record already covers the log — while a
  session with no usable record (absent, or written under a different
  `PRICE_VERSION`) is fully re-priced and written back, which is the
  fresh-install backfill path.
- Slot registrations are plain entries: the on/off card on both
  `settings.plugins.tab` (Settings → Plugins section, id `simple-dock`) and the
  Plugins page's keyed `plugins.bundle.config` (key = this bundle's package
  name `dsh-ui-simple-dock`), five rows on `settings.general.item`
  (`dstat-enabled` first — the master switch — then `dstat-mode`,
  `dstat-pricing`, `dstat-currency`, `dstat-glass`), and the composer dock on
  `conversation.composer.dock` (id `stats`, `priority: -1` to shadow the
  official stats line). `settings.plugin.item` no longer exists in the 0.1.6
  shell: registering into an undeclared slot throws, so a stale slot would drop
  the card silently while the rest of the plugin keeps working.
- The General master switch row must render **while the dock is disabled** (it
  is the only way back); the other four rows keep returning null when disabled,
  like the panels.
- Dock layout: `.dsstat-root` is `flex: 1 1 auto` inside the official `.dock`
  row (the official context meter follows it in the same row), with
  `justify-content: space-between` giving `步数` the left edge and `命中率` the
  right edge. The context capsule is styled through the **adjacent sibling**
  `.dsstat-root + *` (slot entries add no wrapper DOM), with a
  `div:has(> .dsstat-root) > *:last-child` fallback in case upstream inserts
  one; those rules are cosmetic only and must not touch the official meter's
  click-open dialog. The `assets/thumbs/*` screenshots in the README predate
  this row layout — re-shoot them when the row changes.
- The card component serves both owners: `plugins.bundle.config` asks for a
  `summary` one-liner and a `page` body (`view` prop), the settings tab renders
  the body without a `view`.
- `dsh.client.inject` must list real client packages: it names the packages
  whose client bundles this plugin extends (`dsh-client-ui-slots`,
  `dsh-client-locale`, `dsh-client-ui-settings`, `dsh-client-ui-settings-plugins`,
  `dsh-client-ui-plugin-manager`). `@deepseek-ai/dsh-client-runtime` was removed
  upstream and must not be listed.
- The composer dock registration is dynamic: the plugin card's on/off switch
  subscribes the enabled pref and unregisters the dock (`slots.inject`
  disposer) so the official stats line renders again when disabled.
- CSS is injected as a `<style data-plugin="dsh-ui-simple-dock">`
  tag owned by the fiber; keep that attribute so the loader can clean it up.
