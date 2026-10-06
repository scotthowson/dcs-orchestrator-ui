# DCS Discord brand kit

Artwork for everything DCS shows on Discord, drawn from the app icon's language: the isometric
compose stack on deep slate, emerald for what runs, cyan for the network.

| File | Use | Where it goes |
| --- | --- | --- |
| `app-icon.png` | The DCS Orchestrator application (Rich Presence) and the author icon on every embed | Developer portal → application → General Information → App Icon |
| `bot-avatar.png` | The bot: the stack with a slash-command badge | Developer portal → Bot → Avatar |
| `bot-banner.png` | Profile banner (1360×480) | Developer portal → Bot → Banner |
| `webhook-avatar.png` | Notification posts: the stack with a bell | Used automatically (`DISCORD_WEBHOOK_AVATAR` overrides); also fine as the webhook's avatar in Discord |
| `crowdsec-avatar.png` | CrowdSec alerts: the stack inside a shield | Used automatically by the alert template |
| `presence-dcs.png` | Rich Presence large image | Rich Presence → Art Assets, key `dcs` |
| `presence-healthy.png` | Rich Presence small image, all good | key `healthy` |
| `presence-warning.png` | Rich Presence small image, something needs a look | key `warning` |

## Banners

`make-banners.sh` draws one banner per surface (1360×480, the size Discord shows on bot and app
profiles) and two GitHub social previews (1280×640):

| File | Use it for |
| --- | --- |
| `banner-commands.png` | The DCS-Commands bot profile (Developer portal → Bot → Banner); same art as `bot-banner.png` |
| `banner-alerts.png` | A bot or app that carries the notification webhook's identity, or the channel's pinned welcome post |
| `banner-crowdsec.png` | The CrowdSec alerts channel's welcome post, or a CrowdSec-branded app |
| `banner-manager.png` | The DCS Orchestrator application (Rich Presence app profile) |
| `banner-dcs.png` | Anywhere DCS itself is presented: README headers, forum posts, a server banner |
| `social-aio.png`, `social-ui.png` | GitHub → repository Settings → Social preview, for the framework and the dashboard |

`render.sh` rebuilds every icon PNG from the SVG sources (needs `rsvg-convert`). The API and the bot
load the PNGs from this folder on the `v2.0.0` branch, so keep the file names.
