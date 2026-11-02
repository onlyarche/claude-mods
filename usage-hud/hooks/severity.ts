import { THEME } from './palette'

export type Level = 'ok' | 'warn' | 'high'

/**
 * How worrying a gauge is.
 *
 * @param used  how full the gauge is, 0..1 (context tokens / window, or a
 *              rate-limit window's percentUsed / 100)
 * @param limit where trouble starts, 0..1, when the gauge has one: for the
 *              context gauge, the auto-compaction point (threshold / window);
 *              undefined for rate limits, or when auto-compact is off
 */
export function level(used: number, limit?: number): Level {
  // Context: how far along the road to auto-compaction (1 = compaction due).
  // Rate limits, which have no such point: the share of the window used.
  const progress = limit !== undefined && limit > 0 ? used / limit : used
  if (progress >= 0.9) return 'high'
  if (progress >= 0.7) return 'warn'
  return 'ok'
}

/** The color of a gauge's filled part. */
export const severity = (used: number, limit?: number): string =>
  THEME.status[level(used, limit)]

/** Status is never color alone: a glyph beside the % says it too. */
export const GLYPH: Record<Level, string> = { ok: '', warn: '!', high: '!!' }
