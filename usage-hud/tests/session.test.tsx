import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ID = '00000000-1111-4222-8333-444444444444'

const PANE = {
  plugin: 'usage-hud',
  component: 'Pane',
  requestId: 'usage-hud',
  props: {
    title: 'Usage',
    isFocused: false,
    bodyColumns: 30,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 47 },
    view: {},
  },
  viewport: { columns: 240, rows: 48, isFullscreen: true },
} as const

/** Everything a session start asks of the engine, answered from memory. */
function boot(on: On, seen: { argv?: readonly string[]; opens?: unknown[] } = {}, env: Record<string, string> = { COLORTERM: 'truecolor' }) {
  mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/Users/me', ...env })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'usage-hud' } }))
  on('ui.open', (_, e) => {
    seen.opens = [...(seen.opens ?? []), e]
    return { value: { isPlaced: true } }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } as never }))
  on('session.id', () => ({ value: ID }))
  on('process.run', (_, e) => {
    seen.argv = e.argv
    return {
      value: {
        exitCode: 0,
        stdout: '"aiTitle":"첫 제목"\n"customTitle":"HUD 작업 세션"\n"aiTitle":"나중 제목"\n',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('agent.list', () => ({
    value: [
      { id: 'a1', type: 'Explore', description: 'find usages', status: 'running' },
      { id: 'a2', type: 'Plan', description: 'finished', status: 'completed' },
    ] as never,
  }))
  on('session.messages', () => ({
    value: [{
      role: 'assistant',
      text: '',
      toolUses: [
        {
          tool_use_id: 't0',
          tool: 'Artifact',
          input: { file_path: '/x/report.html' },
          result: { url: 'https://claude.ai/code/artifact/abc', title: 'Usage report' },
        },
        {
          tool_use_id: 't1',
          tool: 'Bash',
          input: { command: 'old', run_in_background: true },
          result: { backgroundTaskId: 'old1' },
        },
      ],
    }] as never,
  }))
}

const START = { cwd: '/', surface: 'terminal', isInteractive: false } as const

test('the header names the session and copies its resume line', async ($, on) => {
  const seen: { argv?: readonly string[] } = {}
  boot(on, seen)
  let copied: string | undefined
  on('ui.copy', (_, e) => {
    copied = e.text
    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start(START)

  // a /rename (customTitle) wins over the automatic title
  expect(seen.argv?.at(-1)).toMatch(/\.claude\/projects\/.+\.jsonl$/)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^HUD 작업 세션$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^00000000-1111/ })).toBeDefined()
  await ui.press({ key: 'copy-1' })
  expect(copied).toBe(`claude --resume ${ID}`)
  await ui.unmount()
})

test('the bottom lists what ending the session stops and what stays', async ($, on) => {
  boot(on)
  on('tool.call', (_, e) => {
    switch (String(e.tool)) {
      case 'Bash':
        return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }
      case 'CronCreate':
        return { result: { id: 'c1', humanSchedule: 'every 5 min', recurring: true } }
      default:
        return { result: {} }
    }
  })

  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', description: 'dev server', run_in_background: true } as never)
  await $.tool.call({ tool: 'CronCreate', cron: '*/5 * * * *', prompt: 'check CI' } as never)

  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // the running agent, the shell, the cron job; the artifact from earlier in
  // the conversation stays, the shell of an earlier run is not listed
  expect(await ui.find({ type: 'Text', text: /on exit · 3 stop · 1 stay/ })).toBeDefined()
  // labels are cut to the 16 cells left beside the kind and the effect
  expect(await ui.find({ type: 'Text', text: /^Explore: find u…$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^dev server/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^every 5 min · c…$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ cancels$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^   stays$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Usage report/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^old/ })).toBeUndefined()
  await ui.unmount()

  // the shell's task notification ends it
  await $.session.append({
    message: {
      type: 'user',
      role: 'user',
      content: [{ type: 'text', text: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>' }],
    },
    door: 'delivery',
    origin: { kind: 'task-notification' },
    uuid: 'u2',
  } as never)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /on exit · 2 stop · 1 stay/ })).toBeDefined()
  await ui.unmount()
})

test('plugin slash commands and subagents are counted, a skill once per plugin', async ($, on) => {
  boot(on)
  on('command.list', () => ({
    value: [
      { name: 'review-pr', description: '', source: 'plugin', plugin: 'pr-review-toolkit' },
      { name: 'clear', description: '', source: 'builtin' },
    ] as never,
  }))
  on('command.run', () => ({ text: 'ok' }))
  on('skill.prompt', (_, e) => ({ text: e.text, frontmatter: e.frontmatter }))
  on('agent.spawn', () => ({ model: 'm' }))

  await $.session.start(START)
  const presentation = { isFullscreen: true, columns: 200 }
  await $.command.run({ command: 'review-pr', args: '', origin: { kind: 'composer' }, presentation } as never)
  await $.command.run({ command: 'clear', args: '', origin: { kind: 'composer' }, presentation } as never)
  // the skill the command expands: counted as a skill, not again for its plugin
  await $.skill.prompt({
    skill: 'pr-review-toolkit:review-pr', text: '', frontmatter: {}, source: 'plugin',
    pluginName: 'pr-review-toolkit',
  } as never)
  await $.agent.spawn({
    tool_use_id: 't9', prompt: 'p', description: 'explore', subagentType: 'feature-dev:code-explorer',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'm', background: false, fork: false,
  } as never)

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 60 }, surface: 'terminal' })
  const row = async (label: string) => {
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    const at = texts.indexOf(label.padEnd(7))
    return texts.slice(at, at + 5).join('')
  }
  expect(await row('cmd')).toMatch(/^cmd {4}review-pr 1/)
  expect(await row('skill')).toMatch(/^skill  review-pr 1/)
  expect(await row('agent')).toMatch(/^agent  code-explorer 1/)
  expect(await row('plugin')).toMatch(/^plugin pr-review-toolkit 1 · feature-dev 1/)
  expect((await ui.findAll({ type: 'Text', text: /^clear$/ })).length).toBe(0)
  await ui.unmount()
})

test('the header shows which build runs, and /usage-hud version says where from', async ($, on) => {
  boot(on)
  on('fs.read', (_, e) => ({
    value: e.path.endsWith('/.claude-plugin/plugin.json') ? JSON.stringify({ name: 'usage-hud', version: '9.9.9' }) : '',
  }))
  on('command.run', () => ({ text: 'beneath' }))

  await $.session.start(START)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // loaded from a folder of its own (not synced, not a cache copy): local
  expect(await ui.find({ type: 'Text', text: /^ v9\.9\.9 local$/ })).toBeDefined()
  await ui.unmount()

  const said = await $.command.run({
    command: 'usage-hud', args: 'version', origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  } as never)
  expect(String((said as { text?: string }).text)).toMatch(/^usage-hud 9\.9\.9, loaded from local: \/.+usage-hud$/)
})

test('every open of the HUD sets its background: transparent by default, on the terminal\'s own', async ($, on) => {
  const seen: { opens?: unknown[] } = {}
  boot(on, seen)
  on('command.run', () => ({ text: 'beneath' }))

  // the open at a session's start, the /usage-hud command's, and the one a
  // drawing makes to keep the dock at 1/8 of the terminal's width
  await $.session.start({ ...START, isInteractive: true })
  await $.command.run({
    command: 'usage-hud', args: '', origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  } as never)
  const ui = await $.ui.mount({ ...PANE, viewport: { columns: 320, rows: 48, isFullscreen: true }, surface: 'terminal' })
  await ui.unmount()

  const opens = (seen.opens ?? []) as Array<{ backgroundColor?: string }>
  expect(opens.length).toBeGreaterThan(2)
  for (const open of opens) expect(open.backgroundColor).toBe('transparent')
})

const colorsOf = async ($: { command: { run: (e: never) => Promise<unknown> } }) =>
  String(((await $.command.run({
    command: 'usage-hud', args: 'colors', origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  } as never)) as { text?: string }).text)

test('a 256-color terminal is handed the nearest of its colors, not chalk\'s rounding', { options: { colorOverrides: 'surface=theme' } }, async ($, on) => {
  const seen: { opens?: unknown[] } = {}
  boot(on, seen, { TERM_PROGRAM: 'Apple_Terminal', TERM: 'xterm-256color' })
  on('command.run', () => ({ text: 'beneath' }))

  await $.session.start({ ...START, isInteractive: true })

  // the background: chalk would round #15161c to navy #00005f; the HUD hands
  // it the input that lands on gray #121212 instead
  const opens = (seen.opens ?? []) as Array<{ backgroundColor?: string }>
  expect(opens.at(-1)?.backgroundColor).toBe('#121212')
  const said = await colorsOf($)
  expect(said).toContain('terminal: 256 colors (TERM_PROGRAM=Apple_Terminal, TERM=xterm-256color)')
  expect(said).toContain('surface #15161c→#121212')
  expect(said).toContain('ok #6266b7→#5f5faf')

  // the drawing's colors too: the label ink #b2b9f1 is shown as #afafff,
  // which chalk reaches from #9999ff
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const label = await ui.find({ type: 'Text', text: /^ctx $/ })
  expect(label?.props.color).toBe('#9999ff')
  await ui.unmount()
})

test('a 24-bit terminal gets the colors as set', { options: { colorOverrides: 'surface=theme' } }, async ($, on) => {
  const seen: { opens?: unknown[] } = {}
  boot(on, seen, { TERM_PROGRAM: 'iTerm.app', TERM: 'xterm-256color' })
  on('command.run', () => ({ text: 'beneath' }))

  await $.session.start({ ...START, isInteractive: true })

  expect(((seen.opens ?? []) as Array<{ backgroundColor?: string }>).at(-1)?.backgroundColor).toBe('#15161c')
  expect(await colorsOf($)).toContain('terminal: 24-bit color')
})

test('depth= in Color overrides corrects a terminal read wrong', { options: { colorOverrides: 'depth=truecolor, surface=theme' } }, async ($, on) => {
  const seen: { opens?: unknown[] } = {}
  boot(on, seen, { TERM_PROGRAM: 'Apple_Terminal', TERM: 'xterm-256color' })
  on('command.run', () => ({ text: 'beneath' }))

  await $.session.start({ ...START, isInteractive: true })

  expect(((seen.opens ?? []) as Array<{ backgroundColor?: string }>).at(-1)?.backgroundColor).toBe('#15161c')
  expect(await colorsOf($)).toContain('terminal: 24-bit color (set in Color overrides)')
})

test('inside tmux without 24-bit color, colors says how to let tmux pass it', { options: { colorOverrides: 'surface=theme' } }, async ($, on) => {
  const seen: { opens?: unknown[] } = {}
  boot(on, seen, { TMUX: '/tmp/tmux-1000/default,4242,0', TERM: 'tmux-256color' })
  on('command.run', () => ({ text: 'beneath' }))

  await $.session.start({ ...START, isInteractive: true })

  // tmux-256color with no COLORTERM: the engine paints 256 colors, and the
  // HUD hands it the nearest of them (the background near-black, not navy)
  expect(((seen.opens ?? []) as Array<{ backgroundColor?: string }>).at(-1)?.backgroundColor).toBe('#121212')
  const said = await colorsOf($)
  expect(said).toContain('terminal: 256 colors (TERM=tmux-256color)')
  expect(said).toContain('terminal-features ",*:RGB"')
  expect(said).toContain('export COLORTERM=truecolor')
})
