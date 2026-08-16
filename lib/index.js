/**
 * Simple Dock node half. Pure UI plugin: the empty apply exists so the plugin
 * appears in the host cordis.yml / Loader; the browser half ships via
 * exports["./client"], discovered through the package.json dsh.client
 * declaration. All features run in the browser — no host-side behavior.
 */
export function apply() {}
