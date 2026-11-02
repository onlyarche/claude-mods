# claude-mods

Mods for [Claude Code](https://claude.com/claude-code): plugins whose function hooks change Claude Code's own interface.

## usage-hud

A small HUD docked in the top-right corner of a fullscreen Claude Code session:

- **The session**: its name, and its id as a button that copies `claude --resume <id>`.
- **Context**: fill gauge with the auto-compaction point marked, tokens until it, and a stacked bar of what fills the window (system, MCP tools, memory, messages, compact buffer, free).
- **Usage**: 5-hour and 7-day rate-limit windows, session cost and the last turn's share, compactions (before → after).
- **Tools**: MCP servers, skills, slash commands, subagents and plugins, most used this session and across sessions, and MCP calls running now.
- **On exit**: what ending the session stops (running subagents, background shells and monitors, session cron jobs, the `/loop` wakeup) and what stays (published artifacts, durable cron jobs, a worktree it will ask about).

Under each prompt you type, a card lists what went to the model with it: `@` files, CLAUDE.md and the other first-message blocks, nested memory, settings-hook and plugin context, engine reminders and pasted images, each with an estimated token count. The HUD's prompt section lists every item of the last one; click an item to open its details (its type, who sent it, its size and the head of its text). Click a section's title (prompt, context mix, tools) to fold it; folded sections stay folded. Click a context mix row for what fills that part (each MCP server's tools and tokens, memory files, agent types and skills by tokens, room left before compaction), and a tools row for every one of its kind (`loaded` lists the servers and skills the context carries). Rows marked ⧉ copy what they name with a click: the session's id and name, a server, a file's whole path, a skill or command as you would type it, an agent's or background task's id, a prompt item's text. When the HUD is taller than the dock, click it and scroll.

It also adds instructions to every compaction's summary (what to keep so work resumes without redoing anything: the goal and next step, your instructions verbatim, files changed, decisions, errors and fixes, outside changes, open promises; an empty option uses these, `off` turns them off), toasts each turn's cost and duration, and masks known key and token formats out of every row before the session keeps it. Each of these is an option in `/config`.

`/usage-hud` opens it; `/usage-hud 6` sizes its top block to 1/6 of the screen (2–16, default 8); `/usage-hud close` closes it. It opens by itself in a fullscreen terminal at least 144 columns wide.

The colors are built on `#6266b7` and validated for a dark background, which the HUD paints itself so it looks the same in every terminal (`usage-hud/hooks/palette.ts`). Two options change them in `/config`: **Theme color** (`#rrggbb`; every color is derived from it, keeping how each sits against it; only the default is validated) and **Color overrides** (single colors as `name=#rrggbb`, comma separated; `surface=terminal` keeps the terminal's own background). `/usage-hud colors` lists the colors in force by the names overrides take.

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
