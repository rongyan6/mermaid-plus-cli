/**
 * Core rendering engine: mermaid code → PNG or SVG.
 *
 * PNG flow (default):
 *   1. Resolve theme options (beautiful-mermaid theme + optional overrides)
 *   2. Render SVG with renderMermaidSVG()
 *   3. Wrap SVG in an HTML page and write to a temp file
 *   4. Launch headless Chrome via puppeteer-core, screenshot the #wrap element
 *   5. Write PNG buffer to disk
 *
 * SVG flow (format: 'svg'):
 *   1–2. Same as above
 *   3. Fix &amp; encoding in font URLs, write SVG file directly — no Chrome needed
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname, basename } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { renderMermaidSVG, THEMES } from 'beautiful-mermaid'
import { findChrome } from './chrome.js'
import { screenshotEntries } from './screenshot.js'

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULTS = {
  theme: 'github-light',
  format: 'png',      // 'png' | 'svg'
  width: 1200,
  scale: 2,
  fontTimeout: 8000,
}

// ── Theme resolution ──────────────────────────────────────────────────────────

/**
 * Build the beautiful-mermaid RenderOptions object from user-facing options.
 * Named theme is the base; individual color/layout flags override it.
 *
 * @param {object} options
 * @returns {object} RenderOptions for renderMermaidSVG()
 */
export function resolveThemeOpts(options = {}) {
  const themeName = options.theme ?? DEFAULTS.theme
  const base = THEMES[themeName]
  if (!base) {
    const available = Object.keys(THEMES).join(', ')
    throw new Error(`Unknown theme "${themeName}". Available: ${available}`)
  }

  const overrides = {}
  const pick = (key) => { if (options[key] !== undefined) overrides[key] = options[key] }

  pick('bg')
  pick('fg')
  pick('font')
  pick('transparent')
  pick('padding')         // beautiful-mermaid node padding
  pick('nodeSpacing')
  pick('layerSpacing')
  pick('interactive')
  pick('line')
  pick('accent')
  pick('muted')
  pick('surface')
  pick('border')

  return { ...base, ...overrides }
}

// ── HTML wrapper ──────────────────────────────────────────────────────────────

/**
 * Build a minimal HTML page that renders the SVG at the target width.
 * beautiful-mermaid already embeds Google Fonts @import in the SVG's <style>,
 * so no extra <link> tags are needed — just wait for document.fonts.ready.
 *
 * @param {string} svg  Raw SVG string from renderMermaidSVG()
 * @param {object} opts { width, bg, transparent }
 * @returns {string} Full HTML page
 */
function buildHtml(svg, opts) {
  // beautiful-mermaid encodes & as &amp; in font URLs inside the SVG; fix it
  const svgFixed = svg.replace(/&amp;/g, '&')

  const bgColor = opts.transparent ? 'transparent' : (opts.bg ?? '#ffffff')
  const width = opts.width ?? DEFAULTS.width

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: ${bgColor}; display: inline-block; }
  #wrap { padding: 32px 40px; background: ${bgColor}; display: inline-block; }
  svg { display: block; width: ${width}px; height: auto; }
</style>
</head>
<body>
<div id="wrap">
${svgFixed}
</div>
<script>
  window.__fontsReady = false;
  document.fonts.ready.then(() => { window.__fontsReady = true; });
</script>
</body>
</html>`
}

// ── SVG export helper ─────────────────────────────────────────────────────────

/**
 * Prepare SVG for standalone file export.
 * - Fixes &amp; encoding inside Google Fonts URLs embedded by beautiful-mermaid
 * - Optionally stamps an explicit width attribute on the root <svg> element
 *
 * @param {string} svg   Raw SVG from renderMermaidSVG()
 * @param {object} opts  { width? }
 * @returns {string}
 */
function prepareSvg(svg, opts) {
  let out = svg.replace(/&amp;/g, '&')
  if (opts.width) {
    // Compute proportional height from viewBox so aspect ratio is preserved
    const vbMatch = out.match(/viewBox="[^"]*\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"/)
    const scaledHeight = vbMatch
      ? Math.round((opts.width / parseFloat(vbMatch[1])) * parseFloat(vbMatch[2]))
      : undefined

    out = out.replace(/<svg\b[^>]*>/, (tag) => {
      tag = tag.replace(/\swidth="[^"]*"/, '')
      tag = tag.replace(/\sheight="[^"]*"/, '')
      const insert = ` width="${opts.width}"` + (scaledHeight ? ` height="${scaledHeight}"` : '')
      return tag.replace(/(<svg\b)/, `$1${insert}`)
    })
  }
  return out
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert all mermaid code blocks in a markdown file to PNG or SVG images.
 * The markdown file is updated in-place with image references.
 *
 * @param {string} inputPath     Absolute or relative path to the .md file
 * @param {string} [assetsDir]   Output directory for images (relative to inputPath's dir).
 *                               Defaults to "assets".
 * @param {object} [options]     Rendering options (see DEFAULTS + beautiful-mermaid RenderOptions)
 * @param {string} [options.format]  'png' (default) or 'svg'
 * @returns {Promise<{converted: number, total: number}>}
 */
export async function convertMarkdown(inputPath, assetsDir, options = {}) {
  const opts = { ...DEFAULTS, ...options }
  const fmt = opts.format === 'svg' ? 'svg' : 'png'

  const absInput = inputPath.startsWith('/') ? inputPath : join(process.cwd(), inputPath)
  const mdDir = dirname(absInput)
  const resolvedAssetsDir = assetsDir ?? 'assets'
  const absAssets = resolvedAssetsDir.startsWith('/')
    ? resolvedAssetsDir
    : join(mdDir, resolvedAssetsDir)
  const assetsRel = resolvedAssetsDir.replace(/\/$/, '')

  mkdirSync(absAssets, { recursive: true })

  let md = readFileSync(absInput, 'utf8')
  const MERMAID_RE = /```mermaid\n([\s\S]*?)```/g
  const blocks = []
  let match

  while ((match = MERMAID_RE.exec(md)) !== null) {
    const code = match[1].trim()
    const hash = createHash('md5').update(code).digest('hex').slice(0, 8)
    blocks.push({ fullBlock: match[0], code, hash, index: blocks.length + 1 })
  }

  if (blocks.length === 0) {
    console.log('No mermaid blocks found.')
    return { converted: 0, total: 0 }
  }

  console.log(`Found ${blocks.length} mermaid block(s), converting to ${fmt.toUpperCase()}…`)

  const themeOpts = resolveThemeOpts(opts)

  // ── SVG path: no Chrome needed ─────────────────────────────────────────────
  if (fmt === 'svg') {
    let converted = 0
    for (const block of blocks) {
      try {
        const svg = renderMermaidSVG(block.code, themeOpts)
        const fileName = `mermaid-${block.index}-${block.hash}.svg`
        const fileDest = join(absAssets, fileName)
        const imgRef   = `![](${assetsRel}/${fileName})`
        writeFileSync(fileDest, prepareSvg(svg, { width: opts.width }))
        md = md.replace(block.fullBlock, imgRef)
        console.log(`✓ [${block.index}] ${fileName}`)
        converted++
      } catch (e) {
        console.error(`✗ [${block.index}] Failed: ${e.message}`)
      }
    }
    writeFileSync(absInput, md)
    console.log(`\nDone: ${converted}/${blocks.length} SVG(s), updated ${basename(absInput)}`)
    return { converted, total: blocks.length }
  }

  // ── PNG path: render via headless Chrome ───────────────────────────────────
  const tmpDir = join(tmpdir(), 'mermaid-plus-cli')
  mkdirSync(tmpDir, { recursive: true })

  const htmlEntries = []

  for (const block of blocks) {
    try {
      const svg = renderMermaidSVG(block.code, themeOpts)
      const htmlFile = join(tmpDir, `mermaid-${block.index}-${block.hash}.html`)
      writeFileSync(htmlFile, buildHtml(svg, { ...themeOpts, width: opts.width }))

      const pngName = `mermaid-${block.index}-${block.hash}.png`
      const pngDest = join(absAssets, pngName)
      const imgRef  = `![](${assetsRel}/${pngName})`

      htmlEntries.push({ ...block, htmlFile, pngDest, imgRef, pngName })
    } catch (e) {
      console.error(`✗ [${block.index}] SVG render failed: ${e.message}`)
    }
  }

  const results = await screenshotEntries(htmlEntries, opts)

  let converted = 0
  for (const result of results) {
    if (result.buffer) {
      writeFileSync(result.pngDest, result.buffer)
      md = md.replace(result.fullBlock, result.imgRef)
      console.log(`✓ [${result.index}] ${result.pngName}`)
      converted++
    } else {
      console.error(`✗ [${result.index}] Screenshot failed: ${result.error}`)
    }
  }

  writeFileSync(absInput, md)
  console.log(`\nDone: ${converted}/${blocks.length} PNG(s), updated ${basename(absInput)}`)
  return { converted, total: blocks.length }
}

/**
 * Convert a single mermaid diagram string to a PNG or SVG file.
 * Format is determined by `options.format` or auto-detected from the output path extension.
 *
 * @param {string} code         Mermaid diagram source code
 * @param {string} outputPath   Path to write the output file (.png or .svg)
 * @param {object} [options]    Rendering options
 * @param {string} [options.format]  'png' (default) or 'svg'. Overrides extension auto-detect.
 * @returns {Promise<Buffer|string>} PNG Buffer or SVG string
 */
export async function convertMermaid(code, outputPath, options = {}) {
  const opts = { ...DEFAULTS, ...options }

  // Auto-detect format from output extension if not explicitly set
  const extFmt = outputPath.toLowerCase().endsWith('.svg') ? 'svg' : 'png'
  const fmt = opts.format === 'svg' ? 'svg' : (opts.format === 'png' ? 'png' : extFmt)

  const themeOpts = resolveThemeOpts(opts)
  const svg = renderMermaidSVG(code, themeOpts)

  // ── SVG path ───────────────────────────────────────────────────────────────
  if (fmt === 'svg') {
    const out = prepareSvg(svg, { width: opts.width })
    writeFileSync(outputPath, out)
    console.log(`✓ Saved: ${outputPath}`)
    return out
  }

  // ── PNG path ───────────────────────────────────────────────────────────────
  const tmpDir = join(tmpdir(), 'mermaid-plus-cli')
  mkdirSync(tmpDir, { recursive: true })

  const hash = createHash('md5').update(code).digest('hex').slice(0, 8)
  const htmlFile = join(tmpDir, `mermaid-single-${hash}.html`)
  writeFileSync(htmlFile, buildHtml(svg, { ...themeOpts, width: opts.width }))

  const [result] = await screenshotEntries([{ htmlFile, index: 1 }], opts)

  if (!result.buffer) {
    throw new Error(`Screenshot failed: ${result.error}`)
  }

  writeFileSync(outputPath, result.buffer)
  console.log(`✓ Saved: ${outputPath}`)
  return result.buffer
}
