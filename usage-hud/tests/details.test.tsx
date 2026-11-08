import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'usage-hud',
  component: 'Pane',
  requestId: 'usage-hud',
  props: {
    title: 'Usage', isFocused: false, bodyColumns: 44, placement: 'dock',
    scroll: { offset: 0, bodyRows: 80 }, view: {},
  },
  viewport: { columns: 352, rows: 80, isFullscreen: true },
} as const

const category = (name: string, tokens: number, kind = 'used') =>
  ({ name, tokens, kind, color: 'text', isDeferred: kind === 'deferred' })

const BREAKDOWN = {
  isAutoCompactEnabled: true,
  autoCompactThreshold: 160_000,
  rawMaxTokens: 200_000,
  categories: [
    category('System prompt', 3_000),
    category('System tools', 14_000),
    category('MCP tools', 10_000),
    category('Memory files', 3_000),
    category('Custom agents', 1_500),
    category('Skills', 2_000),
    category('Messages', 92_000),
    category('Free space', 43_000, 'free'),
    category('Autocompact buffer', 33_000, 'buffer'),
  ],
  mcpTools: [
    { name: 'search_threads', serverName: 'gmail', tokens: 600, isLoaded: true },
    { name: 'get_thread', serverName: 'gmail', tokens: 400, isLoaded: true },
    { name: 'get_design', serverName: 'figma', tokens: 900, isLoaded: false },
  ],
  memoryFiles: [{ path: '/repo/api/CLAUDE.md', type: 'Project', tokens: 3_000 }],
  agents: [{ agentType: 'code-explorer', source: 'plugin', tokens: 900 }],
  skills: {
    totalSkills: 60, includedSkills: 52, tokens: 2_000,
    skillFrontmatter: [{ name: 'dataviz', source: 'bundled', tokens: 300 }, { name: 'review', source: 'plugin', pluginName: 'pr', tokens: 120 }],
  },
  slashCommands: { totalCommands: 40, includedCommands: 38, tokens: 700 },
}

function engine(on: On, copied: string[] = []) {
  mock.clock(on)
  mock.store(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, breakdown: BREAKDOWN }, rateLimits: [] } as never }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {} }))
  on('agent.spawn', () => ({ model: 'm' }))
  on('agent.list', () => ({ value: [{ id: 'a7', type: 'Explore', description: 'find usages', status: 'running' }] as never }))
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))
}

const MEASURE = {
  context: { tokens: 124_000, window: 200_000, percent: 62 },
  rateLimits: [],
  changed: ['context'],
} as never

test('a context mix row opens what is behind it, one at a time', async ($, on) => {
  const copied: string[] = []
  engine(on, copied)
  await $.session.measure(MEASURE)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text.trim())

  // MCP tools: each server, its loaded tools of all, their tokens
  await ui.press({ key: 'open-mix:mcp' })
  expect(await texts()).toContain('gmail 2/2')
  expect(await texts()).toContain('figma 0/1')
  // a server's row copies its name
  const gmail = await ui.find({ type: 'Button', text: /gmail 2\/2/ })
  await ui.press({ key: String(gmail?.key) })
  expect(copied).toEqual(['gmail'])

  // another row closes the first
  await ui.press({ key: 'open-mix:system' })
  expect(await texts()).toContain('System tools')
  expect(await texts()).not.toContain('gmail 2/2')

  // memory: the file, copied by its whole path
  await ui.press({ key: 'open-mix:memory' })
  const file = await ui.find({ type: 'Button', text: /api\/CLAUDE\.md/ })
  await ui.press({ key: String(file?.key) })
  expect(copied.at(-1)).toBe('/repo/api/CLAUDE.md')

  // agents·skills: the engine's rows, agent types and skills by tokens
  await ui.press({ key: 'open-mix:other' })
  for (const want of ['Custom agents', 'code-explorer', 'dataviz', 'pr:review']) expect(await texts()).toContain(want)

  // free: what is left before compaction: 160k less 125.5k in use
  // (system 17k, MCP 10k, memory 3k, agents·skills 3.5k, messages 92k)
  await ui.press({ key: 'open-mix:free' })
  expect(await texts()).toContain('until compaction')
  expect(await texts()).toContain('35k')

  // a second click closes it
  await ui.press({ key: 'open-mix:free' })
  expect(await texts()).not.toContain('until compaction')
  await ui.unmount()
})

test('a tools row opens every one of its kind; loaded opens what the context lists', async ($, on) => {
  const copied: string[] = []
  engine(on, copied)
  await $.session.measure(MEASURE)
  for (const tool of ['gmail__search_threads', 'gmail__get_thread', 'figma__get_design', 'slack__post', 'notion__search', 'linear__issue']) {
    await $.tool.call({ tool: `mcp__plugin_sb_${tool}` } as never)
  }
  await $.agent.spawn({
    tool_use_id: 't1', prompt: 'p', description: 'd', subagentType: 'feature-dev:code-explorer',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'm', background: false, fork: false,
  } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text.trim())

  // mcp: all six servers, not just the ones that fit on the row
  await ui.press({ key: 'open-tools:mcp' })
  for (const want of ['gmail · sb', 'figma · sb', 'slack · sb', 'notion · sb', 'linear · sb']) expect(await texts()).toContain(want)

  // agent: the one running now, copied by its id, then the types used
  await ui.press({ key: 'open-tools:agent' })
  expect(await texts()).toContain('Explore: find usages')
  const running = await ui.find({ type: 'Button', text: /Explore: find usages/ })
  await ui.press({ key: String(running?.key) })
  expect(copied).toEqual(['a7'])
  expect(await texts()).toContain('code-explorer · feature-dev')

  // plugin: each plugin, then what of it was used
  await ui.press({ key: 'open-tools:plugin' })
  expect(await texts()).toContain('sb')
  expect(await texts()).toContain('mcp gmail')

  // loaded: the servers and the skills the context lists
  await ui.press({ key: 'open-tools:loaded' })
  expect(await texts()).toContain('gmail 2/2')
  const skill = await ui.find({ type: 'Button', text: /pr:review/ })
  await ui.press({ key: String(skill?.key) })
  expect(copied.at(-1)).toBe('/pr:review')
  await ui.unmount()
})
