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

test('the default palette, and the HUD on the terminal\'s own background', async ($, on) => {
  const opens: Array<{ backgroundColor?: string }> = []
  engine(on, opens)

  const said = await run($, 'colors')
  expect(said).toContain('theme #6266b7 (the validated default palette)')
  expect(said).toContain('background: surface transparent')
  expect(said).toContain('gauges: ok #6266b7 · warn #9e93d8 · high #cdc5ff')

  await run($, '')
  expect(opens.at(-1)?.backgroundColor).toBe('transparent')
})

test('the default written another way is still the validated palette', { options: { themeColor: '6266B7' } }, async ($, on) => {
  engine(on, [])
  expect(await run($, 'colors')).toContain('(the validated default palette)')
})

test('another theme color moves every color with it', { options: { themeColor: '#2e8b57', colorOverrides: 'surface=theme' } }, async ($, on) => {
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

test('overrides set single colors, and surface=terminal is the terminal\'s background', {
  options: { colorOverrides: 'warn=#ff8800, messages = #123, surface=terminal' },
}, async ($, on) => {
  const opens: Array<{ backgroundColor?: string }> = []
  engine(on, opens)

  const said = await run($, 'colors')
  expect(said).toContain('warn #ff8800')
  expect(said).toContain('messages #112233')
  expect(said).toContain('surface transparent')
  // the rest stay as they were
  expect(said).toContain('ok #6266b7')

  await run($, '')
  expect(opens.at(-1)?.backgroundColor).toBe('transparent')
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

const lightness = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

test('surface takes the terminal\'s own color, or a shade of it', { options: { colorOverrides: 'surface=#1e1e2e' } }, async ($, on) => {
  const opens: Array<{ backgroundColor?: string }> = []
  engine(on, opens)
  await run($, '')
  expect(opens.at(-1)?.backgroundColor).toBe('#1e1e2e')
})

test('surface=#rrggbb+N is that color a little lighter', { options: { colorOverrides: 'surface=#1e1e2e+5' } }, async ($, on) => {
  const opens: Array<{ backgroundColor?: string }> = []
  engine(on, opens)
  await run($, '')
  const shade = opens.at(-1)?.backgroundColor ?? ''
  expect(shade).toMatch(/^#[0-9a-f]{6}$/)
  expect(lightness(shade)).toBeGreaterThan(lightness('#1e1e2e'))
})

test('surface=#rrggbb-N is that color a little darker', { options: { colorOverrides: 'surface=#1e1e2e-5%' } }, async ($, on) => {
  const opens: Array<{ backgroundColor?: string }> = []
  engine(on, opens)
  await run($, '')
  expect(lightness(opens.at(-1)?.backgroundColor ?? '#ffffff')).toBeLessThan(lightness('#1e1e2e'))
})

test('a surface it cannot read is named, and the background stays transparent', { options: { colorOverrides: 'surface=blue' } }, async ($, on) => {
  const opens: Array<{ backgroundColor?: string }> = []
  engine(on, opens)
  expect(await run($, 'colors')).toContain('"blue" for surface is not transparent, theme, #rrggbb or #rrggbb+N')
  await run($, '')
  expect(opens.at(-1)?.backgroundColor).toBe('transparent')
})
