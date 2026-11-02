import type { HudTally } from '../types'

/** What one use counts toward. */
export type Use = {
  kind: 'mcp' | 'skill' | 'command' | 'agent'
  /** the server, skill, command or agent type, as drawn */
  name: string
  /** the plugin that ships it, when one does */
  plugin?: string
  /** what a running call shows: server.tool */
  detail: string
}

/**
 * Reads an MCP tool's name, `mcp__<server>__<tool>`:
 *  - `plugin_<plugin>_<server>`: a plugin's server (plugin names hold no `_`)
 *  - `claude_ai_<Name>`: a claude.ai connector
 *  - anything else: a server of the person's own config
 */
export function mcpUse(tool: string): Use | undefined {
  if (!tool.startsWith('mcp__')) return undefined
  const rest = tool.slice('mcp__'.length)
  const cut = rest.indexOf('__')
  if (cut <= 0) return undefined
  const server = rest.slice(0, cut)
  const name = rest.slice(cut + 2)

  if (server.startsWith('plugin_')) {
    const inner = server.slice('plugin_'.length)
    const split = inner.indexOf('_')
    if (split > 0) {
      const plugin = inner.slice(0, split)
      const own = inner.slice(split + 1)
      return { kind: 'mcp', name: own, plugin, detail: `${own}.${name}` }
    }
  }
  const shown = server.startsWith('claude_ai_')
    ? server.slice('claude_ai_'.length).replace(/_/g, ' ')
    : server
  return { kind: 'mcp', name: shown, detail: `${shown}.${name}` }
}

/**
 * Reads a skill, command or agent type: the plugin that ships it as the
 * engine says, else as its name says (`<plugin>:<name>`).
 */
export function namedUse(kind: 'skill' | 'command' | 'agent', full: string, pluginName?: string): Use {
  const cut = full.indexOf(':')
  const name = cut > 0 ? full.slice(cut + 1) : full
  const plugin = pluginName ?? (cut > 0 ? full.slice(0, cut) : undefined)
  return plugin === undefined
    ? { kind, name, detail: full }
    : { kind, name, plugin, detail: full }
}

const same = (a: HudTally, kind: HudTally['kind'], name: string, plugin?: string) =>
  a.kind === kind && a.name === name && a.plugin === plugin

function bumpOne(list: HudTally[], kind: HudTally['kind'], name: string, plugin?: string): HudTally[] {
  const found = list.find(one => same(one, kind, name, plugin))
  if (found === undefined) {
    const fresh: HudTally = plugin === undefined ? { kind, name, calls: 1 } : { kind, name, plugin, calls: 1 }
    return [...list, fresh]
  }
  return list.map(one => (one === found ? { ...one, calls: one.calls + 1 } : one))
}

/**
 * Counts one use toward its server, skill, command or agent type, and toward
 * its plugin unless `toPlugin` is false (a skill its own slash command ran,
 * already counted for the plugin once).
 */
export function bump(list: HudTally[], use: Use, toPlugin = true, cap = 300): HudTally[] {
  let next = bumpOne(list, use.kind, use.name, use.plugin)
  if (toPlugin && use.plugin !== undefined) next = bumpOne(next, 'plugin', use.plugin)
  return next.length > cap ? [...next].sort((a, b) => b.calls - a.calls).slice(0, cap) : next
}

/** The most used of one kind, most first. */
export const top = (list: HudTally[], kind: HudTally['kind'], n: number): HudTally[] =>
  list
    .filter(one => one.kind === kind)
    .sort((a, b) => b.calls - a.calls)
    .slice(0, n)
