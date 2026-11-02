# claude-mods

Mods for [Claude Code](https://claude.com/claude-code): plugins whose function hooks change Claude Code's own interface.

## usage-hud

A small HUD docked in the top-right corner of a fullscreen Claude Code session:

- **The session**: its name, and its id as a button that copies `claude --resume <id>`.
- **Context**: fill gauge with the auto-compaction point marked, tokens until it, and a stacked bar of what fills the window (system, MCP tools, memory, messages, compact buffer, free).
- **Usage**: 5-hour and 7-day rate-limit windows, session cost and the last turn's share, compactions (before → after).
- **Tools**: MCP servers, skills, slash commands, subagents and plugins, most used this session and across sessions, and MCP calls running now.
- **On exit**: what ending the session stops (running subagents, background shells and monitors, session cron jobs, the `/loop` wakeup) and what stays (published artifacts, durable cron jobs, a worktree it will ask about).

Under each prompt you type, a card lists what went to the model with it: `@` files, CLAUDE.md and the other first-message blocks, nested memory, settings-hook and plugin context, engine reminders and pasted images, each with an estimated token count. The HUD's prompt section lists every item of the last one; click an item to open its details (its type, who sent it, its size and the head of its text). Click a section's title (prompt, context mix, tools) to fold it; folded sections stay folded. When the HUD is taller than the dock, click it and scroll.

It also adds instructions to every compaction's summary (what to keep so work resumes without redoing anything: the goal and next step, your instructions verbatim, files changed, decisions, errors and fixes, outside changes, open promises; an empty option uses these, `off` turns them off), toasts each turn's cost and duration, and masks known key and token formats out of every row before the session keeps it. Each of these is an option in `/config`.

`/usage-hud` opens it; `/usage-hud 6` sizes its top block to 1/6 of the screen (2–16, default 8); `/usage-hud close` closes it. It opens by itself in a fullscreen terminal at least 144 columns wide.

The colors are built on `#6266b7` and validated for a dark terminal background (`usage-hud/hooks/palette.ts`).

## Install

At the prompt of a terminal session:

```
/plugin install usage-hud --marketplace onlyarche/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user installs it for every session).

From a shell:

```
claude plugin install usage-hud --marketplace onlyarche/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `onlyarche/claude-mods`, then Add plugin.

### On a machine you edit from

Clone the repository and add it as a folder marketplace: Claude Code then reads the mods straight from the clone, so an edit or a `git pull` takes effect after `/reload-plugins`.

```
git clone https://github.com/onlyarche/claude-mods.git ~/.claude/mods
claude plugin marketplace add ~/.claude/mods
claude plugin install usage-hud@personal-mods
```

## Develop

```
claude plugin validate ~/.claude/mods/usage-hud
claude plugin test ~/.claude/mods/usage-hud
```

## License

[MIT](LICENSE): free to use, copy, modify and redistribute, keeping the copyright notice.
