/**
 * Chrome executable auto-discovery across platforms.
 */

import { existsSync } from 'fs'
import { platform } from 'os'

const CHROME_PATHS = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Chromium\\Application\\chrome.exe`,
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
  ],
}

/**
 * Find a Chrome executable path.
 * @param {string} [override] - Explicit path to Chrome (skips auto-detection)
 * @returns {string} Path to Chrome executable
 * @throws {Error} If Chrome is not found
 */
export function findChrome(override) {
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`Chrome not found at specified path: ${override}`)
    }
    return override
  }

  const os = platform()
  const candidates = CHROME_PATHS[os] ?? CHROME_PATHS.linux

  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }

  throw new Error(
    'Chrome not found. Install Google Chrome or specify its path with --chrome <path>'
  )
}
