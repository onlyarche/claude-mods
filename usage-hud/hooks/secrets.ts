/**
 * Known secret formats, masked out of every row before the session keeps it,
 * so the model, later requests and compaction summaries never see them.
 *
 * Formats only, never "anything after `password=`": a guess that masks code
 * would hand the model code with holes in it.
 */
export type SecretRule = { name: string; pattern: RegExp }

const BUILTIN: SecretRule[] = [
  {
    name: 'private key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { name: 'Anthropic key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'OpenAI key', pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g },
  {
    name: 'GitHub token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/g,
  },
  { name: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { name: 'Slack token', pattern: /\bxox[abprs]-[0-9A-Za-z-]{10,}/g },
  { name: 'Stripe key', pattern: /\b[sr]k_live_[0-9A-Za-z]{20,}/g },
  { name: 'Hugging Face token', pattern: /\bhf_[A-Za-z0-9]{30,}/g },
  {
    name: 'JWT',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  // the password of scheme://user:password@host, the rest left readable
  {
    name: 'URL password',
    pattern: /(?<=\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]{3,}(?=@)/gi,
  },
]

// TODO(you): your own organization's formats, the ones no public list knows:
//  an internal service token's prefix, a vault path, a DB DSN of your stack.
//  Each `pattern` needs the `g` flag. Keep them specific: a broad pattern
//  masks ordinary code the model then can't edit.
//  e.g. { name: 'acme token', pattern: /\bacme_[A-Za-z0-9]{32}\b/g },
const ORG: SecretRule[] = []

export const RULES: readonly SecretRule[] = [...BUILTIN, ...ORG]

/** Masks every known secret in `text`, naming each one in `found`. */
export function mask(text: string, found: string[]): string {
  let out = text
  for (const rule of RULES) {
    out = out.replace(rule.pattern, () => {
      found.push(rule.name)
      return `[REDACTED:${rule.name}]`
    })
  }
  return out
}

type Block = { type: string; [field: string]: unknown }

const isTextItem = (item: unknown): item is { type: 'text'; text: string } =>
  typeof item === 'object' &&
  item !== null &&
  (item as { type?: unknown }).type === 'text' &&
  typeof (item as { text?: unknown }).text === 'string'

/**
 * Masks a row's block: a text block's text, a tool_result's content. Every
 * other block (images, tool_use, thinking) is the engine's and stays as is.
 */
export function maskBlock<B extends Block>(block: B, found: string[]): B {
  if (block.type === 'text' && typeof block.text === 'string') {
    return { ...block, text: mask(block.text, found) }
  }
  if (block.type === 'tool_result') {
    const content = block.content
    if (typeof content === 'string') {
      return { ...block, content: mask(content, found) }
    }
    if (Array.isArray(content)) {
      return {
        ...block,
        content: content.map(item =>
          isTextItem(item) ? { ...item, text: mask(item.text, found) } : item,
        ),
      }
    }
  }
  return block
}
