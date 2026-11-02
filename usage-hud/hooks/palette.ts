/**
 * The HUD's theme, built on the brand color #6266b7 (OKLCH 0.545 0.125 279).
 *
 * Computed, not eyeballed: the series slots came out of a search over OKLCH
 * steps near the brand hue, kept only where the dataviz validator passes on
 * a dark surface (#1a1a19): lightness band, chroma floor, colorblind (protan/
 * deutan) separation between neighbors >= 13.4 dE, every pair >= 12 dE to
 * normal vision, 3:1 against the surface, and >= 8 dE from each status step,
 * so a series never reads as a status. The inks are the brand hue at low
 * chroma, text ones >= 4.5:1.
 *
 * The HUD paints its own `surface` rather than the terminal's background, so
 * every machine and terminal theme shows the same colors; the palette passes
 * the same checks on it (series 3:1, status ramp, inks >= 6.7:1).
 *
 * The person may change it (the options Theme color and Color overrides):
 * another theme color moves every color with it, keeping how each sits
 * against the brand; an override sets one color. Only the default is
 * validated: a palette derived from another color is not re-checked.
 */

/** The validated palette, the one every theme is derived from. */
const VALIDATED = {
  /** The HUD's own background: the brand hue, nearly black (OKLCH 0.20 0.012 279). */
  surface: '#15161c',
  /**
   * Gauges: how worrying a fill is, always beside its % and a ! glyph.
   * One hue family (279°-291°, a 12° spread), stepping brighter and paler
   * as it worsens, the way intensity reads on a dark surface: it passes the
   * validator's ordinal checks (monotone L, steps >= 0.06 apart), each step
   * >= 15 dE from the next, and >= 8 dE from every series slot.
   */
  ok: '#6266b7', // the brand itself     L 0.55
  warn: '#9e93d8', // brand, lifted       L 0.70
  high: '#cdc5ff', // brand, near-white  L 0.85
  /** The context mix bar, in its fixed left-to-right order: never cycled. */
  system: '#1d73a5',
  mcp: '#8082f7',
  memory: '#955080',
  other: '#3a9ec8',
  messages: '#6f4bd4',
  /** values and names */
  text: '#cfd3e8',
  /** secondary figures, rules */
  muted: '#989cbb',
  /** row labels: ctx, 5h, mcp */
  label: '#b2b9f1',
  /** the auto-compact mark on the context gauge */
  mark: '#e0e3f9',
  /** the autocompact buffer, drawn ▒ */
  buffer: '#565971',
  /** empty cells, drawn ░ */
  track: '#343748',
} as const

export type ColorName = keyof typeof VALIDATED
export const COLOR_NAMES = Object.keys(VALIDATED) as ColorName[]
export const DEFAULT_BASE = VALIDATED.ok

/**
 * The colors in force, read at draw time. Changed in place by `applyTheme`
 * (a module that took `THEME.ink` keeps the same object); `surface`
 * undefined leaves the HUD on the terminal's own background.
 */
export const THEME = {
  surface: VALIDATED.surface as string | undefined,
  status: { ok: VALIDATED.ok as string, warn: VALIDATED.warn as string, high: VALIDATED.high as string },
  series: {
    system: VALIDATED.system as string,
    mcp: VALIDATED.mcp as string,
    memory: VALIDATED.memory as string,
    other: VALIDATED.other as string,
    messages: VALIDATED.messages as string,
  },
  ink: {
    text: VALIDATED.text as string,
    muted: VALIDATED.muted as string,
    label: VALIDATED.label as string,
    mark: VALIDATED.mark as string,
    buffer: VALIDATED.buffer as string,
    track: VALIDATED.track as string,
  },
}

// ---- OKLCH, to move a palette to another hue ----------------------------

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function toOklch(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map(i => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360]
}

/** OKLCH to hex, chroma lowered step by step until the color fits sRGB. */
function fromOklch(L: number, C: number, H: number): string {
  for (let chroma = C; chroma >= 0; chroma -= 0.005) {
    const a = chroma * Math.cos((H * Math.PI) / 180)
    const b = chroma * Math.sin((H * Math.PI) / 180)
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
    const rgb = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ]
    if (rgb.every(v => v >= -0.0005 && v <= 1.0005)) {
      return `#${rgb.map(v => Math.round(Math.min(1, Math.max(0, fromLinear(v))) * 255).toString(16).padStart(2, '0')).join('')}`
    }
  }
  return '#808080'
}

/** `#abc`, `#aabbcc` or `aabbcc` as `#aabbcc`; anything else undefined. */
export function parseHex(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const raw = value.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${[...raw].map(c => c + c).join('')}`
  return undefined
}

/**
 * Every color moved to another theme color: each keeps its lightness and
 * chroma and its hue's distance from the brand. The gauge ramp starts at the
 * theme color itself and always brightens as it worsens.
 */
function derive(base: string): Record<ColorName, string> {
  const [, , fromHue] = toOklch(DEFAULT_BASE)
  const [baseL, , toHue] = toOklch(base)
  const out = {} as Record<ColorName, string>
  for (const name of COLOR_NAMES) {
    const [L, C, H] = toOklch(VALIDATED[name])
    out[name] = fromOklch(L, C, H - fromHue + toHue)
  }
  out.ok = base
  // a light theme color would put `ok` above `warn`: keep the ramp climbing
  const [warnL, warnC, warnH] = toOklch(out.warn)
  const [highL, highC, highH] = toOklch(out.high)
  const nextWarnL = Math.min(0.93, Math.max(warnL, baseL + 0.08))
  const nextHighL = Math.min(0.97, Math.max(highL, nextWarnL + 0.06))
  if (nextWarnL !== warnL) out.warn = fromOklch(nextWarnL, warnC, warnH)
  if (nextHighL !== highL) out.high = fromOklch(nextHighL, highC, highH)
  return out
}

/** The colors in force, flat, for `/usage-hud colors`. */
export const currentColors = (): Record<ColorName, string | undefined> => ({
  surface: THEME.surface,
  ...THEME.status,
  ...THEME.series,
  ...THEME.ink,
})

/**
 * Sets the colors from the two options, in place, and says what it could
 * not read. An empty or default theme color keeps the validated palette;
 * overrides are `name=#rrggbb` separated by commas, `surface=terminal`
 * leaving the terminal's own background.
 */
export function applyTheme(themeColor: unknown, overrides: unknown): string[] {
  const problems: string[] = []
  const base = parseHex(themeColor)
  if (base === undefined && typeof themeColor === 'string' && themeColor.trim() !== '') {
    problems.push(`Theme color "${themeColor.trim()}" is not #rrggbb: the default stands`)
  }
  const colors: Record<ColorName, string | undefined> =
    base === undefined || base === DEFAULT_BASE ? { ...VALIDATED } : derive(base)

  const entries = typeof overrides === 'string' ? overrides.split(/[,;\n]/) : []
  for (const entry of entries.map(one => one.trim()).filter(one => one !== '')) {
    const match = /^([A-Za-z]+)\s*[=:]\s*(\S+)$/.exec(entry)
    const name = match?.[1]?.toLowerCase()
    const value = match?.[2]
    if (name === undefined || value === undefined) {
      problems.push(`"${entry}" is not name=#rrggbb`)
    } else if (!(COLOR_NAMES as string[]).includes(name)) {
      problems.push(`"${name}" is no color name (${COLOR_NAMES.join(', ')})`)
    } else if (name === 'surface' && value.toLowerCase() === 'terminal') {
      colors.surface = undefined
    } else {
      const hex = parseHex(value)
      if (hex === undefined) problems.push(`"${value}" for ${name} is not #rrggbb`)
      else colors[name as ColorName] = hex
    }
  }

  // in place: modules that took THEME.ink or THEME.series see the change
  const pick = (name: ColorName) => colors[name] ?? VALIDATED[name]
  THEME.surface = colors.surface
  THEME.status.ok = pick('ok')
  THEME.status.warn = pick('warn')
  THEME.status.high = pick('high')
  THEME.series.system = pick('system')
  THEME.series.mcp = pick('mcp')
  THEME.series.memory = pick('memory')
  THEME.series.other = pick('other')
  THEME.series.messages = pick('messages')
  THEME.ink.text = pick('text')
  THEME.ink.muted = pick('muted')
  THEME.ink.label = pick('label')
  THEME.ink.mark = pick('mark')
  THEME.ink.buffer = pick('buffer')
  THEME.ink.track = pick('track')
  return problems
}
