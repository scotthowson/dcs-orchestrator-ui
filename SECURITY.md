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
servers you added, each with its own session token and the username last used there, and your preferences on the
device (`localStorage`; electron-store for the desktop app's settings), plus a salted PBKDF2 hash of your password for
the app lock. Nothing of a server is shown before that server has confirmed the session in this run of the app, and a
token is only ever sent to the address it was issued by. Passwords are not stored, with one exception you choose: in
the desktop app, "Remember the password on this device" on the sign-in keeps that server's password encrypted by the
operating system's keychain (Electron `safeStorage`: Keychain, DPAPI, Secret Service/KWallet; never with Chromium's
plain fallback key) in a file of its own, tied to that server's address, so an expired session signs in again by
itself. The browser and Android builds never offer it. "Forget password" (the server menu, Settings → Servers)
deletes it, removing the server deletes its token and password, and "Sign out here" ends that server's session on the
server and on the device. An admin session in the dashboard is equivalent to shell access on the server,
so sign out on shared devices, use the auto-lock, and put the dashboard behind HTTPS (Traefik, and Authelia if you
like) for anything reachable from outside your LAN.
