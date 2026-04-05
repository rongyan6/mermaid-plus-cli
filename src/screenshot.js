/**
 * Headless Chrome screenshot via native Chrome DevTools Protocol (CDP).
 *
 * Zero npm dependencies — uses Node.js built-ins only:
 *   - child_process.spawn  → launch system Chrome
 *   - net.createServer     → find a free port
 *   - built-in fetch       → poll /json/version until Chrome is ready
 *   - built-in WebSocket   → CDP session (Node 22+)
 */

import { spawn } from 'node:child_process'
import net from 'node:net'
import { findChrome } from './chrome.js'

// ── Free-port helper ──────────────────────────────────────────────────────────

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

// ── Minimal CDP session ───────────────────────────────────────────────────────

class CDPSession {
  constructor(ws) {
    this._ws = ws
    this._pending = new Map()   // id → { resolve, reject }
    this._listeners = new Map() // method → [fn, ...]
    this._id = 0

    ws.addEventListener('message', ({ data }) => {
      const msg = JSON.parse(data)
      if (msg.id != null) {
        const p = this._pending.get(msg.id)
        if (p) {
          this._pending.delete(msg.id)
          msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
        }
      } else if (msg.method) {
        for (const fn of (this._listeners.get(msg.method) ?? [])) fn(msg.params)
      }
    })
  }

  /** Send a CDP command and return a Promise<result>. */
  send(method, params = {}) {
    const id = ++this._id
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject })
      this._ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /** Return a Promise that resolves the next time `event` fires. */
  once(event) {
    return new Promise(resolve => {
      const fn = (params) => {
        const list = this._listeners.get(event) ?? []
        this._listeners.set(event, list.filter(f => f !== fn))
        resolve(params)
      }
      this._listeners.set(event, [...(this._listeners.get(event) ?? []), fn])
    })
  }

  close() { this._ws.close() }
}

// ── Chrome launch & CDP connect ───────────────────────────────────────────────

/**
 * Poll /json/list until Chrome is ready and a page-level tab is available.
 * Returns the tab's webSocketDebuggerUrl (page-level CDP endpoint).
 *
 * NOTE: /json/new was removed in Chrome 125+ for security reasons.
 * Chrome headless always opens a default about:blank tab on start,
 * so /json/list is the reliable way to get a page endpoint.
 */
async function waitForChrome(port, timeout = 8000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) })
      const tabs = await res.json()
      const page = tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page.webSocketDebuggerUrl
    } catch { /* Chrome not ready yet */ }
    await new Promise(r => setTimeout(r, 150))
  }
  throw new Error(`Chrome DevTools Protocol not available on port ${port} after ${timeout}ms`)
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Launch Chrome, screenshot the #wrap element from each HTML file via CDP.
 *
 * @param {Array<{htmlFile: string, [key: string]: any}>} entries
 * @param {object} opts  { chromePath, width, scale, fontTimeout, transparent }
 * @returns {Promise<Array<{buffer?: Buffer, error?: string, ...entry}>>}
 */
export async function screenshotEntries(entries, opts) {
  const {
    chrome,         // raw path or undefined → resolved by findChrome()
    width       = 1200,
    scale       = 2,
    fontTimeout = 8000,
    transparent = false,
  } = opts

  const chromePath = findChrome(chrome)
  const port    = await findFreePort()
  const browser = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--no-sandbox',
    '--disable-setuid-sandbox',
    `--force-device-scale-factor=${scale}`,
    '--allow-file-access-from-files',
    '--disable-extensions',
    '--disable-default-apps',
  ], { stdio: 'ignore' })

  let cdp
  try {
    // ── Connect ───────────────────────────────────────────────────────────────
    // waitForChrome polls /json/list and returns the default tab's WebSocket URL
    const wsUrl = await waitForChrome(port)
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    cdp = new CDPSession(ws)

    // ── Configure ─────────────────────────────────────────────────────────────
    await cdp.send('Page.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width:             width + 80,
      height:            2400,
      deviceScaleFactor: scale,
      mobile:            false,
    })
    if (transparent) {
      // Override Chrome's default opaque white background
      await cdp.send('Emulation.setDefaultBackgroundColorOverride', {
        color: { r: 0, g: 0, b: 0, a: 0 },
      })
    }

    // ── Screenshot each entry ─────────────────────────────────────────────────
    const results = []

    for (const entry of entries) {
      try {
        // Navigate (listener first to avoid any race)
        const loaded = cdp.once('Page.loadEventFired')
        await cdp.send('Page.navigate', { url: `file://${entry.htmlFile}` })
        await Promise.race([loaded, new Promise(r => setTimeout(r, 15000))])

        // Wait for web fonts (document.fonts.ready sets window.__fontsReady)
        const fontDeadline = Date.now() + fontTimeout
        while (Date.now() < fontDeadline) {
          const { result: { value } } = await cdp.send('Runtime.evaluate', {
            expression:   'window.__fontsReady',
            returnByValue: true,
          })
          if (value) break
          await new Promise(r => setTimeout(r, 100))
        }

        // Get #wrap bounding box (CSS pixels, relative to viewport origin)
        const { result: { value: rectJson } } = await cdp.send('Runtime.evaluate', {
          expression:   'JSON.stringify(document.getElementById("wrap").getBoundingClientRect().toJSON())',
          returnByValue: true,
        })
        const { x, y, width: w, height: h } = JSON.parse(rectJson)

        // Capture just the #wrap region
        const { data } = await cdp.send('Page.captureScreenshot', {
          format:              'png',
          clip:                { x, y, width: w, height: h, scale: 1 },
          captureBeyondViewport: true,
          fromSurface:         true,
        })

        results.push({ ...entry, buffer: Buffer.from(data, 'base64') })
      } catch (e) {
        results.push({ ...entry, error: e.message })
      }
    }

    return results
  } finally {
    cdp?.close()
    browser.kill()
  }
}
