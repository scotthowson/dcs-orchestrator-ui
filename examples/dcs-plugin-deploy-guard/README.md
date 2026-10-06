# DCS Plugin: Deploy Guard

Deployment lifecycle protection for DCS Orchestrator.

## What It Does

| Hook | Trigger | Action |
|------|---------|--------|
| `post-deploy` | After any stack deploys | Validates containers started, checks health status, logs result |
| `pre-update` | Before any stack updates | Saves image digest checkpoint for rollback reference |
| `post-start` | After system start | Checks for restart loops and unhealthy containers |

## Install

From the DCS Orchestrator dashboard:
1. Go to **Plugins** page
2. Click **Install from Git**
3. Enter: `https://github.com/scotthowson/dcs-plugin-deploy-guard.git`

Or manually:
```bash
cd /path/to/Docker-Compose-Skeleton
git clone https://github.com/scotthowson/dcs-plugin-deploy-guard.git .plugins/deploy-guard
```

## Logs

All deployment events are logged to `logs/deployments.log` within the plugin directory:

```
[2025-01-15 14:30:22] OK    nginx-proxy — 3 containers healthy
[2025-01-15 14:35:10] CHECKPOINT monitoring — saved 4 image states
[2025-01-15 14:35:45] OK    monitoring — 4 containers healthy
```

## Creating Your Own Plugin

Use this as a template. A DCS plugin needs:

1. **`plugin.json`** — manifest with name, version, description
2. **`hooks/`** — executable scripts named after lifecycle events
3. **`templates/`** (optional) — compose file templates

Available hook events: `pre-start`, `post-start`, `pre-stop`, `post-stop`, `pre-update`, `post-update`, `pre-deploy`, `post-deploy`

Hook scripts receive context as JSON via stdin and should output status messages to stdout.
