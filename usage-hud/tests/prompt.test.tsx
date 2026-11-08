import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

/** The test body's own `$`: the one that raises events. */
type Raiser = { turn: { start: (e: { text: string; turnId: string }) => Promise<unknown> } }

const CARD = (id: string) => ({
  plugin: 'usage-hud',
  component: 'Placed',
  requestId: `row-${id}`,
  props: { id: `ctx-${id}`, plugin: 'usage-hud' },
  viewport: { columns: 100, rows: 40, isFullscreen: true },
}) as const

const PANE = {
  plugin: 'usage-hud',
  component: 'Pane',
  requestId: 'usage-hud',
  props: {
    title: 'Usage', isFocused: false, bodyColumns: 40, placement: 'dock',
    scroll: { offset: 0, bodyRows: 47 }, view: {},
  },
  viewport: { columns: 240, rows: 48, isFullscreen: true },
} as const

/**
 * The engine beneath, in the order a real session raises the events (seen
 * in a headless run): a prompt's first-message context and its @-mentions
 * come before prompt.submit, and the turn starts inside prompt.submit's next.
 */
function engine(raise: Raiser, on: On, placed: string[] = [], turnIds: string | string[] = 't1') {
  // each submitted prompt starts the next turn id; the last one repeats
  const ids = Array.isArray(turnIds) ? [...turnIds] : [turnIds]
  mock.clock(on)
  mock.store(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } as never }))
  on('prompt.submit', async (_, e) => {
    const turnId = (ids.length > 1 ? ids.shift() : ids[0]) ?? 't1'
    await raise.turn.start({ text: e.text, turnId })
    return { text: e.text }
  })
  on('prompt.mention', () => ({ type: 'file' } as never))
  on('prompt.context', (_, e) => ({ blocks: e.blocks, instructionFiles: e.instructionFiles }))
  on('prompt.attachment', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))
  on('tool.call', () => ({ result: {} }))
  on('ui.place', (_, e) => {
    placed.push(e.id)
    return { value: {} as never }
  })
}

const typed = (text: string, extra: object = {}) =>
  ({ text, wait: false, origin: { kind: 'composer' }, ...extra }) as never

const attachment = (type: string, text: string, origin: object = { kind: 'engine' }) =>
  ({ type, text, origin }) as never

const done = (turnId: string) =>
  ({ answer: 'done', durationMs: 1000, isAborted: false, turnId, reason: 'answer' }) as never

test('a typed prompt gets a card of what went with it, under it', async ($, on) => {
  const placed: string[] = []
  engine($, on, placed)

  // before prompt.submit, as the engine raises them
  await $.prompt.context({
    blocks: [
      { name: 'claudeMd', text: 'Contents of /repo/CLAUDE.md: '.padEnd(400, 'x') },
      { name: 'currentDate', text: "Today's date is 2026-11-02." },
    ],
    instructionFiles: [{ path: '/repo/CLAUDE.md', kind: 'project', content: '' }],
  } as never)
  await $.prompt.mention({ mention: '@src/api.ts', path: '/repo/src/api.ts' } as never)
  await $.prompt.submit(typed('이 함수 리팩터링해줘 @src/api.ts', {
    attachments: [{ type: 'image', mediaType: 'image/png', filename: '/tmp/shot.png' }],
  }))
  // the request's own attachments, after the turn started
  await $.prompt.attachment(attachment('file', `the file\n${'code '.repeat(400)}\n/repo/src/api.ts`))
  await $.prompt.attachment(attachment('nested_memory', 'Contents of /repo/api/CLAUDE.md\nrules'))
  await $.prompt.attachment(attachment('hook_additional_context', 'branch: main', { kind: 'hook', event: 'UserPromptSubmit' }))
  await $.prompt.attachment(attachment('todo_reminder', 'The todo list is empty.'))
  // the first tool call: what comes after is not the prompt's own
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  await $.prompt.attachment(attachment('todo_reminder', 'later, between tool calls'))
  await $.turn.complete(done('t1'))

  expect(placed).toEqual(['ctx-t1'])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...CARD('t1'), surface })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text.trim())
    // image, CLAUDE.md, date, file, memory, hook, reminder: seven, the late one left out
    expect(texts.find(t => t.startsWith('typed'))).toMatch(/^typed ≈\d+ tok · context 7 ≈/)
    for (const want of ['attach', 'shot.png', 'base', 'CLAUDE.md · repo/CLAUDE.md', 'date',
      '@file', 'src/api.ts', 'memory', 'api/CLAUDE.md', 'hook', 'UserPromptSubmit', 'notice', 'todo reminder']) {
      expect(texts).toContain(want)
    }
    await ui.unmount()
  }

  // the HUD's prompt section: its title docked and inline alike
  for (const placement of ['dock', 'inline'] as const) {
    const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement }, surface: 'terminal' })
    expect(await pane.find({ type: 'Text', text: /^prompt · text ≈\d+ · ctx 7 ≈/ })).toBeDefined()
    await pane.unmount()
  }

  // docked, every item it sent, none left behind a "+N more"
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = async () => (await pane.findAll({ type: 'Text' })).map(t => t.text.trim())
  for (const want of ['date', 'shot.png', 'src/api.ts', 'api/CLAUDE.md', 'UserPromptSubmit', 'todo reminder']) {
    expect(await rows()).toContain(want)
  }
  // a label wider than the dock's column is cut; its details show it whole
  expect(await pane.find({ type: 'Text', text: /^CLAUDE\.md · repo\/CLAUDE.*…$/ })).toBeDefined()

  // a click on an item opens its details under it, a second closes them
  // (items: CLAUDE.md, date, the image, then the file, memory, hook, reminder)
  await pane.press({ key: 'item-t1-5' })
  expect(await rows()).toContain('hook_additional_context')
  // a value wider than the dock wraps onto the next line, whole
  expect((await rows()).join(' ')).toContain('settings hook · UserPromptSubmit'.slice(0, 20))
  expect(await rows()).toContain('UserPromptSubmit')
  expect(await rows()).toContain('branch: main')
  await pane.press({ key: 'item-t1-5' })
  expect(await rows()).not.toContain('branch: main')

  // a click on the title folds the section, a second unfolds it
  await pane.press({ key: 'toggle-prompt' })
  expect(await rows()).not.toContain('shot.png')
  expect(await pane.find({ type: 'Text', text: /^prompt · text/ })).toBeDefined()
  await pane.press({ key: 'toggle-prompt' })
  expect(await rows()).toContain('shot.png')
  await pane.unmount()
})

test('a reminder injected mid-turn stays off the next prompt', async ($, on) => {
  engine($, on, [], ['t1', 't2'])
  await $.prompt.submit(typed('first'))
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  await $.prompt.attachment(attachment('todo_reminder', 'mid-turn'))
  await $.turn.complete(done('t1'))

  await $.prompt.submit(typed('second'))
  await $.turn.complete(done('t2'))

  const ui = await $.ui.mount({ ...CARD('t2'), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /no extra context/ })).toBeDefined()
  await ui.unmount()
})

test('a prompt typed through Remote Control gets a card too', async ($, on) => {
  const placed: string[] = []
  engine($, on, placed, 't4')

  await $.prompt.submit({ text: 'from my phone', wait: false, origin: { kind: 'bridge' } } as never)

  expect(placed).toEqual(['ctx-t4'])
})

test('a prompt you did not type gets no card', async ($, on) => {
  const placed: string[] = []
  engine($, on, placed, 't2')

  await $.prompt.submit({ text: 'task done', wait: false, origin: { kind: 'task-notification' } } as never)

  expect(placed).toEqual([])
})

test('the card is off when the option is', { options: { promptContext: false } }, async ($, on) => {
  const placed: string[] = []
  engine($, on, placed, 't3')

  await $.prompt.submit(typed('hello'))
  await $.turn.complete(done('t3'))

  expect(placed).toEqual([])
  // the HUD's section still sums it up
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^prompt · text ≈\d+ · no ctx/ })).toBeDefined()
  await pane.unmount()
})
