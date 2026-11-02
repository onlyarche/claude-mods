/**
 * What this session holds open, read off the tools that open and close it:
 * background shells and monitors, cron jobs, the /loop wakeup, published
 * artifacts, a worktree. Each says what ending the session does to it.
 */
import type { HudLink } from '../types'

export type LinkOp =
  | { add: HudLink }
  | { remove: string }
  | { removeKind: HudLink['kind'] }

type Fields = Record<string, unknown>

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v : undefined
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const fields = (v: unknown): Fields =>
  typeof v === 'object' && v !== null ? (v as Fields) : {}
const firstLine = (s: string) => s.split('\n')[0]?.trim() ?? s
const base = (path: string) => path.split('/').filter(Boolean).pop() ?? path

/** What a finished tool call opened or closed; nothing for other tools. */
export function linkOps(tool: string, input: unknown, result: unknown, at: number): LinkOp[] {
  const i = fields(input)
  const r = fields(result)
  switch (tool) {
    case 'Bash': {
      const id = str(r.backgroundTaskId)
      if (id === undefined) return []
      const label = str(i.description) ?? firstLine(str(i.command) ?? 'shell')
      return [{ add: { id, kind: 'shell', label, survives: false } }]
    }
    case 'Monitor': {
      const id = str(r.taskId)
      if (id === undefined) return []
      const timeout = num(r.timeoutMs) ?? 0
      const link: HudLink = { id, kind: 'monitor', label: str(i.description) ?? 'monitor', survives: false }
      return [{ add: timeout > 0 ? { ...link, until: at + timeout } : link }]
    }
    case 'TaskStop': {
      const id = str(r.task_id) ?? str(i.task_id) ?? str(i.shell_id)
      return id === undefined ? [] : [{ remove: id }]
    }
    case 'CronCreate': {
      const id = str(r.id)
      if (id === undefined) return []
      const isRecurring = r.recurring !== false
      const next = num(r.nextFireAt)
      const link: HudLink = {
        id,
        kind: 'cron',
        label: firstLine(str(i.prompt) ?? 'cron'),
        detail: str(r.humanSchedule) ?? str(i.cron),
        survives: r.durable === true,
      }
      // a one-shot job is gone once it has fired
      return [{ add: !isRecurring && next !== undefined ? { ...link, until: next } : link }]
    }
    case 'CronDelete': {
      const id = str(r.id) ?? str(i.id)
      return id === undefined ? [] : [{ remove: id }]
    }
    case 'ScheduleWakeup': {
      if (r.stopped === true || i.stop === true) return [{ removeKind: 'loop' }]
      const when = num(r.scheduledFor)
      const link: HudLink = { id: 'loop', kind: 'loop', label: str(i.reason) ?? '/loop', survives: false }
      return [{ add: when !== undefined ? { ...link, until: when } : link }]
    }
    case 'Artifact': {
      const action = str(i.action) ?? 'publish'
      if (action === 'delete') {
        const url = str(i.url)
        return url === undefined ? [] : [{ remove: url }]
      }
      const url = str(r.url)
      if (action !== 'publish' || url === undefined) return []
      const path = str(r.path) ?? str(i.file_path)
      const label = str(r.title) ?? str(i.title) ?? (path !== undefined ? base(path) : 'artifact')
      return [{ add: { id: url, kind: 'artifact', label, url, survives: true } }]
    }
    case 'EnterWorktree': {
      const path = str(r.worktreePath)
      if (path === undefined) return []
      const label = str(r.worktreeBranch) ?? base(path)
      return [{ add: { id: 'worktree', kind: 'worktree', label, detail: path, survives: true } }]
    }
    case 'ExitWorktree':
      return [{ removeKind: 'worktree' }]
    default:
      return []
  }
}

/** The tools linkOps reads: the hook awaits their results, no other's. */
export const LINK_TOOLS = new Set([
  'Bash', 'Monitor', 'TaskStop', 'CronCreate', 'CronDelete',
  'ScheduleWakeup', 'Artifact', 'EnterWorktree', 'ExitWorktree',
])

export function applyOps(list: HudLink[], ops: LinkOp[]): HudLink[] {
  let next = list
  for (const op of ops) {
    if ('add' in op) next = [...next.filter(l => l.id !== op.add.id), op.add]
    else if ('remove' in op) next = next.filter(l => l.id !== op.remove)
    else next = next.filter(l => l.kind !== op.removeKind)
  }
  return next.slice(-50)
}

const DONE = new Set(['completed', 'failed', 'killed', 'stopped', 'error', 'cancelled'])

/** A background task's notification: the task it ended, if it says so. */
export function endedTask(text: string): string | undefined {
  const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(text)?.[1]
  const status = /<status>\s*([^<\s]+)\s*<\/status>/.exec(text)?.[1]?.toLowerCase()
  return id !== undefined && status !== undefined && DONE.has(status) ? id : undefined
}

/** The links still standing at `at`: a timed one leaves when its time passes. */
export const live = (list: HudLink[], at: number): HudLink[] =>
  list.filter(l => l.until === undefined || at === 0 || l.until > at)

/** The session's name as its transcript records it: a /rename over the AI's. */
export function titleFrom(grepOutput: string): string | undefined {
  let custom: string | undefined
  let ai: string | undefined
  for (const line of grepOutput.split('\n')) {
    if (line.trim() === '') continue
    try {
      const parsed = JSON.parse(`{${line}}`) as { customTitle?: unknown; aiTitle?: unknown }
      if (typeof parsed.customTitle === 'string') custom = parsed.customTitle
      if (typeof parsed.aiTitle === 'string') ai = parsed.aiTitle
    } catch {
      // a line grep cut mid-escape: skip it
    }
  }
  return custom ?? ai
}

/** Where Claude Code keeps a session's transcript, by its start directory. */
export const transcriptPath = (configDir: string, cwd: string, id: string): string =>
  `${configDir}/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}/${id}.jsonl`
