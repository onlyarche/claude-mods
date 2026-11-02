import { expect, mock, test } from 'claude-code/testing'

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
  // 1/8 of 48 rows: the HUD draws its top 6 lines.
  viewport: { columns: 240, rows: 48, isFullscreen: true },
} as const

const MEASURE = {
  context: { tokens: 124_000, window: 200_000, percent: 62 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 23 }],
  cost: { usd: 1.24 },
  changed: ['context', 'rateLimits', 'cost'],
} as const

const TRANSCRIPT = [{ role: 'user', text: 'summary', toolUses: [] }] as const

/** The manifest's default instructions, as one test reads them for another. */
let manifestKeep: string | undefined

const category = (name: string, tokens: number, kind = 'used') =>
  ({ name, tokens, kind, color: 'text', isDeferred: kind === 'deferred' })

const usageAnswer = (usd: number) => ({
  value: {
    startedAt: 0,
    context: {
      window: 200_000,
      breakdown: {
        isAutoCompactEnabled: true,
        autoCompactThreshold: 160_000,
        categories: [
          category('System prompt', 3_000),
          category('System tools', 14_000),
          category('MCP tools', 10_000),
          category('MCP tools (deferred)', 50_000, 'deferred'),
          category('Memory files', 3_000),
          category('Skills', 2_000),
          category('Messages', 92_000),
          category('Free space', 43_000, 'free'),
          category('Autocompact buffer', 33_000, 'buffer'),
        ],
        mcpTools: [
          { name: 'a', serverName: 'gmail', tokens: 1, isLoaded: true },
          { name: 'b', serverName: 'gmail', tokens: 1, isLoaded: true },
          { name: 'c', serverName: 'figma', tokens: 1, isLoaded: true },
        ],
        skills: { totalSkills: 60, includedSkills: 52, tokens: 2_000, skillFrontmatter: [] },
      },
    },
    rateLimits: [],
    cost: { usd },
  } as never,
})

const promptRow = (text: string) =>
  ({
    message: { type: 'user', role: 'user', content: [{ type: 'text', text }] },
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid: 'u1',
  }) as never

test('context, auto-compact point, limits and cost, on every surface', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.usage', () => usageAnswer(1.24))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  await $.session.measure(MEASURE as never)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /62%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /⟳ in 36k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /23%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$1\.24/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a compaction is logged with its before and after', async ($, on) => {
  on('session.compact', () => ({
    messages: TRANSCRIPT,
    tokensBefore: 180_000,
    tokensAfter: 32_000,
  }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))

  await $.session.compact({ trigger: 'auto', messages: TRANSCRIPT })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /⇣1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /180k→32k/ })).toBeDefined()
  await ui.unmount()
})

test('a skipped compaction is not logged', async ($, on) => {
  on('session.compact', () => ({ skip: 'blocked by a hook' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  await $.session.compact({ trigger: 'auto', messages: TRANSCRIPT })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /⇣/ })).toBeUndefined()
  await ui.unmount()
})

test('compaction is told what to keep, after what /compact was told', async ($, on) => {
  const told: Array<string | undefined> = []
  on('session.compact', (_, e) => {
    told.push(e.instructions)
    return { messages: TRANSCRIPT }
  })
  on('clock.now', () => ({ value: 1_700_000_000_000 }))

  await $.session.compact({
    trigger: 'manual',
    messages: TRANSCRIPT,
    instructions: 'focus on the API',
  })
  await $.session.compact({ trigger: 'precompute', messages: TRANSCRIPT })

  expect(told[0]).toMatch(/^focus on the API\n\nWrite the summary so the work can resume/)
  expect(told[1]).toMatch(/^Write the summary so the work can resume/)
  manifestKeep = told[1]
})

test('a secret is masked before the row is kept', async ($, on) => {
  const session = mock.session(on)
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const key = `ghp_${'A'.repeat(36)}`

  await $.session.append(promptRow(`use ${key} and postgres://app:hunter22@db:5432/x`))

  const kept = JSON.stringify(session.appended().at(-1)?.message.content)
  expect(kept).toContain('[REDACTED:GitHub token]')
  expect(kept).toContain('postgres://app:[REDACTED:URL password]@db:5432/x')
  expect(kept.includes(key) || kept.includes('hunter22')).toBe(false)
  expect(toasts).toEqual(['masked 2 secrets: GitHub token, URL password'])
})

test('masking off keeps the row as made', { options: { maskSecrets: false } }, async ($, on) => {
  const session = mock.session(on)
  const key = `ghp_${'A'.repeat(36)}`

  await $.session.append(promptRow(`use ${key}`))

  expect(JSON.stringify(session.appended().at(-1)?.message.content)).toContain(key)
})

test('a turn toasts what it cost, how long it took, what it wrote', async ($, on) => {
  let cost = 1.0
  on('session.usage', () => usageAnswer(cost))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))

  await $.turn.start({ text: 'hi', turnId: 't1' })
  cost = 1.042
  await $.turn.complete({
    answer: 'done',
    durationMs: 38_000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: {
      input_tokens: 10,
      output_tokens: 1200,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      model: 'm',
    },
  } as never)

  expect(toasts).toEqual(['turn $0.042 · 38s · 1.2k out'])
})

test('the dock below the top block holds the context mix', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.usage', () => usageAnswer(1.24))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  await $.session.measure(MEASURE as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /context mix/ })).toBeDefined()
    // 92k of the 200k counted (deferred tools left out) is 46%
    expect(await ui.find({ type: 'Text', text: /messages/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ +46%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /compact buffer/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /loaded 2 mcp · 52 skills/ })).toBeDefined()
    await ui.unmount()
  }
})

test('MCP calls and skills are counted per server, skill and plugin', async ($, on) => {
  mock.store(on, { tallies: [{ kind: 'mcp', name: 'notion', calls: 40 }] })
  on('tool.call', () => ({ result: {} }))
  on('skill.prompt', (_, e) => ({ text: e.text, frontmatter: e.frontmatter }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'usage-hud' } }))
  on('session.usage', () => usageAnswer(0))
  mock.clock(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  await $.tool.call({ tool: 'mcp__plugin_small-business_gmail__search_threads' } as never)
  await $.tool.call({ tool: 'mcp__plugin_small-business_gmail__get_thread' } as never)
  await $.tool.call({ tool: 'mcp__claude_ai_Google_Drive__search_files' } as never)
  await $.skill.prompt({
    skill: 'dataviz',
    text: 'x',
    frontmatter: {},
    source: 'plugin',
    pluginName: 'viz',
  } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts = async (pattern: RegExp) =>
    (await ui.findAll({ type: 'Text', text: pattern })).map(t => t.text)
  // session: gmail 2 (· Google Drive 1 needs 31 cells of 30, so it is left
  // off whole, never cut mid-name); all time: notion 40 · gmail 2
  expect(await texts(/^( · )?(gmail|Google Drive|notion)$/)).toEqual([
    'gmail', 'notion', ' · gmail',
  ])
  expect(await texts(/^dataviz$/)).toHaveLength(2) // session and all time
  expect(await texts(/^(small-business| · viz)$/)).toContain('small-business')
  await ui.unmount()
})

const toldWith = async ($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1]) => {
  const told: Array<string | undefined> = []
  on('session.compact', (_, e) => {
    told.push(e.instructions)
    return { messages: TRANSCRIPT }
  })
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  await $.session.compact({ trigger: 'manual', messages: TRANSCRIPT })
  return told[0]
}

test('an empty instructions option still keeps the essentials', { options: { compactInstructions: '' } }, async ($, on) => {
  // an install screen that shows no default can store an empty value: the
  // code's fallback then stands in, and it must be the manifest's default word
  // for word (the test above read that one with the option left unset)
  const told = await toldWith($, on)
  expect(told).toMatch(/^Write the summary so the work can resume/)
  expect(told).toBe(manifestKeep)
})

test('off drops the instructions', { options: { compactInstructions: 'off' } }, async ($, on) => {
  expect(await toldWith($, on)).toBeUndefined()
})

test('your own instructions replace the built-in ones', { options: { compactInstructions: 'Keep the API decisions.' } }, async ($, on) => {
  expect(await toldWith($, on)).toBe('Keep the API decisions.')
})
