// The desktop app's remembered passwords without Electron: main/credentialVault.ts (what the main process does with
// safeStorage and its own file) and lib/credentials.ts (the renderer's side of the IPC bridge), each against a stub.
// safeStorage itself (the system keychain) needs a desktop session and is not exercised here.
//
//   node tests/credential-vault.mjs
import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-vault-test-'))
async function load(entry) {
  const outfile = path.join(tmp, `${path.basename(entry, '.ts')}.mjs`)
  await build({ entryPoints: [path.join(root, entry)], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
  return import(pathToFileURL(outfile).href)
}

let passed = 0, failed = 0
const t = (name, ok) => { if (ok) passed++; else { failed++; console.log(`  FAIL ${name}`) } }

const { createVault } = await load('src/main/credentialVault.ts')
// a stand-in for safeStorage: reversible, and never the plain text
const box = (on = true) => ({
  available: () => on,
  encrypt: (p) => Buffer.from([...Buffer.from(p, 'utf8')].map((b) => b ^ 0x5a).reverse()),
  decrypt: (c) => Buffer.from([...c].reverse().map((b) => b ^ 0x5a)).toString('utf8'),
})
const memFile = () => { let e = {}; return { get: () => e, set: (x) => { e = x }, raw: () => JSON.stringify(e) } }

{
  const f = memFile(); const v = createVault(box(), f)
  t('save: kept', v.save('srvA1', 'https://ui.example.test/api', 'scott', 'Secret-Pass-1') === true)
  t('file: no plain password', !f.raw().includes('Secret-Pass-1'))
  t('file: the address is kept with it', f.raw().includes('ui.example.test'))
  t('get: same address', JSON.stringify(v.get('srvA1', 'https://ui.example.test/api')) === JSON.stringify({ username: 'scott', password: 'Secret-Pass-1' }))
  t('get: the address with a trailing slash still matches', v.get('srvA1', 'https://ui.example.test/api/')?.password === 'Secret-Pass-1')
  t('get: another address gets nothing', v.get('srvA1', 'https://evil.example.test/api') === null)
  t('get: unknown server', v.get('nope', 'https://ui.example.test/api') === null)
  t('list', JSON.stringify(v.list()) === '["srvA1"]')
  v.save('srvB2', 'http://10.0.0.2:9876', 'austin', 'Other-Pass-2')
  t('forget one', v.forget('srvA1') === true && v.get('srvA1', 'https://ui.example.test/api') === null && v.list().length === 1)
  t('forget all', v.forget('*') === true && v.list().length === 0)
  t('forget: unknown is fine', v.forget('gone') === true)
}
{
  const f = memFile(); const v = createVault(box(false), f)
  t('no keychain: nothing saved', v.save('srvA1', 'http://a', 'u', 'p') === false && f.raw() === '{}')
  t('no keychain: available false', v.available() === false)
}
{
  const f = memFile(); const v = createVault(box(), f)
  t('bad id refused', v.save('../../etc', 'http://a', 'u', 'p') === false)
  t('empty password refused', v.save('ok1', 'http://a', 'u', '') === false)
  t('non-string refused', v.save('ok1', 'http://a', { x: 1 }, 'p') === false)
  t('get: bad id', v.get({}, 'http://a') === null)
  const thrower = createVault({ ...box(), decrypt: () => { throw new Error('keychain locked') } }, f)
  v.save('ok1', 'http://a', 'u', 'p')
  t('get: a keychain that refuses gives nothing', thrower.get('ok1', 'http://a') === null)
}

// the renderer's side: window.electronAPI.credentials stubbed the way preload exposes it
{
  const calls = []
  const f = memFile(); const v = createVault(box(), f)
  globalThis.window = { electronAPI: { credentials: {
    available: async () => { calls.push('available'); return v.available() },
    save: async (...a) => { calls.push('save'); return v.save(...a) },
    get: async (...a) => { calls.push('get'); return v.get(...a) },
    list: async () => { calls.push('list'); return v.list() },
    forget: async (id) => { calls.push('forget'); return v.forget(id) },
  } } }
  const c = await load('src/renderer/lib/credentials.ts')
  t('renderer: can remember', (await c.canRememberPasswords()) === true)
  t('renderer: save', (await c.rememberPassword('srv1', 'http://h:9876', 'scott', 'Pw-12345')) === true)
  t('renderer: read back', (await c.rememberedPassword('srv1', 'http://h:9876'))?.password === 'Pw-12345')
  t('renderer: other address', (await c.rememberedPassword('srv1', 'http://other:9876')) === null)
  t('renderer: list', JSON.stringify(await c.rememberedServers()) === '["srv1"]')
  await c.forgetPassword('srv1')
  t('renderer: forgotten', (await c.rememberedPassword('srv1', 'http://h:9876')) === null)
  t('renderer: available asked once', calls.filter((x) => x === 'available').length === 1)
  globalThis.window = {}
  const c2 = await load('src/renderer/lib/credentials.ts')
  t('browser: nothing offered', (await c2.canRememberPasswords()) === false)
  t('browser: nothing saved', (await c2.rememberPassword('srv1', 'http://h', 'u', 'p')) === false)
  t('browser: nothing read', (await c2.rememberedPassword('srv1', 'http://h')) === null)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`${passed}/${passed + failed} checks passed`)
process.exit(failed ? 1 : 0)
