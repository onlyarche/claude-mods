/** The live context window, as the last response reported it. */
export type HudContext = { tokens?: number; window: number; percent?: number }

/** One rate-limit window: `five_hour`, `seven_day` or a gateway's `spend_limit`. */
export type HudLimit = { kind: string; percentUsed: number; resetsAt?: string }

/** Everything the HUD's top block draws apart from the compaction log. */
export type HudSnapshot = {
  context?: HudContext
  rateLimits: HudLimit[]
  costUsd?: number
  /** Token count at which auto-compaction runs; absent when off or unknown. */
  autoCompactAt?: number
  isAutoCompactEnabled?: boolean
  /** What the main loop's last turn cost, and how long it ran. */
  lastTurnUsd?: number
  lastTurnMs?: number
}

/** One compaction of the main conversation. */
export type HudCompaction = {
  at: number
  trigger: string
  before?: number
  after?: number
}

/** The context window by group, in tokens, as /context estimates it. */
export type HudGroups = {
  system: number
  mcp: number
  memory: number
  other: number
  messages: number
  buffer: number
  free: number
}

export type HudBreakdown = {
  /** False until a breakdown has been read. */
  isMeasured: boolean
  groups: HudGroups
  /** MCP servers whose tools are in the context, and skills listed. */
  mcpServers: number
  skills: number
  // What a click on a context mix row or the tools' `loaded` line opens:
  /** The engine's own rows (/context's), each with the group it folds into. */
  rows?: { name: string; tokens: number; group: keyof HudGroups }[]
  /** Each MCP server: its tools, how many are loaded, their tokens; most first. */
  servers?: { name: string; tools: number; loaded: number; tokens: number }[]
  memoryFiles?: { path: string; tokens: number }[]
  /** Custom agent types the Agent tool describes, most tokens first. */
  agentTypes?: { name: string; tokens: number }[]
  /** The skills listed, most tokens first (the first 40), and their totals. */
  skillList?: { name: string; plugin?: string; tokens: number }[]
  skillsTotal?: number
  skillTokens?: number
  commands?: { listed: number; total: number; tokens: number }
  /** The window the breakdown measures against, and where auto-compact runs. */
  window?: number
  compactAt?: number
}

/** How often a server, skill, command, agent type or plugin was used. */
export type HudTally = {
  kind: 'mcp' | 'skill' | 'command' | 'agent' | 'plugin'
  name: string
  plugin?: string
  calls: number
}

/** An MCP call still running. */
export type HudRunning = { id: string; detail: string }

/** Which session this is: its id (what --resume takes) and its name. */
export type HudSession = { id?: string; name?: string }

/** Something this session holds open, and whether it outlives the session. */
export type HudLink = {
  id: string
  kind: 'shell' | 'monitor' | 'cron' | 'loop' | 'artifact' | 'worktree'
  label: string
  detail?: string
  url?: string
  /** True when ending the session leaves it standing. */
  survives: boolean
  /** When a timed one ends by itself (epoch ms). */
  until?: number
}

/** A subagent or teammate of this session, alive now. */
export type HudAgent = { id: string; type: string; description: string; status: string }

/** Which build of the HUD runs: its version, and the copy it was loaded from. */
export type HudBuild = {
  version?: string
  /** `local` (a folder, ~/.claude/mods), `claude.ai` (synced from an upload), `installed` (a copy) */
  source?: string
}

/** One block sent to the model with a prompt, besides the typed text. */
export type HudCtxItem = {
  kind: 'file' | 'memory' | 'hook' | 'plugin' | 'notice' | 'media' | 'base'
  label: string
  /** Estimated tokens; absent for media, whose cost the text does not show. */
  tokens?: number
  /** Its kind as the engine names it (`skill_listing`, `claudeMd`). */
  type?: string
  /** Who sent it: the engine, a settings hook, a plugin, a paste. */
  from?: string
  /** Its whole length, in characters. */
  chars?: number
  /** Its text's head, shown when the item is picked. */
  preview?: string
}

/** The prompt item whose details are open in the HUD, if any. */
export type HudPick = { card?: string; index?: number }

/** A prompt you typed, and what went to the model with it. */
export type HudPromptCard = {
  /** The turn it started; the transcript row it is drawn in is `ctx-<id>`. */
  id: string
  typedChars: number
  typedTokens: number
  items: HudCtxItem[]
  /** True while its first request is still gathering what it carries. */
  isOpen: boolean
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-hud': {
      snapshot: Shaped<HudSnapshot>
      compactions: Shaped<HudCompaction[]>
      isCompacting: boolean
      /** The top block is 1/denominator of the screen across and down. */
      denominator: number
      /** Clock tick, so "12m ago" and "resets in 2h" stay current. */
      now: number
      /** Secrets masked out of this session's rows. */
      masked: number
      breakdown: Shaped<HudBreakdown>
      /** This session's uses, and every session's (kept in $.store). */
      tallies: Shaped<HudTally[]>
      allTime: Shaped<HudTally[]>
      running: Shaped<HudRunning[]>
      session: Shaped<HudSession>
      links: Shaped<HudLink[]>
      agents: Shaped<HudAgent[]>
      /** The last prompts typed, with what each sent along. */
      prompts: Shaped<HudPromptCard[]>
      build: Shaped<HudBuild>
      picked: Shaped<HudPick>
      /** The HUD's folded sections: `prompt`, `mix`, `tools`. */
      folded: string[]
      /** The context mix or tools row whose details are open (`mix:mcp`), or ''. */
      opened: string
      /** How many colors the terminal draws: `truecolor`, `256` or `16`. */
      depth: string
    }
  }
}
