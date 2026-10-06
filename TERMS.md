# DCS Orchestrator — Terms of Service

_Last updated: 5 October 2026_

These terms cover the use of DCS Orchestrator: the server-side framework (formerly Docker Compose Skeleton) and its
dashboard (the desktop, web and mobile apps, called DCS Manager before 4.0.31), together "DCS". DCS is open-source software published under
the license in each repository. By using it you agree to the following.

## 1. What DCS is

DCS is a self-hosted tool for managing Docker Compose stacks on servers you control. There is no
hosted service, no account with the author and no subscription. You install it, you run it, and the
data stays with you.

## 2. Your responsibilities

- You are responsible for the servers, containers and data you manage with DCS, for keeping your
  credentials safe, and for complying with the laws that apply to you.
- DCS can start, stop, update and delete containers, images, volumes and files on your systems.
  Read a confirmation before you accept it. Destructive actions are yours.
- Third-party software you deploy through DCS templates (Jellyfin, Nextcloud, Traefik and others)
  comes with its own licenses and terms.

## 3. Optional integrations

Features that contact other services (Discord Rich Presence, Discord webhooks, ntfy, Cloudflare,
Homarr, GitHub for update checks) do so only when you configure them, with your own credentials,
and are subject to those services' terms. Discord Rich Presence uses the Discord client on your
computer and shows an activity on your own profile; you can turn it off at any time.

## 4. No warranty

DCS is provided **"as is"**, without warranty of any kind, express or implied, including fitness
for a particular purpose. The author does not guarantee that DCS is free of errors or that it will
meet your needs.

## 5. Limitation of liability

To the fullest extent permitted by law, the author is not liable for any loss or damage, including
lost data, downtime or lost profits, arising from the use of or inability to use DCS.

## 6. Changes and updates

DCS is developed in the open. Releases may add, change or remove features. The update feature
fetches releases from GitHub only when you or a schedule you created asks it to.

## 7. Governing law

These terms are governed by the laws of Ontario, Canada, without regard to conflict-of-law rules.

## 8. Contact

Questions about these terms: open an issue at
[github.com/scotthowson/dcs-orchestrator-ui](https://github.com/scotthowson/dcs-orchestrator-ui/issues).
