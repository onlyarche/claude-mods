/**
 * What went to the model with a prompt you typed: your text, and every
 * block the engine, a settings hook or a plugin sent alongside it.
 */
import type { HudCtxItem, HudPromptCard } from '../types'
import { cells, fit, padCells, sectionRule, tokens, wrapCells } from './draw'
import type { Line } from './draw'
import { THEME } from './palette'

const { ink } = THEME

/** How much of an item's text is kept for its details. */
const PREVIEW_CHARS = 1500
/** How many lines of that text the details show. */
const PREVIEW_LINES = 12

/**
 * A rough token count, to show scale only: about 4 characters a token for
 * Latin text and code, about 1.3 for Korean and other wide scripts.
 */
export function estimateTokens(text: string): number {
  let ascii = 0
  let wide = 0
  for (const ch of text) {
    if ((ch.codePointAt(0) ?? 0) < 0x80) ascii++
    else wide++
  }
  return Math.ceil(ascii / 4 + wide / 1.3)
}

const base = (path: string) => path.split('/').filter(Boolean).pop() ?? path

/** The last two parts of a path: enough to tell `api/CLAUDE.md` apart. */
const shortPath = (path: string) => path.split('/').filter(Boolean).slice(-2).join('/')

const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** What an item's details hold: its kind as the engine names it, who sent it, its text. */
const detail = (type: string, from: string, text: string) => ({
  type,
  from,
  chars: [...text].length,
  preview: text.slice(0, PREVIEW_CHARS),
})

type Origin = { kind: 'engine' } | { kind: 'hook'; event: string } | { kind: 'plugin'; event: string }

/** One injected attachment, as the request carries it. */
export function attachmentItem(
  type: string,
  text: string,
  origin: Origin,
  mentioned: readonly string[],
): HudCtxItem {
  const size = estimateTokens(text)
  if (origin.kind === 'hook') {
    return { kind: 'hook', label: origin.event, tokens: size, ...detail(type, `settings hook · ${origin.event}`, text) }
  }
  if (origin.kind === 'plugin') {
    return { kind: 'plugin', label: origin.event, tokens: size, ...detail(type, `plugin · ${origin.event}`, text) }
  }
  const fromEngine = detail(type, 'engine', text)

  if (type === 'file' || type === 'edited_text_file' || type === 'pdf_reference' || type === 'directory') {
    const named =
      mentioned.find(path => text.includes(path)) ??
      /"file_path"\s*:\s*"([^"]+)"/.exec(text)?.[1] ??
      /(?:^|\s)(\/[^\s"']+)/.exec(text)?.[1]
    return { kind: 'file', label: named !== undefined ? shortPath(named) : type, tokens: size, ...fromEngine }
  }
  if (type === 'nested_memory' || type === 'instructions' || type.includes('memory')) {
    const path = /Contents of (\S+)/.exec(text)?.[1]
    return { kind: 'memory', label: path !== undefined ? shortPath(path) : type, tokens: size, ...fromEngine }
  }
  return { kind: 'notice', label: type.replace(/_/g, ' '), tokens: size, ...fromEngine }
}

/** The blocks the conversation's first message carries (CLAUDE.md, the date). */
export function contextItems(
  blocks: readonly { name: string; text: string }[],
  files: readonly { path: string }[] | undefined,
): HudCtxItem[] {
  const NAMES: Record<string, string> = {
    claudeMd: 'CLAUDE.md',
    currentDate: 'date',
    userEmail: 'email',
    attachedProject: 'project',
  }
  return blocks
    .filter(block => block.text.trim() !== '')
    .map(block => {
      const name = NAMES[block.name] ?? block.name
      const hasFiles = block.name === 'claudeMd' && files !== undefined && files.length > 0
      const label = hasFiles
        ? `${name} · ${files.length === 1 ? shortPath(files[0]?.path ?? '') : `${files.length} files`}`
        : name
      // CLAUDE.md's details open with the files it is made of
      const text = hasFiles ? `${files.map(f => f.path).join('\n')}\n\n${block.text}` : block.text
      return {
        kind: 'base',
        label,
        tokens: estimateTokens(block.text),
        ...detail(block.name, 'engine · first message', text),
      }
    })
}

/** An image, audio clip or document pasted into the prompt. */
export const mediaItem = (m: { type: string; filename?: string; mediaType?: string }): HudCtxItem => ({
  kind: 'media',
  label: m.filename !== undefined ? base(m.filename) : (m.mediaType ?? m.type),
  type: m.type,
  from: 'pasted',
  preview: [m.mediaType, m.filename].filter(Boolean).join('\n'),
})

const KIND: Record<HudCtxItem['kind'], string> = {
  file: '@파일',
  memory: 'memory',
  hook: 'hook',
  plugin: 'plugin',
  notice: '알림',
  media: '첨부',
  base: '기본',
}

const sum = (items: readonly HudCtxItem[]) => items.reduce((n, item) => n + (item.tokens ?? 0), 0)

/** `입력 ≈40 tok · context 5개 ≈3.4k`: the card's headline figures. */
function figures(card: HudPromptCard): string {
  const ctx = card.items.length === 0
    ? card.isOpen ? 'context 수집 중…' : '추가 context 없음'
    : `context ${card.items.length}개 ≈${tokens(sum(card.items))}`
  return `입력 ≈${tokens(card.typedTokens)} tok · ${ctx}`
}

/** The card drawn under a prompt in the transcript. */
export function cardLines(card: HudPromptCard, width: number, most = 8): Line[] {
  const out: Line[] = [
    fit([
      { text: '  ↳ ', color: THEME.status.ok, bold: true },
      { text: '함께 보냄 · ', color: ink.label },
      { text: figures(card), color: ink.muted },
    ], width),
  ]
  const shown = card.items.slice(0, most)
  const labelRoom = Math.max(8, width - 4 - 8 - 7)
  for (const item of shown) {
    const label = cells(item.label) > labelRoom ? fit([{ text: item.label }], labelRoom)[0]?.text ?? '' : item.label
    out.push([
      { text: '    ' },
      { text: padCells(KIND[item.kind], 8), color: ink.label },
      { text: padCells(label, labelRoom), color: ink.text },
      { text: item.tokens !== undefined ? `≈${tokens(item.tokens)}`.padStart(7) : ''.padStart(7), color: ink.muted },
    ])
  }
  if (card.items.length > shown.length) {
    out.push([{ text: `    +${card.items.length - shown.length}개 더 · 전체와 세부 내용은 오른쪽 HUD의 prompt 구역에서`, color: ink.muted }])
  }
  return out
}

/** What a picked item's details show, under its row. */
function detailLines(item: HudCtxItem, width: number): Line[] {
  const bar: Line[number] = { text: '  ┊ ', color: ink.muted }
  // details are there to be read whole: a long value wraps, never cut
  const field = (name: string, value: string): Line[] =>
    wrapCells(value, Math.max(6, width - 9)).map((part, i) => [
      bar,
      { text: i === 0 ? name.padEnd(5) : '     ', color: ink.label },
      { text: part, color: ink.text },
    ])
  const out: Line[] = []
  if (item.type !== undefined) out.push(...field('type', item.type))
  if (item.from !== undefined) out.push(...field('from', item.from))
  if (item.chars !== undefined) {
    const size = `${grouped(item.chars)}자${item.tokens !== undefined ? ` ≈${tokens(item.tokens)} tok` : ''}`
    out.push(...field('size', size))
  }
  if (item.preview !== undefined && item.preview !== '') {
    const lines = wrapCells(item.preview, Math.max(8, width - 4))
    for (const line of lines.slice(0, PREVIEW_LINES)) {
      out.push(fit([bar, { text: line, color: ink.muted }], width))
    }
    const shownChars = lines.slice(0, PREVIEW_LINES).join('').length
    const rest = (item.chars ?? item.preview.length) - shownChars
    if (rest > 0) out.push(fit([bar, { text: `… ${grouped(rest)}자 더`, color: ink.muted }], width))
  }
  return out
}

/**
 * The HUD's prompt section: the last prompt's figures as its title, then
 * every item it sent along, each a button whose details open under it.
 */
export function promptSection(
  card: HudPromptCard | undefined,
  picked: number | undefined,
  isFolded: boolean,
  width: number,
): Line[] {
  if (card === undefined) return []
  const ctx = card.items.length === 0
    ? card.isOpen ? '수집 중' : 'no ctx'
    : `ctx ${card.items.length} ≈${tokens(sum(card.items))}`
  const out: Line[] = [sectionRule('prompt', `prompt · 입력 ≈${tokens(card.typedTokens)} · ${ctx}`, isFolded, width)]
  if (isFolded) return out

  const labelRoom = Math.max(6, width - 2 - 7 - 6)
  card.items.forEach((item, index) => {
    const isPicked = picked === index
    const label = cells(item.label) > labelRoom ? fit([{ text: item.label }], labelRoom)[0]?.text ?? '' : item.label
    out.push([
      { text: isPicked ? '▾ ' : '· ', color: isPicked ? THEME.status.ok : ink.muted, bold: isPicked, action: { select: { card: card.id, index } } },
      { text: padCells(KIND[item.kind], 7), color: ink.label },
      { text: padCells(label, labelRoom), color: ink.text, bold: isPicked },
      { text: item.tokens !== undefined ? `≈${tokens(item.tokens)}`.padStart(6) : ''.padStart(6), color: ink.muted },
    ])
    if (isPicked) out.push(...detailLines(item, width))
  })
  return out
}
