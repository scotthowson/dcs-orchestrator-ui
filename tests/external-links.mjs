// The desktop app's guard for links it hands to the system (main/externalLinks.ts): only http and https leave the app.
//
//   node tests/external-links.mjs
import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-links-test-'))
const outfile = path.join(tmp, 'externalLinks.mjs')
await build({ entryPoints: [path.join(root, 'src/main/externalLinks.ts')], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
const { isSafeExternalUrl } = await import(pathToFileURL(outfile).href)
fs.rmSync(tmp, { recursive: true, force: true })

let passed = 0, failed = 0
const t = (url, want) => { if (isSafeExternalUrl(url) === want) passed++; else { failed++; console.log(`  FAIL ${JSON.stringify(url)} should be ${want ? 'opened' : 'refused'}`) } }

t('https://github.com/scotthowson/dcs-orchestrator', true)
t('http://192.168.1.10:8096/web/', true)
t('HTTPS://EXAMPLE.TEST/', true)
t('file:///etc/passwd', false)
t('file://server/share/x.exe', false)
t('smb://nas/share', false)
t('javascript:alert(1)', false)
t('data:text/html,<script>1</script>', false)
t('vbscript:msgbox(1)', false)
t('ms-msdt:/id PCWDiagnostic', false)
t('steam://run/1', false)
t('mailto:someone@example.test', false) // the dashboard links no mail address
t('//example.test/x', false)
t('not a url', false)
t('', false)
t('  javascript:alert(1)', false)

console.log(`${passed}/${passed + failed} external-link checks passed`)
process.exit(failed ? 1 : 0)
