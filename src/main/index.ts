import './userData' // first: it decides where the settings and the sign-in live (see the file)
import { app, BrowserWindow, ipcMain, shell, session, Menu, nativeTheme, safeStorage, type IpcMainInvokeEvent } from 'electron'
import path from 'path'
import http from 'http'
import Store from 'electron-store'
import { configurePresence, updatePresence, presenceStatus, shutdownPresence, type PresencePayload } from './presence'
import { createVault, type VaultEntry } from './credentialVault'
import { isSafeExternalUrl } from './externalLinks'

// Disable Chromium's Private Network Access preflight checks so the renderer
// can fetch() to local/private IPs without CORS preflight blocking.
app.commandLine.appendSwitch(
  'disable-features',
  'BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights',
)

// ---------------------------------------------------------------------------
// Plain Node.js HTTP GET — completely bypasses Chromium's networking stack.
// No CORS, no CSP, no PNA, no webRequest handlers.  Just a raw TCP request.
// ---------------------------------------------------------------------------
function httpGetJson(url: string, timeoutMs = 5000): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  return new Promise((resolve) => {
    try {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        let body = ''
        res.on('data', (chunk: Buffer) => { body += chunk.toString() })
        res.on('end', () => {
          const status = res.statusCode || 0
          const ok = status >= 200 && status < 300
          try {
            const data = JSON.parse(body)
            resolve({ ok, status, data })
          } catch {
            resolve({ ok, status, data: null, error: 'Invalid JSON' })
          }
        })
      })
      req.on('error', (err: Error) => {
        resolve({ ok: false, status: 0, data: null, error: err.message })
      })
      req.on('timeout', () => {
        req.destroy()
        resolve({ ok: false, status: 0, data: null, error: 'Timeout' })
      })
    } catch (err) {
      resolve({ ok: false, status: 0, data: null, error: String(err) })
    }
  })
}

const store = new Store({
  defaults: {
    serverUrl: 'http://127.0.0.1:9876',
    pollingInterval: 5000,
    containerPollingInterval: 10000,
    imagePollingInterval: 60000,
    logPollingInterval: 3000,
    // dark, light or system (follow the OS) — the renderer's mode setting
    theme: 'system',
    sidebarCollapsed: false,
    windowBounds: { width: 1400, height: 900 },
  },
})

let mainWindow: BrowserWindow | null = null

// The renderer stores {pref, bg: {dark, light}} under "appearance" whenever its look changes
// (lib/nativeLook): nativeTheme follows the mode (title bar, native menus and dialogs) and the
// window shows the page's colour before the first paint
function applyAppearance(value: unknown): string {
  const a = value && typeof value === 'object' ? value as { pref?: unknown; bg?: { dark?: unknown; light?: unknown } } : {}
  nativeTheme.themeSource = a.pref === 'dark' || a.pref === 'light' ? a.pref : 'system'
  const bg = nativeTheme.shouldUseDarkColors ? a.bg?.dark : a.bg?.light
  const color = typeof bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(bg) ? bg : '#0f172a'
  mainWindow?.setBackgroundColor(color)
  return color
}

function createWindow() {
  const bounds = store.get('windowBounds') as { width: number; height: number }

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: applyAppearance(store.get('appearance')),
    titleBarStyle: 'hiddenInset',
    frame: process.platform === 'darwin' ? false : true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('resize', () => {
    if (mainWindow) {
      const [width, height] = mainWindow.getSize()
      store.set('windowBounds', { width, height })
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    else console.warn(`[links] not opened (only http and https leave the app): ${url.slice(0, 200)}`)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------
ipcMain.handle('get-settings', () => store.store)
ipcMain.handle('get-setting', (_event, key: string) => store.get(key))
ipcMain.handle('set-setting', (_event, key: string, value: unknown) => {
  if (value === undefined || value === null) {
    store.delete(key)
  } else {
    store.set(key, value)
  }
  if (key === 'appearance') applyAppearance(value)
  if (key.startsWith('discord')) void applyPresenceSettings()
  return true
})
ipcMain.handle('get-version', () => app.getVersion())

// Passwords remembered per server (the sign-in's "Remember the password on this device"): encrypted with safeStorage,
// in a file of their own (server-credentials.json in the userData folder) that get-settings never returns. On Linux
// only a real keyring counts: with Chromium's built-in key ('basic_text') the box stays unchecked and nothing is kept.
const credentialFile = new Store<{ entries: Record<string, VaultEntry> }>({ name: 'server-credentials', defaults: { entries: {} } })
const vault = createVault(
  {
    available: () => safeStorage.isEncryptionAvailable()
      && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (cipher) => safeStorage.decryptString(cipher),
  },
  { get: () => credentialFile.get('entries'), set: (entries) => credentialFile.set('entries', entries) },
)
/** only the app's own window asks (a page it opened in a frame never does) */
const fromApp = (event: IpcMainInvokeEvent) => !!mainWindow && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame
ipcMain.handle('credentials-available', (event) => fromApp(event) && vault.available())
ipcMain.handle('credentials-save', (event, serverId: unknown, url: unknown, username: unknown, password: unknown) => fromApp(event) && vault.save(serverId, url, username, password))
ipcMain.handle('credentials-get', (event, serverId: unknown, url: unknown) => (fromApp(event) ? vault.get(serverId, url) : null))
ipcMain.handle('credentials-list', (event) => (fromApp(event) ? vault.list() : []))
ipcMain.handle('credentials-forget', (event, serverId: unknown) => fromApp(event) && vault.forget(serverId))

// Discord Rich Presence (local Discord client over IPC; off until turned on in Settings)
function applyPresenceSettings() {
  return configurePresence({
    enabled: store.get('discordPresenceEnabled') === true,
    clientId: String(store.get('discordClientId') ?? ''),
  })
}
ipcMain.handle('presence-update', (_event, payload: PresencePayload) => {
  if (payload && typeof payload.details === 'string' && typeof payload.state === 'string') updatePresence(payload)
  return true
})
ipcMain.handle('presence-status', () => presenceStatus())
ipcMain.handle('presence-configure', () => applyPresenceSettings().then(() => presenceStatus()))

// Combined server check: tests connectivity AND setup status in one call.
// Uses Node.js http module (NOT Chromium net.fetch) — zero browser security
// policies apply.  Returns everything the renderer needs in a single IPC trip.
ipcMain.handle('check-server', async (_event, serverUrl: string) => {
  // 1. Test basic connectivity
  const root = await httpGetJson(`${serverUrl}/`)
  if (!root.ok) {
    return { reachable: false, initialized: true, error: root.error || 'unreachable' }
  }

  // 2. Check setup status
  const setup = await httpGetJson(`${serverUrl}/setup/status`)
  if (setup.ok && setup.data && typeof setup.data === 'object' && 'initialized' in (setup.data as Record<string, unknown>)) {
    return { reachable: true, initialized: !!(setup.data as { initialized: boolean }).initialized }
  }

  // Setup endpoint missing or unexpected response — treat as initialized
  return { reachable: true, initialized: true }
})

// Generic JSON fetch via Node.js http (for any other IPC callers)
ipcMain.handle('net-fetch-json', async (_event, url: string) => {
  return httpGetJson(url)
})

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  // CORS proxy for renderer-side fetch (ongoing API calls after login)
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://*/*'] },
    (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, Origin: '' } })
    },
  )

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isApiRequest = details.url.startsWith('http://')
    const headers = { ...details.responseHeaders }

    if (isApiRequest) {
      headers['Access-Control-Allow-Origin'] = ['*']
      headers['Access-Control-Allow-Methods'] = ['GET, POST, DELETE, OPTIONS']
      headers['Access-Control-Allow-Headers'] = ['Content-Type, Authorization']
      headers['Access-Control-Allow-Private-Network'] = ['true']
    }

    headers['Content-Security-Policy'] = [
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data: blob:; frame-src 'self' blob:; child-src 'self' blob:; connect-src 'self' http://*:* ws://*:* https://*:* wss://*:*; font-src 'self' data:; frame-ancestors 'none'",
    ]

    callback({ responseHeaders: headers })
  })

  // Menu
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
    ]))
  } else {
    Menu.setApplicationMenu(null)
  }

  createWindow()
  void applyPresenceSettings()
})

app.on('before-quit', () => {
  void shutdownPresence()
  if (mainWindow) {
    mainWindow.removeAllListeners('close')
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
