# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue: through
[GitHub's private vulnerability reporting](https://github.com/scotthowson/dcs-orchestrator-ui/security/advisories/new)
for this repository. Say which version (the About tab in Settings,
or `package.json`), how to reproduce it and what an attacker gains. This is a one-person project, so an
acknowledgement may take a few days.

A problem in the server (the API, the templates, the VM images) belongs to the
[dcs-orchestrator](https://github.com/scotthowson/dcs-orchestrator/security/advisories/new) repository, whose
[SECURITY.md](https://github.com/scotthowson/dcs-orchestrator/blob/main/SECURITY.md) describes the security model.

## What the dashboard holds

The dashboard runs against your own server and sends nothing to the author ([PRIVACY.md](PRIVACY.md)). It keeps the
server URL, the session token and your preferences on the device (electron-store on the desktop, `localStorage` in a
browser); the password itself is never stored, though the offline fallback keeps a salted PBKDF2 hash of it on the device. An admin session in the dashboard is equivalent to shell access on the server,
so sign out on shared devices, use the auto-lock, and put the dashboard behind HTTPS (Traefik, and Authelia if you
like) for anything reachable from outside your LAN.
