# AGENTS.md

Agent guide for installing, building, and verifying **Simple Dock**
(`@deepseek-ai/dsh-client-ui-simple-dock`) — a DSH web-client bundle that
replaces the composer dock stats line with interactive performance / brief /
token / estimated-cost panels.

## What this package is

- **Bundle type**: client-only UI plugin (node half is an empty `apply`).
- **Registration**: `dsh.client` declaration in `package.json` + one insert
  row in the web profile's `cordis.patch.yml`. No approval flow: bundles load
  automatically once the composition includes them.
- **Runtime dependencies**: only `react` (loader platform module) plus the
  `slots` service. Everything else (token usage projection, model from session
  nodes, price table fetched in-browser with built-in fallback) is client-side.

## Install

Preferred — run the installer (idempotent):

```sh
./install.sh
```

It does two things:

1. Symlinks this directory into
   `$DSH_HOME/profiles/node_modules/@deepseek-ai/dsh-client-ui-simple-dock`.
2. Appends (if absent) to `$DSH_HOME/profiles/web/cordis.patch.yml`:

   ```yaml
   - insert:
       - id: simple-dock
         name: '@deepseek-ai/dsh-client-ui-simple-dock'
   ```

Manual equivalent:

```sh
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
ln -sfn "$PWD" "$DSH_HOME/profiles/node_modules/@deepseek-ai/dsh-client-ui-simple-dock"
# then append the insert row above to $DSH_HOME/profiles/web/cordis.patch.yml
```

> `$DSH_HOME/profiles/node_modules` is a shared hoisted store: the symlink
> target must be the package root (the directory containing `package.json`),
> and the link name must be the exact package name (scoped path included).

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
     "const m = await import('@deepseek-ai/dsh-client-ui-simple-dock'); console.log(typeof m.apply)"
   ```

   → prints `function`.
3. After restart, in the web UI: the dock shows `步数 N` / `命中率 X%`;
   `设置 → 插件` lists a **Simple Dock** card with an on/off switch;
   `设置 → 通用设置` shows the four rows (底栏面板样式 / 价格表（实时）/
   成本计价币种 / 面板玻璃). Check the browser console for
   `client-modules` load errors if anything is missing.

## Uninstall

```sh
./uninstall.sh   # removes the symlink and the patch row
```

## Build

```sh
node build.js
```

Zero-dependency bundler: merges `src/client/*.js` into `lib/client.js`
(`window.__ModuleLoader__.load({ id, factory })` format, `react` external),
copies the node half to `lib/index.js`, writes hand-typed `lib/types/*`.
Build-time checks: syntax + smoke tests (model normalization, fallback price
tables, cost pipeline with offline fetch, unknown-model branch). Do not edit
`lib/` by hand — it is generated.

## Layout

```
src/index.js        node half (empty apply — pure UI plugin)
src/client/         prices.js · core.js · components.js · index.js · styles.css
lib/                built outputs (committed for git installs)
build.js            the bundler
install.sh / uninstall.sh
dynamic/            legacy session-scoped dynamic-plugin sources (not used)
assets/ demo/       screenshots and recordings
```

## Notes

- Do not add host-side logic: the web profile loads only the client half; the
  node half must stay dependency-free.
- The settings plugin card and general rows are plain slot registrations
  (`settings.plugin.item` id `simple-dock`, `settings.general.item` ids
  `dstat-*`, composer dock id `stats` order 0).
- CSS is injected as a `<style data-plugin="@deepseek-ai/dsh-client-ui-simple-dock">`
  tag owned by the fiber; keep that attribute so the loader can clean it up.
