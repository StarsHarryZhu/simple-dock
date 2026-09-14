# AGENTS.md

Agent guide for installing, building, and verifying **Simple Dock**
(`dsh-ui-simple-dock`) — a DSH web-client bundle that
replaces the composer dock stats line with interactive performance / brief /
token / estimated-cost panels.

## What this package is

- **Bundle type**: UI plugin with a thin node half. The node half registers the
  `simple-dock` settings namespace (the browser card is keyed by it) and serves
  one same-origin, read-only endpoint, `/dsh-simple-dock/api/steps`, returning
  a session's per-step usage read through the Host's own `sessionPersistence`.
  The browser half prices costs from that complete log; the endpoint exists
  because the Client's conversation nodes are only the rows its window has
  loaded, so pricing history from nodes alone drifted with the visible range.
- **Registration**: `dsh.client` declaration in `package.json` + one insert
  row in the web profile's `cordis.patch.yml`. No approval flow: bundles load
  automatically once the composition includes them.
- **Runtime dependencies**: the browser half needs only `react` (loader
  platform module) plus the `slots` and `locale` services — both must be
  inject-declared (`export const inject = ['slots', 'locale']`): the locale
  roster row (dsh-client-locale) can apply after this plugin, and a bare
  `ctx.get('locale')` at apply time would then miss it and leave every label
  on the raw-key fallback. The node half imports only
  `@deepseek-ai/schemastery` and progressively injects the optional `settings`
  (namespace registration), and `webServer` + `sessionPersistence` (the steps
  endpoint) services — no value import of dsh-settings is needed, and no
  endpoint is registered where `webServer` is absent; schemastery must resolve
  from the package's local `node_modules` when installed manually via symlink
  (see Install). Everything else (token usage projection, model from session
  nodes, built-in price table with peak/off-peak tiers) is client-side and
  never fetches an external price table.

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
3. After restart, in the web UI: the dock shows `步数 N` / `命中率 X%`;
   `设置 → 插件` lists a **Simple Dock** card with an on/off switch;
   `设置 → 通用设置` shows the four rows (底栏面板样式 / 价格表 /
   成本计价币种 / 面板玻璃). Check the browser console for
   `client-modules` load errors if anything is missing.
4. Steps endpoint (web profile only): the cost line carries the
   `完整记录` / "full log" marker when the browser half priced the complete
   log. The endpoint itself answers per-step rows for a stored session:

   ```sh
   curl -s "http://127.0.0.1:3080/dsh-simple-dock/api/steps?sessionId=<session-id>"
   ```

   → `{"ok":true,"steps":[{"time":…,"model":…,"uncached":…,"read":…,"write":…,"out":…}]}`.
   A `401` means the web session is not authenticated, `403` an off-origin
   caller, `404 {ok:false,"reason":"session-unreadable"}` an unknown session —
   none of those is a plugin defect, and each one makes the browser half fall
   back to its node path.

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

Zero-dependency bundler: merges `src/client/*.js` into `lib/client.js`
(`window.__ModuleLoader__.load({ id, factory })` format, `react` external),
copies the node half to `lib/index.js`, writes hand-typed `lib/types/*`.
Build-time checks: syntax + smoke tests (zh/en dictionary key parity,
model normalization, peak/off-peak price lookup with the 2026-08-17
effective date and UTC peak-hour boundaries, the 2026-08-23 Beijing-time
weekend all-day off-peak rule, per-step cost pipeline priced at each step's
completion time, the averaged leftover fallback, the node-half step
projection and the host-priced path, unknown-model branch). Do not edit
`lib/` by hand — it is generated.

## Layout

```
src/index.js        node half (settings namespace + /dsh-simple-dock/api/steps)
src/client/         i18n.js · prices.js · core.js · components.js · index.js · styles.css
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

- Keep the node half small and read-only: it registers the `simple-dock`
  settings namespace (an empty schema — the card stores its state in
  localStorage) and serves the same-origin steps endpoint through
  `sessionPersistence`. It must never write session data, never reach the
  network, and never return message text — only per-step token counts, times
  and model ids. No endpoint is registered when `webServer` is absent, and a
  read failure answers `{ ok: false }` so the browser half falls back to its
  own node path.
- The settings plugin card and general rows are plain slot registrations
  (`settings.plugin.item` key `simple-dock` — keyed slots dispatch by the
  served namespace, not an id — `settings.general.item` ids `dstat-*`,
  composer dock id `stats` priority -1).
- The composer dock registration is dynamic: the plugin card's on/off switch
  subscribes the enabled pref and unregisters the dock (`slots.inject`
  disposer) so the official stats line renders again when disabled.
- CSS is injected as a `<style data-plugin="dsh-ui-simple-dock">`
  tag owned by the fiber; keep that attribute so the loader can clean it up.
