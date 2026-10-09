// =============================================================================
// Clipboard for pages served over plain http. Browsers only expose
// navigator.clipboard on secure pages (https, localhost): a dashboard opened at
// http://192.168.x.x:3000 — the usual way to reach a home server — has none, so
// every Copy button silently did nothing. copyText() uses the real clipboard
// where there is one and a hidden, selected textarea (execCommand) elsewhere;
// installClipboardFallback() gives the page a navigator.clipboard.writeText that
// does the same, so all the existing buttons work without being touched.
// =============================================================================

/** Copies through a selected textarea. Returns whether the browser accepted it. */
export function copyWithSelection(text: string): boolean {
  if (typeof document === 'undefined') return false
  const active = document.activeElement as HTMLElement | null
  // inside a dialog the textarea joins the dialog: a focus trap would otherwise take the focus (and the selection) back
  const host = (active?.closest?.('[role="dialog"], dialog') as HTMLElement | null) ?? document.body
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.setAttribute('aria-hidden', 'true')
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none'
  host.appendChild(ta)
  let ok = false
  try {
    ta.focus({ preventScroll: true })
    ta.select()
    ta.setSelectionRange(0, text.length)
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  host.removeChild(ta)
  try { active?.focus?.({ preventScroll: true }) } catch { /* the previous element may be gone */ }
  return ok
}

/** Copies text; rejects when neither the clipboard nor the fallback could. */
export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      // (the wrapped writeText of installClipboardFallback already tries the selection when the clipboard refuses)
      await navigator.clipboard.writeText(text)
      return
    } catch {
      /* permission denied or the page lost focus: try the fallback */
    }
  }
  if (!copyWithSelection(text)) throw new DOMException('Copying was refused by the browser', 'NotAllowedError')
}

/**
 * Gives an insecure page a navigator.clipboard.writeText; on a secure page the real one keeps working and falls back to
 * the selection when it refuses (no clipboard permission, the window not focused), so no Copy button rejects there.
 */
export function installClipboardFallback(): void {
  if (typeof navigator === 'undefined') return
  const real = navigator.clipboard
  if (real) {
    if (typeof real.writeText !== 'function') return
    const write = real.writeText.bind(real)
    const writeText = (text: string) => write(text).catch(() => {
      if (!copyWithSelection(text)) throw new DOMException('Copying was refused by the browser', 'NotAllowedError')
    })
    try { Object.defineProperty(real, 'writeText', { value: writeText, configurable: true }) } catch { /* a locked-down browser */ }
    return
  }
  const shim = {
    writeText: (text: string) => copyText(text),
    readText: () => Promise.reject(new DOMException('Reading the clipboard needs a secure page (https)', 'NotAllowedError')),
  }
  try {
    Object.defineProperty(navigator, 'clipboard', { value: shim, configurable: true })
  } catch { /* a locked-down browser: the buttons keep their own error handling */ }
}
