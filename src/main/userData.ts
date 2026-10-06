// =============================================================================
// The folder Electron keeps a person's settings, sign-in and cache in is named after the app.
// It is named here, on purpose, not left to what the packaging tool derives from the package:
// the app is DCS Orchestrator, and a folder of the earlier names ("DCS Manager", "Docker Compose Skeleton UI",
// or the package name in a development run) is carried over once, so nobody signs in again.
//
// This module must be the FIRST import of the main process: electron-store opens its file in
// the constructor, and Chromium's storage is decided before the first window.
// =============================================================================

import { app } from 'electron'
import path from 'path'
import { migrateUserData } from './userDataMigration'

const NAME = 'DCS Orchestrator'
const EARLIER_NAMES = ['DCS Manager', 'Docker Compose Skeleton UI', 'docker-compose-skeleton-ui']

app.setName(NAME)
const appData = app.getPath('appData')
const target = path.join(appData, NAME)
try {
  const from = migrateUserData(target, EARLIER_NAMES.map((n) => path.join(appData, n)))
  if (from) console.log(`[userData] carried the data of ${from} over to ${target}`)
} catch (err) {
  console.error('[userData] the earlier data folder could not be carried over:', err)
}
app.setPath('userData', target)
