# DCS Orchestrator — Privacy Policy

_Last updated: 5 October 2026_

This policy covers the DCS Orchestrator dashboard: its desktop, web and mobile apps (called DCS Manager
before 4.0.31). DCS Orchestrator (DCS, formerly Docker Compose Skeleton) is a self-hosted tool that manages Docker Compose stacks on a server you run yourself. This policy explains what
the software does with data. The short version: **everything stays between your device and your
own server, and nothing is sent to the author.**

## What the dashboard processes

- **Your server's data.** The app talks to the DCS API on a server you chose (a URL you entered).
  It reads and changes what you ask it to: containers, stacks, images, logs, settings. That data
  never leaves the connection between the app and your server.
- **Sign-in.** Your username and a session token are kept on your device so you stay signed in.
  Passwords are sent only to your own server and are never stored by the app.
- **Preferences.** Layouts, colours, profile details and other settings are stored on your device
  (and, if you enable it, on your own server).

## What the dashboard does not do

- It has **no telemetry, analytics, crash reporting or advertising**.
- It does **not** send any data to the author, to a third-party service, or to a cloud.
- It does not track you across sites or apps.

## Discord Rich Presence (desktop app, optional)

If you turn on Discord Rich Presence in Settings and provide a Discord application ID, the desktop
app talks to the Discord client **running on the same computer** over its local interface and asks
it to show an activity on your Discord profile. That activity contains only what you see in the
app: the name of the server you are managing, counts of containers and stacks, whether everything
is healthy, and how long the app has been open. Discord's handling of activity data is governed by
[Discord's privacy policy](https://discord.com/privacy). Turn the feature off at any time in
Settings, or leave the application ID empty, and nothing is sent to Discord.

## Optional integrations you configure

Features such as Discord webhooks, ntfy notifications, Cloudflare DNS, Homarr or update checks
contact the services **you** configured with the credentials **you** provided, from **your** server.
Each of those services applies its own policy. The update check contacts GitHub to read release
information for this project.

## Data retention and deletion

Because the data lives on your device and your server, you delete it by signing out, clearing the
app's storage, or removing the data on your server. The author holds no copy.

## Children

DCS Orchestrator is a system administration tool and is not directed at children.

## Changes

If this policy changes, the new version is published at the same address with an updated date.

## Contact

Questions about this policy: open an issue at
[github.com/scotthowson/dcs-orchestrator-ui](https://github.com/scotthowson/dcs-orchestrator-ui/issues).
