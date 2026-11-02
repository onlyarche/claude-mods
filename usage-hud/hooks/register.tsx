import { atom, read, update } from 'claude-code'
import type {
  ContextCategory,
  EngineInterface,
  ModelUsage,
  Register,
  SessionContextUsage,
  SessionCost,
  SessionRateLimit,
} from 'claude-code'

import type { HudCompaction, HudCtxItem, HudGroups, HudPromptCard, HudSnapshot, HudTally } from '../types'
import {
  breakdownLines,
  exitLines,
  fit,
  headerLines,
  hudLines,
  seconds,
  statsLines,
  tokens,
  usd,
} from './draw'
import type { Action, Line } from './draw'
import { applyOps, endedTask, LINK_TOOLS, linkOps, titleFrom, transcriptPath } from './links'
import { attachmentItem, cardLines, contextItems, estimateTokens, mediaItem, promptSection } from './prompts'
import { applyTheme, COLOR_NAMES, currentColors, DEFAULT_BASE, parseHex, THEME } from './palette'
import { maskBlock } from './secrets'
import { bump, mcpUse, namedUse } from './stats'
import type { Use } from './stats'

const PANE = 'usage-hud'
const TITLE = 'Usage'
const STORE_DENOMINATOR = 'denominator'
const STORE_TALLIES = 'tallies'
const STORE_FOLDED = 'folded'
/**
 * What every open of the pane says: each open sets the background anew, so
 * one that left it out would hand the HUD back to the terminal's own. Read
 * at each open, as the person's theme set it (`surface=terminal`: none).
 */
const paneArgs = () => ({
  id: PANE,
  title: TITLE,
  ...(THEME.surface !== undefined && { backgroundColor: THEME.surface }),
})
/** What every compaction's summary keeps, unless the option says otherwise. */
const DEFAULT_KEEP = [
  "Write the summary so the work can resume without re-asking or redoing anything. Keep, with exact names (paths, symbols, commands, commit hashes, URLs):",
  "1. The goal, what is done, what is in progress, and the exact next step.",
  "2. Every explicit instruction, constraint, preference and correction from the user, quoted verbatim in the user's own language where short.",
  "3. Each file created, edited or deleted: its path, what changed and why.",
  "4. Decisions and their reasons, including approaches rejected and why, so they are not reopened.",
  "5. Errors and failed attempts, with the cause and the fix or workaround that worked.",
  "6. Facts the work depends on: how the code, tools and APIs actually behave, and the commands that build, test and run it.",
  "7. Anything changed outside the conversation: pushes, publishes, uploads, installs, running processes, with their identifiers.",
  "8. Open questions, and anything promised to the user but not yet done.",
  "Drop pleasantries, superseded plans, and tool output already acted on.",
].join('\n')
const SECTIONS = new Set(['prompt', 'mix', 'tools'])
const DEFAULT_DENOMINATOR = 8
/** Fewest rows the top block draws, however small 1/n of the screen is. */
const MIN_ROWS = 4
/** Rows asked for when the pane sits inline above the prompt. */
const INLINE_ROWS = 8
/** The engine docks a pane at least 24 columns and at most 45% wide. */
const DOCK_MIN = 24
const DOCK_MAX_SHARE = 0.45
const TURN_TOAST_MS = 6000
/** A skill its own slash command ran expands within this long of it. */
const SAME_RUN_MS = 10_000
const ALIVE = new Set(['pending', 'running', 'waiting', 'idle'])

const NO_GROUPS: HudGroups = {
  system: 0, mcp: 0, memory: 0, other: 0, messages: 0, buffer: 0, free: 0,
}

// Bump a shape tag when that value's fields change: it declines what an
// earlier version stored, which outlives a reload.
const snapshot = atom(
  { plugin: 'usage-hud', key: 'snapshot' } as const,
  { rateLimits: [] },
  { shape: 'snapshot-1' },
)
const compactions = atom(
  { plugin: 'usage-hud', key: 'compactions' } as const,
  [],
  { shape: 'compactions-1' },
)
const isCompacting = atom({ plugin: 'usage-hud', key: 'isCompacting' } as const, false)
const denominator = atom(
  { plugin: 'usage-hud', key: 'denominator' } as const,
  DEFAULT_DENOMINATOR,
)
const now = atom({ plugin: 'usage-hud', key: 'now' } as const, 0)
const masked = atom({ plugin: 'usage-hud', key: 'masked' } as const, 0)
const breakdown = atom(
  { plugin: 'usage-hud', key: 'breakdown' } as const,
  { isMeasured: false, groups: NO_GROUPS, mcpServers: 0, skills: 0 },
  { shape: 'breakdown-1' },
)
const tallies = atom({ plugin: 'usage-hud', key: 'tallies' } as const, [], { shape: 'tallies-1' })
const allTime = atom({ plugin: 'usage-hud', key: 'allTime' } as const, [], { shape: 'tallies-1' })
const running = atom({ plugin: 'usage-hud', key: 'running' } as const, [], { shape: 'running-1' })
const session = atom({ plugin: 'usage-hud', key: 'session' } as const, {}, { shape: 'session-1' })
const links = atom({ plugin: 'usage-hud', key: 'links' } as const, [], { shape: 'links-1' })
const agents = atom({ plugin: 'usage-hud', key: 'agents' } as const, [], { shape: 'agents-1' })
const prompts = atom({ plugin: 'usage-hud', key: 'prompts' } as const, [], { shape: 'prompts-1' })
const build = atom({ plugin: 'usage-hud', key: 'build' } as const, {}, { shape: 'build-1' })
const picked = atom({ plugin: 'usage-hud', key: 'picked' } as const, {}, { shape: 'picked-1' })
const folded = atom({ plugin: 'usage-hud', key: 'folded' } as const, [] as string[])
const opened = atom({ plugin: 'usage-hud', key: 'opened' } as const, '')

/** Where this copy was loaded from, by its folder. */
const sourceOf = (root: string): string =>
  root.includes('/plugins/synced/') ? 'claude.ai' : root.includes('/plugins/cache/') ? 'installed' : 'local'

/** This copy's version from its own manifest: no API hands a plugin its version. */
async function readBuild($: EngineInterface): Promise<void> {
  try {
    const manifest = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)) as { version?: unknown }
    const version = typeof manifest.version === 'string' ? manifest.version : undefined
    await update($, build, () => json({ version, source: sourceOf($.plugin.root) }))
  } catch (error) {
    debug($, 'manifest read', error)
  }
}
const CARD_ROW = 'ctx-'

// The dock width last asked for, so a redraw asks again only on a change.
let askedColumns: number | undefined
// The session's cost when the main loop's running turn started.
let turnStart: { turnId: string; usd: number } | undefined
// The transcript file, as a classic event names it, else as worked out.
let transcript: string | undefined
// The last slash command counted, so the skill it expands is not counted
// toward its plugin twice.
let lastCommand: { name: string; at: number } | undefined
// The prompt typed and not yet started as a turn, gathering what it carries.
let pending: HudPromptCard | undefined
// The card whose first request is still gathering, once its turn started.
let collecting: string | undefined
// The paths this prompt @-mentioned, to name the files it sent.
let mentioned: string[] = []
// Blocks computed before their prompt is (the engine reads a prompt's
// first-message context and its @-mentions before raising prompt.submit).
let orphans: HudCtxItem[] = []
// True while a main-loop turn runs: what it injects then is no prompt's own.
let isTurnRunning = false

/** Who typed it: the terminal, Remote Control, an SDK host (the desktop app), Slack. */
const TYPED = new Set(['composer', 'bridge', 'sdk', 'slack-ping'])

/** Adds what a prompt sent along to its card, wherever that card stands. */
async function carry($: EngineInterface, items: HudCtxItem[]): Promise<void> {
  if (items.length === 0) return
  if (collecting !== undefined) {
    const id = collecting
    await update($, prompts, list =>
      list.map(card => (card.id === id ? { ...card, items: [...card.items, ...items].slice(0, 60) } : card)),
    )
  } else if (pending !== undefined) {
    pending = { ...pending, items: [...pending.items, ...items] }
  } else if (!isTurnRunning) {
    // between turns: it belongs to the prompt about to be submitted
    orphans = [...orphans, ...items]
  }
  // mid-turn, after the prompt's own request: a reminder, not the prompt's
}

/** The card stops gathering: its first request has gone. */
async function closeCards($: EngineInterface): Promise<void> {
  collecting = undefined
  mentioned = []
  await update($, prompts, list =>
    list.some(card => card.isOpen) ? list.map(card => ({ ...card, isOpen: false })) : list,
  )
}

type Usage = {
  context: SessionContextUsage
  rateLimits: SessionRateLimit[]
  cost?: SessionCost
}

/** Drops undefined fields: $.state holds JSON data only. */
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const isDenominator = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 2 && value <= 16

const isTallies = (value: unknown): value is HudTally[] =>
  Array.isArray(value) &&
  value.every(
    one =>
      typeof one === 'object' && one !== null &&
      typeof (one as HudTally).name === 'string' &&
      typeof (one as HudTally).calls === 'number',
  )

const absorb = (held: HudSnapshot, usage: Usage): HudSnapshot =>
  json({
    ...held,
    context: {
      tokens: usage.context.tokens,
      window: usage.context.window,
      percent: usage.context.percent,
    },
    rateLimits: usage.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({
      kind,
      percentUsed,
      resetsAt,
    })),
    costUsd: usage.cost?.usd ?? held.costUsd,
  })

const dockColumns = (terminalColumns: number, den: number): number =>
  Math.max(
    DOCK_MIN,
    Math.min(Math.round(terminalColumns / den), Math.floor(terminalColumns * DOCK_MAX_SHARE)),
  )

/** The HUD group one of /context's rows folds into. */
function groupOf(c: ContextCategory): keyof HudGroups {
  const name = c.name.toLowerCase()
  return c.kind === 'free' ? 'free'
    : c.kind === 'buffer' ? 'buffer'
      : name.includes('mcp') ? 'mcp'
        : name.includes('system') ? 'system'
          : name.includes('memory') ? 'memory'
            : name.includes('message') ? 'messages'
              : 'other'
}

/** /context's rows, folded into the HUD's groups; deferred tools left out. */
function group(categories: readonly ContextCategory[]): HudGroups {
  const groups = { ...NO_GROUPS }
  for (const c of categories) {
    if (c.kind === 'deferred' || c.isDeferred) continue
    groups[groupOf(c)] += c.tokens
  }
  return groups
}

const byTokens = <T extends { tokens: number }>(list: T[]) => [...list].sort((a, b) => b.tokens - a.tokens)

/** What a click on a context mix row opens: the breakdown behind each group. */
function mixDetails(b: NonNullable<SessionContextUsage['breakdown']>) {
  const perServer = new Map<string, { tools: number; loaded: number; tokens: number }>()
  for (const tool of b.mcpTools ?? []) {
    const held = perServer.get(tool.serverName) ?? { tools: 0, loaded: 0, tokens: 0 }
    held.tools += 1
    // a deferred tool costs nothing until it is loaded
    if (tool.isLoaded) {
      held.loaded += 1
      held.tokens += tool.tokens
    }
    perServer.set(tool.serverName, held)
  }
  return {
    mcpServers: perServer.size,
    rows: (b.categories ?? [])
      .filter(c => !(c.kind === 'deferred' || c.isDeferred))
      .map(c => ({ name: c.name, tokens: c.tokens, group: groupOf(c) })),
    servers: [...perServer]
      .map(([name, held]) => ({ name, ...held }))
      .sort((x, y) => y.tokens - x.tokens || y.tools - x.tools)
      .slice(0, 60),
    memoryFiles: byTokens((b.memoryFiles ?? []).map(f => ({ path: f.path, tokens: f.tokens }))).slice(0, 30),
    agentTypes: byTokens((b.agents ?? []).map(a => ({ name: a.agentType, tokens: a.tokens }))).slice(0, 40),
    skillList: byTokens((b.skills?.skillFrontmatter ?? []).map(s => ({ name: s.name, plugin: s.pluginName, tokens: s.tokens }))).slice(0, 40),
    skillsTotal: b.skills?.totalSkills,
    skillTokens: b.skills?.tokens,
    commands: b.slashCommands === undefined
      ? undefined
      : { listed: b.slashCommands.includedCommands, total: b.slashCommands.totalCommands, tokens: b.slashCommands.tokens },
    window: b.rawMaxTokens,
    compactAt: b.isAutoCompactEnabled ? b.autoCompactThreshold : undefined,
  }
}

const debug = ($: EngineInterface, what: string, error: unknown) =>
  $.ui.log(`usage-hud: ${what} failed: ${String(error)}`, { to: 'debug' })

async function tick($: EngineInterface): Promise<void> {
  const at = await $.clock.now()
  await update($, now, () => at)
}

/**
 * Reads the context's breakdown (a local estimate: no requests are sent):
 * the auto-compact point, the context mix, and what is loaded.
 */
async function refreshBreakdown($: EngineInterface): Promise<void> {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const b = usage.context.breakdown
    if (b === undefined) return // no session bound yet
    await update($, snapshot, held =>
      json({
        ...held,
        autoCompactAt: b.isAutoCompactEnabled ? b.autoCompactThreshold : undefined,
        isAutoCompactEnabled: b.isAutoCompactEnabled,
      }),
    )
    await update($, breakdown, () => json({
      isMeasured: true,
      groups: group(b.categories ?? []),
      skills: b.skills?.includedSkills ?? 0,
      ...mixDetails(b),
    }))
  } catch (error) {
    debug($, 'breakdown read', error)
  }
}

async function refreshUsage($: EngineInterface): Promise<void> {
  try {
    const usage = await $.session.usage()
    await update($, snapshot, held => absorb(held, usage))
  } catch (error) {
    debug($, 'usage read', error)
  }
}

/**
 * The session's id, and its name as its transcript records it. No API reads
 * the name, so this greps the transcript for the entries /rename and the
 * automatic title write: an internal format, so a miss just leaves no name.
 */
async function refreshSession($: EngineInterface): Promise<void> {
  try {
    const id = await $.session.id()
    let name: string | undefined
    if (transcript !== undefined) {
      const found = await $.process.run([
        'grep', '-oE', '"(customTitle|aiTitle)":"([^"\\\\]|\\\\.)*"', transcript,
      ])
      name = titleFrom(found.stdout)
    }
    await update($, session, () => json({ id, name }))
  } catch (error) {
    debug($, 'session read', error)
  }
}

async function refreshAgents($: EngineInterface): Promise<void> {
  try {
    const list = await $.agent.list()
    await update($, agents, () =>
      list
        .filter(agent => ALIVE.has(agent.status))
        .map(({ id, type, description, status }) => ({ id, type, description, status })),
    )
  } catch (error) {
    debug($, 'agent list', error)
  }
}

/** Artifacts published earlier in this conversation, which outlive it. */
async function backfillLinks($: EngineInterface, at: number): Promise<void> {
  try {
    const messages = await $.session.messages()
    const ops = messages.flatMap(message =>
      message.toolUses.flatMap(use => linkOps(use.tool, use.input, use.result, at)),
    )
    // only what outlives a process: a shell of an earlier run is long gone
    const kept = ops.filter(op => !('add' in op) || op.add.survives)
    if (kept.length > 0) await update($, links, list => applyOps(list, kept))
  } catch (error) {
    debug($, 'transcript read', error)
  }
}

/** Counts a use this session and across sessions. */
async function count($: EngineInterface, use: Use, toPlugin = true): Promise<void> {
  await update($, tallies, list => bump(list, use, toPlugin))
  const every = await update($, allTime, list => bump(list, use, toPlugin))
  await $.store.set(STORE_TALLIES, every)
}

function turnToastText(
  spent: number,
  durationMs: number,
  usage: ModelUsage | undefined,
  isAborted: boolean,
): string {
  const parts = [`turn ${usd(spent)}`, seconds(durationMs)]
  if (usage !== undefined) parts.push(`${tokens(usage.output_tokens)} out`)
  if (isAborted) parts.push('interrupted')
  return parts.join(' · ')
}

/** `/usage-hud colors`: every color by the name an override takes, and how to change them. */
function colorsText(themeColor: unknown, problems: readonly string[]): string {
  const base = parseHex(themeColor)
  const colors = currentColors()
  const isDefault = base === undefined || base === DEFAULT_BASE
  const row = (title: string, names: readonly (typeof COLOR_NAMES)[number][]) =>
    `${title}: ${names.map(name => `${name} ${colors[name] ?? 'terminal'}`).join(' · ')}`
  return [
    `usage-hud colors, theme ${base ?? DEFAULT_BASE}${isDefault ? ' (the validated default palette)' : ' (derived from it, not validated)'}`,
    row('background', ['surface']),
    row('gauges', ['ok', 'warn', 'high']),
    row('context mix', ['system', 'mcp', 'memory', 'other', 'messages']),
    row('text and marks', ['text', 'muted', 'label', 'mark', 'buffer', 'track']),
    ...(problems.length > 0 ? [`not applied: ${problems.join('; ')}`] : []),
    'Change them in /config: Theme color (#rrggbb, every color follows it), Color overrides (name=#rrggbb, comma separated; surface=terminal keeps the terminal\'s background).',
  ].join('\n')
}

const textStyle = (run: Line[number]) => ({
  ...(run.color !== undefined && { color: run.color }),
  ...(run.bold === true && { bold: true }),
})

// ---- hooks ---------------------------------------------------------------

export const register: Register = (on, options) => {
  // An install screen that shows no default can store an empty value; an
  // empty value still keeps the summary's essentials. Only `off` drops them.
  const typedInstructions =
    typeof options.compactInstructions === 'string' ? options.compactInstructions.trim() : ''
  const compactInstructions =
    typedInstructions.toLowerCase() === 'off' ? ''
      : typedInstructions === '' ? DEFAULT_KEEP
        : typedInstructions
  const isTurnToastOn = options.turnToast !== false
  const isMaskOn = options.maskSecrets !== false
  const isPromptCardOn = options.promptContext !== false
  // The person's colors, before anything draws; a change in /config reloads
  // the module with the new options, so it applies at once.
  const colorProblems = applyTheme(options.themeColor, options.colorOverrides)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-hud',
      description: 'Open the usage HUD, or size it: /usage-hud 6 takes 1/6 of the screen',
      argumentHint: '[2-16 | close | version | colors]',
    })
    await readBuild($)
    if (colorProblems.length > 0) {
      $.ui.toast(`usage-hud colors: ${colorProblems.join('; ')}`, { timeoutMs: 10_000 })
    }
    // folded sections stay folded across sessions
    const keptFolds = await $.store.get(STORE_FOLDED)
    if (Array.isArray(keptFolds)) {
      const sections = keptFolds.filter((one): one is string => typeof one === 'string' && SECTIONS.has(one))
      await update($, folded, () => sections)
    }
    const den = await $.store.get(STORE_DENOMINATOR)
    await update($, denominator, () => (isDenominator(den) ? den : DEFAULT_DENOMINATOR))
    const kept = await $.store.get(STORE_TALLIES)
    if (isTallies(kept)) await update($, allTime, () => kept)

    try {
      const home = await $.env.get('HOME')
      const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home ?? ''}/.claude`
      transcript ??= transcriptPath(config, e.cwd, await $.session.id())
    } catch (error) {
      debug($, 'transcript path', error) // the name then waits for a prompt's event
    }

    await tick($)
    // On the timer, not at each turn's end: the name's grep reads the whole
    // transcript, and no turn should wait on it.
    $.clock.every(60_000, () => {
      void tick($)
      void refreshAgents($)
      void refreshSession($)
    })
    await refreshUsage($)
    await refreshBreakdown($)
    await refreshSession($)
    await refreshAgents($)
    await backfillLinks($, await $.clock.now())
    if (e.isInteractive) void $.ui.open({ ...paneArgs(), rows: INLINE_ROWS })

    return next(e)
  })

  // The transcript's own path, from the classic event that carries it.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (typeof e.transcript_path === 'string' && e.transcript_path !== '') {
      transcript = e.transcript_path
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    await update($, snapshot, held => absorb(held, e))
    if (e.changed.includes('context')) await refreshBreakdown($)

    return next(e)
  })

  // ---- what a prompt you typed sent to the model ----

  on('prompt.submit', async ($, e, next) => {
    // Yours only: not a notification, a peer's message or a hidden prompt.
    const isMine = TYPED.has(e.origin.kind) && e.isMeta !== true
    if (isMine) {
      // The card exists before `next`: the turn starts, and the request's
      // attachments arrive, while `next` runs.
      pending = {
        id: '',
        typedChars: [...e.text].length,
        typedTokens: estimateTokens(e.text),
        items: [...orphans, ...(e.attachments ?? []).map(mediaItem)],
        isOpen: true,
        at: await $.clock.now(),
      }
      orphans = []
    }
    const result = await next(e)
    if (isMine && pending !== undefined) {
      if (result.drop !== undefined) pending = undefined
      else pending = { ...pending, typedChars: [...result.text].length, typedTokens: estimateTokens(result.text) }
    }

    return result
  }).catch(($, e, next) => next(e)) // never stands in a prompt's way

  on('prompt.mention', async ($, e, next) => {
    const read = await next(e)
    if (e.agentId === undefined && !('deny' in read && typeof read.deny === 'string')) {
      mentioned = [...mentioned, e.path]
    }
    return read
  }).catch(($, e, next) => next(e))

  on('prompt.context', async ($, e, next) => {
    const sent = await next(e)
    await carry($, contextItems(sent.blocks, sent.instructionFiles ?? e.instructionFiles))
    return sent
  }).catch(($, e, next) => next(e))

  on('prompt.attachment', async ($, e, next) => {
    const sent = await next(e)
    // the main loop's, and only what is actually sent (a hook may drop it)
    if (e.agentId === undefined && typeof sent.text === 'string' && sent.text !== '') {
      await carry($, [attachmentItem(e.type, sent.text, e.origin, mentioned)])
    }
    return sent
  }).catch(($, e, next) => next(e))

  // ---- tool calls: MCP use, and what the session opens and closes ----

  on('tool.call', async ($, e, next) => {
    // the main loop's first tool call: the prompt's own request has gone
    if (e.agentId === undefined && collecting !== undefined) await closeCards($)
    const tool = String(e.tool)
    const use = mcpUse(tool)
    if (use === undefined && !LINK_TOOLS.has(tool)) return next(e)

    if (use !== undefined) {
      await count($, use)
      await update($, running, list => [...list, { id: e.tool_use_id, detail: use.detail }])
    }
    try {
      const done = await next(e)
      if (LINK_TOOLS.has(tool) && done.deny === undefined && done.isError !== true) {
        const ops = linkOps(tool, e, done.result, await $.clock.now())
        if (ops.length > 0) await update($, links, list => applyOps(list, ops))
      }
      return done
    } finally {
      if (use !== undefined) {
        await update($, running, list => list.filter(call => call.id !== e.tool_use_id))
      }
    }
  }).catch(($, e, next) => next(e)) // a HUD never stands in a tool call's way

  // ---- skills, slash commands and subagents ----

  on('skill.prompt', async ($, e, next) => {
    const use = namedUse('skill', e.skill, e.pluginName)
    const at = await $.clock.now()
    // run by its own slash command: the command already counted the plugin
    const isSameRun =
      lastCommand !== undefined &&
      at - lastCommand.at < SAME_RUN_MS &&
      (lastCommand.name === e.skill || lastCommand.name.endsWith(`:${use.name}`) || lastCommand.name === use.name)
    await count($, use, !isSameRun)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', async ($, e, next) => {
    if (e.command !== 'usage-hud') {
      const info = (await $.command.list()).find(one => one.name === e.command)
      if (info !== undefined && info.source !== 'builtin') {
        lastCommand = { name: e.command, at: await $.clock.now() }
        await count($, namedUse('command', e.command, info.plugin))
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (!('deny' in result && typeof result.deny === 'string')) {
      await count($, namedUse('agent', e.subagentType))
    }
    await refreshAgents($)

    return result
  }).catch(($, e, next) => next(e))

  // ---- per-turn cost; agents' turns refresh the agent list ----

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      await refreshAgents($)
      return next(e)
    }
    try {
      const usage = await $.session.usage() // the plain call is free
      turnStart = { turnId: e.turnId, usd: usage.cost?.usd ?? 0 }
    } catch {
      turnStart = undefined
    }

    isTurnRunning = true
    // The prompt that started this turn: its card joins the list, and a
    // row right under the prompt in the transcript draws it. A turn no
    // prompt of yours started takes no card, and what it gathered goes.
    if (pending === undefined) {
      orphans = []
      mentioned = []
    } else {
      const card: HudPromptCard = { ...pending, id: e.turnId }
      pending = undefined
      collecting = card.id
      await update($, prompts, list => [...list, card].slice(-40))
      if (isPromptCardOn) {
        await $.ui.place({ id: `${CARD_ROW}${card.id}` }).catch(error => debug($, 'card row', error))
      }
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      await refreshAgents($)
      return result
    }
    isTurnRunning = false
    await closeCards($)

    const started = turnStart?.turnId === e.turnId ? turnStart.usd : undefined
    turnStart = undefined
    try {
      const usage = await $.session.usage()
      const total = usage.cost?.usd
      const spent =
        total !== undefined && started !== undefined ? Math.max(0, total - started) : undefined
      await update($, snapshot, held =>
        json({ ...absorb(held, usage), lastTurnUsd: spent, lastTurnMs: e.durationMs }),
      )
      if (isTurnToastOn && spent !== undefined && spent > 0) {
        $.ui.toast(turnToastText(spent, e.durationMs, e.usage, e.isAborted), {
          timeoutMs: TURN_TOAST_MS,
        })
      }
    } catch (error) {
      debug($, 'turn cost read', error)
    }

    return result
  })

  // ---- compaction: steer the summary, and log what it did ----

  on('session.compact', async ($, e, next) => {
    // Every trigger, `precompute` too: a summary computed ahead of time is
    // the one the coming compaction keeps.
    const steered =
      compactInstructions === ''
        ? e
        : {
            ...e,
            instructions: e.instructions
              ? `${e.instructions}\n\n${compactInstructions}`
              : compactInstructions,
          }

    // Subagents compact their own transcripts: the HUD follows the main one.
    if (e.trigger === 'precompute' || e.agentId !== undefined) return next(steered)

    await update($, isCompacting, () => true)
    try {
      const result = await next(steered)
      if (result.skip === undefined) {
        const at = await $.clock.now()
        const entry: HudCompaction = json({
          at,
          trigger: e.trigger,
          before: result.tokensBefore,
          after: result.tokensAfter,
        })
        await update($, compactions, list => [...list, entry].slice(-20))
        // The context figure only moves with the next reply: show the drop now.
        const after = result.tokensAfter
        if (after !== undefined) {
          await update($, snapshot, held =>
            held.context === undefined
              ? held
              : json({
                  ...held,
                  context: {
                    ...held.context,
                    tokens: after,
                    percent: held.context.window > 0
                      ? Math.round((after / held.context.window) * 100)
                      : held.context.percent,
                  },
                }),
          )
        }
        await refreshBreakdown($)
      }

      return result
    } finally {
      await update($, isCompacting, () => false)
    }
  }).catch(($, e, next) => next(e)) // a HUD never stands in a compaction's way

  // ---- rows: secrets masked before they are kept; tasks that ended ----

  on('session.append', async ($, e, next) => {
    // A background task's notification says when a shell or monitor ended.
    if (e.origin.kind === 'task-notification') {
      const text = e.message.content
        .map(block => (typeof block.text === 'string' ? block.text : ''))
        .join('\n')
      const ended = endedTask(text)
      if (ended !== undefined) await update($, links, list => applyOps(list, [{ remove: ended }]))
    }

    if (!isMaskOn) return next(e)
    const found: string[] = []
    const content = e.message.content.map(block => maskBlock(block, found))
    if (found.length === 0) return next(e)

    const stored = await next({ ...e, message: { ...e.message, content } })
    await update($, masked, n => n + found.length)
    const kinds = [...new Set(found)].join(', ')
    $.ui.toast(`masked ${found.length} secret${found.length > 1 ? 's' : ''}: ${kinds}`)

    return stored
  }).catch(($, e, next) => {
    // Fails open: a row is never lost to this hook. Said in the debug log.
    $.ui.log('usage-hud: append hook failed; the row was kept as made', { to: 'debug' })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, compactions, () => [])
      await update($, masked, () => 0)
      await update($, tallies, () => [])
      await update($, session, () => ({}))
      await update($, prompts, () => [])
      pending = undefined
      collecting = undefined
      await update($, snapshot, held =>
        held.context === undefined ? held : { ...held, context: { window: held.context.window } },
      )
    }

    return next(e)
  })

  // ---- the command and the pane ----

  on('command.run', { command: 'usage-hud' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Usage HUD closed.' }
    }
    if (arg === 'version') {
      const held = await read($, build)
      const version = held.version !== undefined ? `usage-hud ${held.version}` : 'usage-hud (version unknown)'
      return { text: `${version}, loaded from ${held.source ?? sourceOf($.plugin.root)}: ${$.plugin.root}` }
    }
    if (arg === 'colors') return { text: colorsText(options.themeColor, colorProblems) }
    let den = await read($, denominator)
    if (arg !== '') {
      const n = Number(arg)
      if (!isDenominator(n)) {
        return { text: 'Usage: /usage-hud [2-16 | close | version | colors]. The top block takes 1/n of the screen.' }
      }
      den = n
      await update($, denominator, () => n)
      await $.store.set(STORE_DENOMINATOR, n)
    }
    const columns = dockColumns(e.presentation.columns, den)
    askedColumns = columns
    await $.ui.open({ ...paneArgs(), columns, rows: INLINE_ROWS })

    return { text: `Usage HUD at 1/${den} of the screen (${columns} columns).` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [snap, log, busy, den, at, maskedCount, mix, used, every, calls, sess, open, alive, typed, held, pick0, folds, details] =
      await Promise.all([
        read($, snapshot),
        read($, compactions),
        read($, isCompacting),
        read($, denominator),
        read($, now),
        read($, masked),
        read($, breakdown),
        read($, tallies),
        read($, allTime),
        read($, running),
        read($, session),
        read($, links),
        read($, agents),
        read($, prompts),
        read($, build),
        read($, picked),
        read($, folded),
        read($, opened),
      ])
    const viewport = e.viewport
    const isDock = e.props.placement === 'dock' && viewport !== undefined
    const width = Math.max(16, e.props.bodyColumns)

    // Docked, keep the dock at 1/den of the terminal's width. A width the
    // person dragged the dock to still wins: the engine's rule, not ours.
    if (isDock) {
      const want = dockColumns(viewport.columns, den)
      if (want !== askedColumns) {
        askedColumns = want
        $.ui.open({ ...paneArgs(), columns: want }).catch(() => undefined)
      }
    }

    // Top: which session, then the block that takes 1/den of the height.
    // Docked, the middle holds the last prompt, the context mix and the tool
    // stats, each a section its title folds, and the bottom what ending the
    // session touches.
    const topRows = isDock ? Math.max(MIN_ROWS, Math.round(viewport.rows / den)) : INLINE_ROWS
    const upper = [
      ...headerLines(sess, held, width),
      ...hudLines(snap, log, busy, maskedCount, at, width).slice(0, topRows),
    ]
    const card = typed[typed.length - 1]
    const pick = card !== undefined && pick0.card === card.id ? pick0.index : undefined
    const isFolded = (id: string) => folds.includes(id)
    let lines: Line[]
    if (isDock) {
      const room = Math.max(upper.length, e.props.scroll.bodyRows)
      const middle = [
        ...promptSection(card, pick, isFolded('prompt'), width),
        ...breakdownLines(mix, width, isFolded('mix'), details),
        ...statsLines(calls, used, every, mix, width, isFolded('tools'), details, alive),
      ]
      const bottom = exitLines(open, alive, at, width)
      const spare = room - upper.length - middle.length - bottom.length
      // Fits: the bottom sits at the dock's foot. Taller than the dock: it
      // follows the rest, and the pane scrolls (click it, then the wheel or
      // the arrows); folding a section gives the room back.
      const gap: Line[] = Array.from({ length: Math.max(0, spare) }, () => [])
      lines = [...upper, ...middle, ...gap, ...bottom]
    } else {
      // Inline above the prompt: the last prompt's title line only.
      lines = [...upper, ...promptSection(card, undefined, true, width)]
    }

    const copyOut = async (text: string) => {
      const copied = await $.ui.copy({ text, surface: e.surface })
      $.ui.toast(copied.isCopied ? `copied: ${text}` : 'could not copy here')
    }
    const press = (action: Action) => {
      if ('copy' in action) return void copyOut(action.copy)
      if ('select' in action) {
        const { card: id, index } = action.select
        return void update($, picked, now =>
          now.card === id && now.index === index ? {} : { card: id, index },
        )
      }
      // one row's details open at a time: the dock has little room
      if ('open' in action) return void update($, opened, now => (now === action.open ? '' : action.open))
      // `update` may run its change again on a race, so the save follows it
      return void update($, folded, now =>
        now.includes(action.toggle) ? now.filter(one => one !== action.toggle) : [...now, action.toggle],
      )
        .then(next => $.store.set(STORE_FOLDED, next))
        .catch(error => debug($, 'fold save', error))
    }
    // A button's key stays the same across redraws, so focus stays put.
    const keyOf = (action: Action, i: number) =>
      'copy' in action ? `copy-${i}`
        : 'select' in action ? `item-${action.select.card}-${action.select.index}`
          : 'open' in action ? `open-${action.open}`
            : `toggle-${action.toggle}`

    return (
      <Box flexDirection="column">
        {lines.map((runs, i) => {
          const texts = fit(runs, width).map(run => (
            <Text {...textStyle(run)}>{run.text}</Text>
          ))
          if (texts.length === 0) return <Text> </Text>
          const action = runs.find(run => run.action !== undefined)?.action
          if (action === undefined) return <Box flexDirection="row">{texts}</Box>
          const key = keyOf(action, i)
          // the keyed Box is the area the pointer hovers: the row lights up
          return (
            <Box key={`row-${key}`} flexDirection="row">
              <Button key={key} plain hover={{ inverse: true }} onPress={() => press(action)}>
                {texts}
              </Button>
            </Box>
          )
        })}
      </Box>
    )
  })

  // The card under a prompt: every plugin's hook hears every placed row, so
  // a row that is not one of ours passes to the hooks beneath.
  on('ui.render', { component: 'Placed' }, async ($, e, next) => {
    if (e.props.plugin !== 'usage-hud' || !e.props.id.startsWith(CARD_ROW)) return next(e)
    const card = (await read($, prompts)).find(one => `${CARD_ROW}${one.id}` === e.props.id)
    if (card === undefined) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const width = Math.min(76, Math.max(32, (e.viewport?.columns ?? 80) - 4))

    return (
      <Box flexDirection="column">
        {cardLines(card, width).map(runs => (
          <Box flexDirection="row">
            {fit(runs, width).map(run => (
              <Text {...textStyle(run)}>{run.text}</Text>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
