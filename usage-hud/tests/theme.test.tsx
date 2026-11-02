import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PRESENTATION = { isFullscreen: true, columns: 200 }

/** The engine beneath a /usage-hud run: it answers the pane's open, and records it. */
function engine(on: On, opens: Array<{ backgroundColor?: string }>) {
  on('command.run', () => ({ text: 'beneath' }))
  on('ui.open', (_, e) => {
    opens.push(e as { backgroundColor?: string })
    return { value: { isPlaced: true } }
  })
}

type Raise = { command: { run: (e: never) => Promise<unknown> } }
const run = async ($: Raise, args: string) =>
  String(((await $.command.run({ command: 'usage-hud', args, origin: { kind: 'composer' }, presentation: PRESENTATION } as never)) as { text?: string }).text)

test('the default palette, and the HUD on its own background', async ($, on) => {
  const opens: Array<{ backgroundColor?: string }> = []
  engine(on, opens)

  const said = await run($, 'colors')
  expect(said).toContain('theme #6266b7 (the validated default palette)')
  expect(said).toContain('background: surface #15161c')
  expect(said).toContain('gauges: ok #6266b7 · warn #9e93d8 · high #cdc5ff')

  await run($, '')
  expect(opens.at(-1)?.backgroundColor).toBe('#15161c')
})

test('the default written another way is still the validated palette', { options: { themeColor: '6266B7' } }, async ($, on) => {
  engine(on, [])
  expect(await run($, 'colors')).toContain('(the validated default palette)')
})

test('another theme color moves every color with it', { options: { themeColor: '#2e8b57' } }, async ($, on) => {
  const opens: Array<{ backgroundColor?: string }> = []
  engine(on, opens)

  const said = await run($, 'colors')
  expect(said).toContain('theme #2e8b57 (derived from it, not validated)')
  expect(said).toContain('gauges: ok #2e8b57')
  const surface = /surface (#[0-9a-f]{6})/.exec(said)?.[1]
  expect(surface).toBeDefined()
  expect(surface).not.toBe('#15161c')

  // the pane paints the derived background
  await run($, '')
  expect(opens.at(-1)?.backgroundColor).toBe(surface)
})

test('overrides set single colors, and surface=terminal keeps the terminal\'s background', {
  options: { colorOverrides: 'warn=#ff8800, messages = #123, surface=terminal' },
}, async ($, on) => {
  const opens: Array<{ backgroundColor?: string }> = []
  engine(on, opens)

  const said = await run($, 'colors')
  expect(said).toContain('warn #ff8800')
  expect(said).toContain('messages #112233')
  expect(said).toContain('surface terminal')
  // the rest stay as they were
  expect(said).toContain('ok #6266b7')

  await run($, '')
  expect('backgroundColor' in (opens.at(-1) ?? {})).toBe(false)
})

test('what cannot be read is named, and the rest still applies', {
  options: { themeColor: 'purple', colorOverrides: 'foo=#123456, warn=red, high=#abcdef' },
}, async ($, on) => {
  engine(on, [])

  const said = await run($, 'colors')
  expect(said).toContain('theme #6266b7 (the validated default palette)')
  expect(said).toContain('high #abcdef')
  expect(said).toMatch(/not applied: Theme color "purple" is not #rrggbb.*"foo" is no color name.*"red" for warn is not #rrggbb/)
})
