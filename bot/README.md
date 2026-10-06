# DCS Discord bot

Slash commands for a DCS Orchestrator server, with buttons and confirmations.
Separate from the notification webhook, which the API posts to on its own.

**Setup, step by step, with every ID and permission:**
[docs/DISCORD.md](https://github.com/scotthowson/dcs-orchestrator/blob/main/docs/DISCORD.md)
in the DCS repository. Deploy it from the **DCS Discord Bot** template in the DCS Orchestrator dashboard; the image is
`ghcr.io/scotthowson/dcs-discord-bot`.

## Commands

Read (everyone the bot answers): `/status`, `/usage`, `/health`, `/containers [filter] [show]`,
`/stacks`, `/top`, `/disk`, `/updates`, `/logs <target> [lines]`, `/routes [check]`, `/power`,
`/security`, `/schedules`, `/audit [count]`, `/dcs`, `/help`.

Act (admins from `DISCORD_ADMIN_IDS` / `DISCORD_ADMIN_ROLE_IDS`): `/start`, `/stop`, `/restart <target>`,
`/update <stack|container|all>`, `/container <name> [action]`, `/stack <name> [action]`,
`/deploy <template> [stack]` (dry-run, then confirm), `/backup [stack]`, `/prune`, `/run <schedule>`,
`/unban <ip>`, `/dcs action:update|restart`.

Every reply carries buttons (refresh, navigation, the actions that fit). Destructive actions ask the
person who ran the command to confirm within 60 seconds. The bot's status line mirrors the server
(green all healthy, yellow something stopped, red something unhealthy).

## Variables

| Variable | Meaning |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Bot token from the Discord developer portal (Bot → Reset Token) |
| `DISCORD_GUILD_ID` | Your server's ID; commands register there instantly (global registration can take an hour) |
| `DISCORD_ADMIN_IDS` | Comma-separated Discord user IDs allowed to change the server |
| `DISCORD_ADMIN_ROLE_IDS` | Comma-separated role IDs with the same rights |
| `DISCORD_CHANNEL_IDS` | Comma-separated channel IDs the bot answers in; empty = anywhere it is invited |
| `DCS_API_URL` | Where the API answers, e.g. `http://host.docker.internal:9876` |
| `DCS_BOT_USERNAME` / `DCS_BOT_PASSWORD` | The DCS account the bot signs in as — a **bot** account (day-to-day operations only, several sessions allowed); make it admin for `/dcs update` and `/dcs restart` |
| `DCS_SERVER_NAME` | Shown as the author line of every reply |
| `DCS_DASHBOARD_URL` | Optional link on every reply |

Invite URL (replace `APP_ID`):
`https://discord.com/oauth2/authorize?client_id=APP_ID&scope=bot%20applications.commands&permissions=117760`

## Development

```bash
cd bot && npm install
DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… DCS_API_URL=http://127.0.0.1:9876 DCS_BOT_USERNAME=… DCS_BOT_PASSWORD=… node index.js
```

`lib/commands.js` holds the command definitions, the views (pure functions returning embeds and
buttons) and the actions; `lib/format.js` the house style; `lib/api.js` the DCS client; `index.js` the
Discord wiring. Views can be rendered without Discord by calling them with a `ctx` (see
`docs/DISCORD.md` for the message anatomy).
