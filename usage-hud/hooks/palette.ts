/**
 * The HUD's theme, built on the brand color #6266b7 (OKLCH 0.545 0.125 279).
 *
 * Computed, not eyeballed: the series slots came out of a search over OKLCH
 * steps near the brand hue, kept only where the dataviz validator passes on
 * a dark surface (#1a1a19): lightness band, chroma floor, colorblind (protan/
 * deutan) separation between neighbors >= 13.4 dE, every pair >= 12 dE to
 * normal vision, 3:1 against the surface, and >= 8 dE from each status step,
 * so a series never reads as a status. The inks are the brand hue at low
 * chroma, text ones >= 4.5:1. Raw hex does not follow a light theme.
 */
export const THEME = {
  /**
   * Gauges: how worrying a fill is, always beside its % and a ! glyph.
   * One hue family (279°-291°, a 12° spread), stepping brighter and paler
   * as it worsens, the way intensity reads on a dark surface: it passes the
   * validator's ordinal checks (monotone L, steps >= 0.06 apart), each step
   * >= 15 dE from the next, and >= 8 dE from every series slot.
   */
  status: {
    ok: '#6266b7', // the brand itself     L 0.55
    warn: '#9e93d8', // brand, lifted       L 0.70
    high: '#cdc5ff', // brand, near-white  L 0.85
  },
  /** The context mix bar, in its fixed left-to-right order: never cycled. */
  series: {
    system: '#1d73a5',
    mcp: '#8082f7',
    memory: '#955080',
    other: '#3a9ec8',
    messages: '#6f4bd4',
  },
  ink: {
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
  },
} as const
