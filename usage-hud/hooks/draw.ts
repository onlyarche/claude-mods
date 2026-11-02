/**
 * The HUD's lines as data: each line a list of colored runs, so the hooks
 * module turns them into Box/Text on any surface and tests read them plainly.
 */
import type {
  HudAgent,
  HudBreakdown,
  HudBuild,
  HudCompaction,
  HudGroups,
  HudLink,
  HudRunning,
  HudSession,
  HudSnapshot,
  HudTally,
} from '../types'
import { live } from './links'
import { THEME } from './palette'
import { GLYPH, level, severity } from './severity'
import { top } from './stats'

/**
 * What pressing a line does: copy a text, pick a prompt item to see its
 * details, or fold a section. A run carrying one makes its line a button.
 */
export type Action =
  | { copy: string }
  | { select: { card: string; index: number } }
  | { toggle: string }
  /** open (or close) a context mix or tools row's details: `mix:mcp`, `tools:agent` */
  | { open: string }

/** A colored run; `action` makes its whole line a button. */
export type Run = { text: string; color?: string; bold?: boolean; action?: Action }
export type Line = Run[]

const { ink, series } = THEME

// ---- formatting ----------------------------------------------------------

export const tokens = (n: number): string =>
  n < 1000
    ? `${n}`
    : n < 10_000
      ? `${(n / 1000).toFixed(1)}k`
      : n < 1_000_000
        ? `${Math.round(n / 1000)}k`
        : `${(n / 1_000_000).toFixed(1)}M`

export const span = (ms: number): string => {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours}h${minutes % 60}m` : `${hours}h`
  return `${Math.round(hours / 24)}d`
}

export const seconds = (ms: number): string => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export const usd = (n: number): string =>
  n < 0.001 ? '<$0.001' : n < 0.1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`

// ---- primitives ----------------------------------------------------------

/** East Asian wide characters (한글, 漢字, emoji) take two cells. */
const isWide = (cp: number): boolean =>
  (cp >= 0x1100 && cp <= 0x115f) ||
  (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
  (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe30 && cp <= 0xfe4f) ||
  (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) ||
  (cp >= 0x1f300 && cp <= 0x1f64f) ||
  (cp >= 0x1f900 && cp <= 0x1f9ff) ||
  (cp >= 0x20000 && cp <= 0x3fffd)

/** How many terminal cells `text` takes. */
export function cells(text: string): number {
  let n = 0
  for (const ch of text) n += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1
  return n
}

/** The longest head of `text` that fits in `room` cells. */
function head(text: string, room: number): string {
  let out = ''
  let used = 0
  for (const ch of text) {
    const w = isWide(ch.codePointAt(0) ?? 0) ? 2 : 1
    if (used + w > room) break
    out += ch
    used += w
  }
  return out
}

/** `text` padded with spaces to `width` cells (a wide character takes two). */
export const padCells = (text: string, width: number): string =>
  text + ' '.repeat(Math.max(0, width - cells(text)))

/** Cuts a line's runs to `width` cells, an ellipsis where it cut. */
export function fit(runs: Line, width: number): Line {
  const out: Line = []
  let room = width
  for (const run of runs) {
    if (room <= 0) break
    const text = cells(run.text) > room ? `${head(run.text, room - 1)}…` : run.text
    out.push({ ...run, text })
    room -= cells(text)
  }
  return out
}

/**
 * A section's title as a button that folds and unfolds it: `▾ title ───`
 * open, `▸ title ───` folded.
 */
export const sectionRule = (id: string, title: string, isFolded: boolean, width: number): Line =>
  fit([
    { text: isFolded ? '▸ ' : '▾ ', color: ink.label, bold: true, action: { toggle: id } },
    { text: `${title} ${'─'.repeat(Math.max(0, width - cells(title) - 3))}`, color: ink.muted },
  ], width)

/** `text` broken into lines of at most `width` cells, its own breaks kept. */
export function wrapCells(text: string, width: number): string[] {
  const out: string[] = []
  for (const raw of text.replace(/\t/g, '  ').split('\n')) {
    let rest = raw.trimEnd()
    if (rest === '') {
      if (out[out.length - 1] !== '') out.push('')
      continue
    }
    while (cells(rest) > width) {
      const piece = head(rest, width)
      out.push(piece)
      rest = rest.slice(piece.length)
    }
    out.push(rest)
  }
  return out
}

// ---- details: what a click on a row opens under it -----------------------

const BAR = '  ┊ '

/**
 * One line of details: a name and its figure. Given a value to copy, it is a
 * button that copies it, marked ⧉ where the others show ┊.
 */
export function detailRow(name: string, figure: string, width: number, copy?: string): Line {
  const room = Math.max(6, width - 4 - (figure === '' ? 0 : figure.length + 1))
  const cut = cells(name) > room ? `${head(name, room - 1)}…` : name
  return [
    copy !== undefined
      ? { text: '  ⧉ ', color: THEME.status.ok, bold: true, action: { copy } }
      : { text: BAR, color: ink.muted },
    { text: padCells(cut, room), color: ink.text },
    ...(figure === '' ? [] : [{ text: ` ${figure}`, color: ink.muted }]),
  ]
}

/** A muted note in the details, wrapped to the width. */
export const detailNote = (text: string, width: number): Line[] =>
  wrapCells(text, Math.max(8, width - 4)).map(part => [
    { text: BAR, color: ink.muted },
    { text: part, color: ink.muted },
  ])

/** The first `most` of a list as detail lines, then how many more there are. */
function listed<T>(items: readonly T[], line: (item: T) => Line, width: number, most = 12): Line[] {
  const out = items.slice(0, most).map(line)
  if (items.length > most) out.push(...detailNote(`+${items.length - most}개 더`, width))
  return out
}

const shortPath = (path: string) => path.split('/').filter(Boolean).slice(-2).join('/')

/** `── title ─────`, a section's rule, `width` wide. */
export const rule = (title: string, width: number): Line => [
  { text: `── ${title} ${'─'.repeat(Math.max(0, width - title.length - 4))}`, color: ink.muted },
]

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/** A bar of `width` cells, filled to `used`, with a mark at `mark` (0..1). */
function bar(width: number, used: number, color: string, mark?: number): Line {
  const markAt =
    mark === undefined ? -1 : Math.min(width - 1, Math.floor(mark * width))
  const runs: Array<Run & { kind: string }> = []
  for (let i = 0; i < width; i++) {
    const fill = Math.max(0, Math.min(1, used * width - i))
    const eighth = Math.floor(fill * 8)
    const [ch, kind] =
      i === markAt
        ? ['┃', 'mark']
        : fill >= 1
          ? ['█', 'fill']
          : eighth > 0
            ? [EIGHTHS[eighth] ?? '█', 'fill']
            : ['░', 'empty']
    const last = runs[runs.length - 1]
    if (last?.kind === kind) last.text += ch
    else if (kind === 'fill') runs.push({ kind, text: ch, color })
    else if (kind === 'mark') runs.push({ kind, text: ch, color: ink.mark, bold: true })
    else runs.push({ kind, text: ch, color: ink.track })
  }
  return runs.map(({ kind: _kind, ...run }) => run)
}

function gaugeLine(
  label: string,
  width: number,
  used: number,
  percent: number,
  mark?: number,
  suffix = '',
): Line {
  const clamped = Math.min(1, Math.max(0, used))
  const glyph = GLYPH[level(clamped, mark)]
  const head = `${label.padEnd(3)} `
  const tail = ` ${String(Math.round(percent)).padStart(3)}%${glyph.padEnd(2)}${suffix}`
  const barWidth = Math.max(4, width - head.length - tail.length)
  return [
    { text: head, color: ink.label, bold: true },
    ...bar(barWidth, used, severity(clamped, mark), mark),
    { text: tail, color: ink.text, bold: glyph !== '' },
  ]
}

// ---- the header: which session this is ----------------------------------

/** `v0.3.0 local`: which build runs, and the copy it was loaded from. */
export const buildTag = (build: HudBuild): string =>
  build.version === undefined ? '' : `v${build.version}${build.source !== undefined ? ` ${build.source}` : ''}`

/**
 * The session's name, then its id as a button that copies the resume line,
 * the HUD's version at the right of that line (the id is cut there anyway:
 * the button copies it whole).
 */
export function headerLines(session: HudSession, build: HudBuild, width: number): Line[] {
  const out: Line[] = []
  const tag = buildTag(build)
  if (session.name !== undefined) {
    out.push(fit([{ text: session.name, color: ink.label, bold: true, action: { copy: session.name } }], width))
  }
  if (session.id !== undefined) {
    const copy = `claude --resume ${session.id}`
    const room = Math.max(8, width - 2 - (tag === '' ? 0 : tag.length + 1))
    const id = cells(session.id) > room ? `${head(session.id, room - 1)}…` : session.id
    out.push([
      { text: '⧉ ', color: THEME.status.ok, bold: true, action: { copy } },
      { text: tag === '' ? id : padCells(id, room), color: ink.muted },
      ...(tag === '' ? [] : [{ text: ` ${tag}`, color: ink.label }]),
    ])
  } else if (tag !== '') {
    out.push(fit([{ text: `usage-hud ${tag}`, color: ink.muted }], width))
  }
  return out
}

// ---- the top block: context, rate limits, cost, compactions --------------

/** Every line the top block could draw, most important first. */
export function hudLines(
  snap: HudSnapshot,
  log: HudCompaction[],
  busy: boolean,
  maskedCount: number,
  at: number,
  width: number,
): Line[] {
  const out: Line[] = []
  const context = snap.context
  const window = context?.window ?? 0
  const filled = context?.tokens
  const used = filled !== undefined && window > 0 ? filled / window : 0
  const mark =
    snap.autoCompactAt !== undefined && window > 0
      ? snap.autoCompactAt / window
      : undefined

  // 1. the context gauge, the auto-compact point marked on it
  out.push(gaugeLine('ctx', width, used, context?.percent ?? used * 100, mark))

  // 2. its figures, or a compaction in progress
  if (busy) {
    out.push(fit([{ text: '⟳ compacting…', color: THEME.status.high, bold: true }], width))
  } else if (filled === undefined) {
    const text = window > 0 ? `–/${tokens(window)} no reply yet` : 'no reply yet'
    out.push(fit([{ text, color: ink.muted }], width))
  } else {
    const runs: Line = [{ text: `${tokens(filled)}/${tokens(window)}`, color: ink.muted }]
    if (snap.autoCompactAt !== undefined) {
      const left = snap.autoCompactAt - filled
      runs.push(
        left > 0
          ? { text: ` ⟳ in ${tokens(left)}`, color: ink.text }
          : { text: ' ⟳ due', color: THEME.status.high, bold: true },
      )
    } else if (snap.isAutoCompactEnabled === false) {
      runs.push({ text: ' ⟳ off', color: ink.muted })
    }
    out.push(fit(runs, width))
  }

  // 3. the rate-limit windows (subscriptions and gateways only)
  const LIMIT_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'lim' }
  for (const limit of snap.rateLimits) {
    const label = LIMIT_LABEL[limit.kind] ?? limit.kind.slice(0, 3)
    const resetIn =
      limit.resetsAt !== undefined && at > 0 ? Date.parse(limit.resetsAt) - at : Number.NaN
    const suffix = Number.isFinite(resetIn) && width >= 32 ? ` ${span(resetIn)}` : ''
    out.push(gaugeLine(label, width, limit.percentUsed / 100, limit.percentUsed, undefined, suffix))
  }

  // 4. cost (and the last turn's share), compactions, masked secrets
  const facts: Line = []
  if (snap.costUsd !== undefined) {
    facts.push({ text: `$${snap.costUsd.toFixed(2)}`, color: ink.text, bold: true })
    if (snap.lastTurnUsd !== undefined && snap.lastTurnUsd > 0) {
      facts.push({ text: ` +${usd(snap.lastTurnUsd).slice(1)}`, color: ink.muted })
    }
  }
  if (log.length > 0) {
    facts.push({ text: `${facts.length > 0 ? ' · ' : ''}⇣${log.length}`, color: ink.muted })
  }
  if (maskedCount > 0) {
    facts.push({ text: `${facts.length > 0 ? ' · ' : ''}${maskedCount} masked`, color: ink.label })
  }
  if (facts.length > 0) out.push(fit(facts, width))

  // 5. the last compaction: how far it shrank the context, and when
  const last = log[log.length - 1]
  if (last !== undefined) {
    const sizes =
      last.before !== undefined && last.after !== undefined
        ? `${tokens(last.before)}→${tokens(last.after)}`
        : last.trigger
    const ago = at > 0 ? ` ${span(at - last.at)} ago` : ''
    out.push(fit([{ text: `last ${sizes}${ago}`, color: ink.muted }], width))
  }

  return out
}

// ---- the context mix: a stacked bar and its legend -----------------------

/** `color` is read at draw time: the person's theme may change it after load. */
type Group = { key: keyof HudGroups; label: string; color: () => string; glyph: string }

/** Fixed order, fixed colors: a group keeps its color whatever is present. */
export const GROUPS: readonly Group[] = [
  { key: 'system', label: 'system', color: () => series.system, glyph: '█' },
  { key: 'mcp', label: 'MCP tools', color: () => series.mcp, glyph: '█' },
  { key: 'memory', label: 'memory', color: () => series.memory, glyph: '█' },
  { key: 'other', label: 'agents·skills', color: () => series.other, glyph: '█' },
  { key: 'messages', label: 'messages', color: () => series.messages, glyph: '█' },
  { key: 'buffer', label: 'compact buffer', color: () => ink.buffer, glyph: '▒' },
  { key: 'free', label: 'free', color: () => ink.track, glyph: '░' },
]

/** Splits `cells` in proportion to `values`, largest remainders first. */
function allocate(values: number[], cells: number): number[] {
  const total = values.reduce((sum, v) => sum + v, 0)
  if (total <= 0) return values.map(() => 0)
  const raw = values.map(v => (v / total) * cells)
  const out = raw.map(Math.floor)
  let left = cells - out.reduce((sum, v) => sum + v, 0)
  const order = raw
    .map((r, i) => [r - Math.floor(r), i] as const)
    .sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (left <= 0) break
    out[i] = (out[i] ?? 0) + 1
    left--
  }
  return out
}

/** What a click on a context mix row opens: the breakdown behind the group. */
function mixDetail(b: HudBreakdown, key: keyof HudGroups, width: number): Line[] {
  const rowsOf = (group: keyof HudGroups) => (b.rows ?? []).filter(row => row.group === group)
  const engineRows = (group: keyof HudGroups) =>
    listed(rowsOf(group), row => detailRow(row.name, tokens(row.tokens), width), width)
  const used = (Object.keys(b.groups) as (keyof HudGroups)[])
    .filter(name => name !== 'free' && name !== 'buffer')
    .reduce((sum, name) => sum + b.groups[name], 0)
  const compactLine = b.compactAt !== undefined ? [detailRow('자동 압축 시점', tokens(b.compactAt), width)] : []

  switch (key) {
    case 'system':
      return [...detailNote('시스템 프롬프트와 기본 도구 설명. 세션 내내 거의 그대로입니다.', width), ...engineRows('system')]
    case 'mcp': {
      const servers = b.servers ?? []
      return [
        ...detailNote(`MCP 서버 ${servers.length}개의 도구 설명 (로드된 도구/전체). 지연 로딩 도구는 쓰기 전까지 세지 않습니다. ⧉ 서버 이름 복사`, width),
        ...listed(servers, s => detailRow(`${s.name} ${s.loaded}/${s.tools}`, tokens(s.tokens), width, s.name), width),
      ]
    }
    case 'memory':
      return [
        ...detailNote('CLAUDE.md 같은 메모리 파일. ⧉ 전체 경로 복사', width),
        ...listed(b.memoryFiles ?? [], f => detailRow(shortPath(f.path), tokens(f.tokens), width, f.path), width),
      ]
    case 'other': {
      const named = (s: { name: string; plugin?: string }) => (s.plugin !== undefined ? `${s.plugin}:${s.name}` : s.name)
      return [
        ...detailNote('서브에이전트 종류, skill, slash command 목록의 설명.', width),
        ...engineRows('other'),
        ...((b.agentTypes ?? []).length > 0 ? detailNote('agent 종류, 토큰 순 · ⧉ 이름 복사', width) : []),
        ...listed(b.agentTypes ?? [], a => detailRow(a.name, tokens(a.tokens), width, a.name), width, 6),
        ...((b.skillList ?? []).length > 0
          ? detailNote(`skill ${b.skills}/${b.skillsTotal ?? b.skills}개 나열${b.skillTokens !== undefined ? ` ≈${tokens(b.skillTokens)}` : ''}, 토큰 순 · ⧉ 이름 복사`, width)
          : []),
        ...listed(b.skillList ?? [], s => detailRow(named(s), tokens(s.tokens), width, named(s)), width, 8),
        ...(b.commands !== undefined
          ? [detailRow(`slash command ${b.commands.listed}/${b.commands.total}`, tokens(b.commands.tokens), width)]
          : []),
      ]
    }
    case 'messages':
      return [
        ...detailNote('대화 내용: 프롬프트, 응답, tool 결과. 대화가 길어질수록 늘고, 압축하면 줄어듭니다.', width),
        ...engineRows('messages'),
        ...compactLine,
      ]
    case 'buffer':
      return [...detailNote('자동 압축이 돌 수 있도록 비워 두는 몫. 대화가 이 몫에 닿기 전에 압축이 시작됩니다.', width), ...compactLine]
    case 'free':
      return [
        ...detailNote('아직 비어 있는 공간.', width),
        ...(b.compactAt !== undefined ? [detailRow('압축까지 남음', tokens(Math.max(0, b.compactAt - used)), width)] : []),
        ...(b.window !== undefined ? [detailRow('전체 window', tokens(b.window), width)] : []),
      ]
  }
}

export function breakdownLines(b: HudBreakdown, width: number, isFolded = false, opened = ''): Line[] {
  if (!b.isMeasured) return []
  const values = GROUPS.map(g => b.groups[g.key])
  const total = values.reduce((sum, v) => sum + v, 0)
  if (total <= 0) return []
  const title = sectionRule('mix', 'context mix', isFolded, width)
  if (isFolded) return [title]

  const cells = allocate(values, width)
  const stacked: Line = GROUPS.flatMap((g, i) => {
    const n = cells[i] ?? 0
    return n > 0 ? [{ text: g.glyph.repeat(n), color: g.color() }] : []
  })

  // each row a button: a click opens its breakdown under it, another closes it
  const nameWidth = Math.max(6, width - 2 - 6 - 5)
  const legend: Line[] = GROUPS.flatMap(g => {
    const value = b.groups[g.key]
    if (value <= 0) return []
    const share = Math.round((value / total) * 100)
    const key = `mix:${g.key}`
    const isOpen = opened === key
    return [
      fit(
        [
          { text: `${g.glyph === '█' ? '■' : g.glyph} `, color: g.color(), action: { open: key } },
          { text: g.label.slice(0, nameWidth).padEnd(nameWidth), color: ink.text, bold: isOpen },
          { text: tokens(value).padStart(6), color: ink.muted },
          { text: `${String(share).padStart(4)}%`, color: ink.muted },
        ],
        width,
      ),
      ...(isOpen ? mixDetail(b, g.key, width) : []),
    ]
  })

  return [title, stacked, ...legend]
}

// ---- tools: MCP servers, skills and plugins, now and most used -----------

const KIND_LABEL = {
  mcp: 'mcp',
  skill: 'skill',
  command: 'cmd',
  agent: 'agent',
  plugin: 'plugin',
} as const

/** What copying a used thing gives: the name you would type or look up. */
function copyName(one: HudTally): string {
  const full = one.plugin !== undefined && one.kind !== 'mcp' && one.kind !== 'plugin' ? `${one.plugin}:${one.name}` : one.name
  return one.kind === 'command' || one.kind === 'skill' ? `/${full}` : full
}

/** What a click on a tools row opens: every one of that kind, most used first. */
function toolDetail(list: HudTally[], kind: HudTally['kind'], width: number, alive: readonly HudAgent[]): Line[] {
  const out: Line[] = []
  if (kind === 'agent' && alive.length > 0) {
    out.push(...detailNote(`지금 실행 중 ${alive.length}개 · ⧉ agent id 복사`, width))
    out.push(...listed(alive, a => detailRow(`${a.type}: ${a.description}`, a.status, width, a.id), width, 5))
  }
  const all = top(list, kind, 500)
  out.push(...detailNote(`${all.length}개, 많이 쓴 순 · ⧉ 이름 복사`, width))
  if (kind !== 'plugin') {
    out.push(...listed(all, one => detailRow(one.plugin !== undefined ? `${one.name} · ${one.plugin}` : one.name, String(one.calls), width, copyName(one)), width, 15))
    return out
  }
  // a plugin: its count, then what of it was used
  for (const plugin of all.slice(0, 8)) {
    out.push(detailRow(plugin.name, String(plugin.calls), width, plugin.name))
    const parts = list.filter(one => one.kind !== 'plugin' && one.plugin === plugin.name).sort((a, b) => b.calls - a.calls)
    out.push(...listed(parts, one => detailRow(`  ${KIND_LABEL[one.kind]} ${one.name}`, String(one.calls), width), width, 4))
  }
  if (all.length > 8) out.push(...detailNote(`+${all.length - 8}개 더`, width))
  return out
}

/** What a click on `loaded` opens: the MCP servers and skills the context lists. */
function loadedDetail(b: HudBreakdown, width: number): Line[] {
  const named = (s: { name: string; plugin?: string }) => (s.plugin !== undefined ? `${s.plugin}:${s.name}` : s.name)
  return [
    ...detailNote(`MCP 서버 ${b.mcpServers}개 (로드된 도구/전체), 토큰 순 · ⧉ 이름 복사`, width),
    ...listed(b.servers ?? [], s => detailRow(`${s.name} ${s.loaded}/${s.tools}`, tokens(s.tokens), width, s.name), width, 10),
    ...detailNote(`skill ${b.skills}/${b.skillsTotal ?? b.skills}개 나열${b.skillTokens !== undefined ? ` ≈${tokens(b.skillTokens)}` : ''}, 토큰 순`, width),
    ...listed(b.skillList ?? [], s => detailRow(named(s), tokens(s.tokens), width, `/${named(s)}`), width, 8),
    ...(b.commands !== undefined
      ? [detailRow(`slash command ${b.commands.listed}/${b.commands.total}`, tokens(b.commands.tokens), width)]
      : []),
  ]
}

/**
 * One row per kind: its most used, as many as fit whole, most first. Each
 * row a button: a click opens every one of its kind under it.
 */
function tallyRows(list: HudTally[], width: number, scope: string, opened: string, alive: readonly HudAgent[]): Line[] {
  return (['mcp', 'skill', 'command', 'agent', 'plugin'] as const).flatMap(kind => {
    const best = top(list, kind, 5)
    if (best.length === 0) return []
    const key = `${scope}:${kind}`
    const isOpen = opened === key
    const runs: Line = [{ text: KIND_LABEL[kind].padEnd(7), color: ink.label, bold: isOpen, action: { open: key } }]
    let used = 7
    for (const [i, one] of best.entries()) {
      const name = `${i > 0 ? ' · ' : ''}${one.name}`
      const calls = ` ${one.calls}`
      // the first always shows (cut if it must); the rest only whole
      if (i > 0 && used + name.length + calls.length > width) break
      runs.push({ text: name, color: ink.text }, { text: calls, color: ink.muted })
      used += name.length + calls.length
    }
    return [fit(runs, width), ...(isOpen ? toolDetail(list, kind, width, alive) : [])]
  })
}

export function statsLines(
  running: HudRunning[],
  session: HudTally[],
  allTime: HudTally[],
  b: HudBreakdown,
  width: number,
  isFolded = false,
  opened = '',
  alive: readonly HudAgent[] = [],
): Line[] {
  const out: Line[] = [sectionRule('tools', 'tools · session', isFolded, width)]
  if (isFolded) return out
  for (const call of running.slice(-3)) {
    out.push(fit([
      { text: '⟳ ', color: THEME.status.ok, bold: true, action: { copy: call.detail } },
      { text: call.detail, color: ink.text },
    ], width))
  }
  const sessionRows = tallyRows(session, width, 'tools', opened, alive)
  out.push(...(sessionRows.length > 0
    ? sessionRows
    : [fit([{ text: 'nothing used yet', color: ink.muted }], width)]))
  if (b.isMeasured && (b.mcpServers > 0 || b.skills > 0)) {
    const isOpen = opened === 'tools:loaded'
    out.push(fit([{ text: `loaded ${b.mcpServers} mcp · ${b.skills} skills`, color: ink.muted, bold: isOpen, action: { open: 'tools:loaded' } }], width))
    if (isOpen) out.push(...loadedDetail(b, width))
  }

  const allRows = tallyRows(allTime, width, 'all', opened, [])
  if (allRows.length > 0) out.push(rule('tools · all time', width), ...allRows)

  return out
}

// ---- on exit: what ending this session stops, and what it leaves ---------

type ExitItem = {
  kind: string
  label: string
  /** what ending the session does to it, in a word */
  effect: string
  /** true when ending the session ends it */
  stops: boolean
  /** a muted second line: a path, an address */
  sub?: string
  copy?: string
}

function exitItem(link: HudLink, at: number): ExitItem {
  const left = link.until !== undefined && at > 0 ? ` · in ${span(link.until - at)}` : ''
  switch (link.kind) {
    case 'shell':
      return { kind: 'shell', label: link.label, effect: 'killed', stops: true, copy: link.id }
    case 'monitor':
      return { kind: 'watch', label: `${link.label}${left}`, effect: 'killed', stops: true, copy: link.id }
    case 'cron': {
      const label = link.detail !== undefined ? `${link.detail} · ${link.label}` : link.label
      return link.survives
        ? { kind: 'cron', label, effect: 'stays', stops: false, copy: link.id }
        : { kind: 'cron', label: `${label}${left}`, effect: 'cancels', stops: true, copy: link.id }
    }
    case 'loop':
      return { kind: 'loop', label: `${link.label}${left}`, effect: 'cancels', stops: true }
    case 'artifact': {
      const sub = link.url?.replace(/^https?:\/\//, '')
      return link.url !== undefined && sub !== undefined
        ? { kind: 'art', label: link.label, effect: 'stays', stops: false, sub, copy: link.url }
        : { kind: 'art', label: link.label, effect: 'stays', stops: false }
    }
    case 'worktree':
      return link.detail !== undefined
        ? { kind: 'tree', label: link.label, effect: 'asks', stops: false, sub: link.detail, copy: link.detail }
        : { kind: 'tree', label: link.label, effect: 'asks', stops: false }
  }
}

/**
 * What this session holds open, each with what ending the session does to
 * it: running subagents stop, background shells and monitors are killed,
 * session cron jobs and the /loop wakeup are cancelled; published
 * artifacts and durable cron jobs stay; a worktree asks keep or remove.
 */
export function exitLines(links: HudLink[], agents: HudAgent[], at: number, width: number): Line[] {
  const items: ExitItem[] = [
    ...agents.map(a => ({
      kind: 'agent',
      label: a.description !== '' ? `${a.type}: ${a.description}` : a.type,
      effect: 'stops',
      stops: true,
      copy: a.id,
    })),
    ...live(links, at).map(link => exitItem(link, at)),
  ]
  const stops = items.filter(item => item.stops).length
  const title = items.length === 0
    ? 'on exit · nothing open'
    : `on exit · ${stops} stop · ${items.length - stops} stay`
  const out: Line[] = [rule(title, width)]

  for (const item of items) {
    // one column for every effect word, so the labels line up
    const effect = ` ${item.effect}`.padStart(8)
    const room = Math.max(4, width - 6 - effect.length)
    const cut = cells(item.label) > room ? `${head(item.label, room - 1)}…` : item.label
    const copy = item.copy !== undefined ? { action: { copy: item.copy } } : {}
    out.push([
      { text: item.kind.padEnd(6), color: ink.label, ...copy },
      { text: cut + ' '.repeat(Math.max(0, room - cells(cut))), color: ink.text },
      { text: effect, color: item.stops ? THEME.status.warn : ink.muted, bold: item.stops },
    ])
    if (item.sub !== undefined) {
      out.push(fit([{ text: `      ${item.sub}`, color: ink.muted, ...copy }], width))
    }
  }
  return out
}
