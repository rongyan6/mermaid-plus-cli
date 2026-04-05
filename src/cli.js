#!/usr/bin/env node

/**
 * mmdpc — CLI entry point for @rongyan/mermaid-plus-cli
 *
 * Usage:
 *   mmdpc <input.md> [assets-dir]          # Convert mermaid blocks in markdown
 *   mmdpc <input.mmd> [-o output.png]      # Convert a single .mmd file
 *   mmdpc -i <file> [options]              # Explicit input flag
 *
 * Examples:
 *   mmdpc article.md ./assets --theme github-dark
 *   mmdpc diagram.mmd -o diagram.png --scale 3
 *   npx @rongyan/mermaid-plus-cli article.md
 */

import { readFileSync, existsSync } from 'fs'
import { extname, resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { Command } from 'commander'
import { convertMarkdown, convertMermaid } from './core.js'
import { THEMES } from 'beautiful-mermaid'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))

const THEME_NAMES = Object.keys(THEMES).join(', ')

const program = new Command()

program
  .name('mmdpc')
  .description(
    'Convert mermaid diagrams in markdown or .mmd files to beautiful PNG or SVG images.\n' +
    'Uses beautiful-mermaid for high-quality SVG rendering and system Chrome for PNG screenshots.'
  )
  .version(pkg.version)

  // Input / output
  .argument('[input]', 'Input file (.md or .mmd). Can also be set with -i.')
  .argument('[assets]', 'Assets directory for images (markdown mode only, relative to input file)')
  .option('-i, --input <file>',    'Input file (.md or .mmd)')
  .option('-o, --output <file>',   'Output file path (single-diagram mode only)')
  .option('-a, --assets <dir>',    'Assets directory for image files (markdown mode, relative to input file)', 'assets')
  .option('-f, --format <fmt>',    'Output format: png (default) or svg. Auto-detected from output extension.', 'png')

  // beautiful-mermaid theme selection
  .option('--theme <name>',        `Named theme. Available:\n  ${THEME_NAMES}`, 'github-light')

  // beautiful-mermaid color overrides (override the named theme)
  .option('--bg <color>',          'Background color, e.g. "#ffffff"')
  .option('--fg <color>',          'Foreground / text color')
  .option('--font <family>',       'Font family (must be available via Google Fonts or locally)')
  .option('--transparent',         'Transparent background (PNG with alpha channel)')
  .option('--line <color>',        'Line / edge color')
  .option('--accent <color>',      'Accent / highlight color')
  .option('--muted <color>',       'Muted / secondary text color')
  .option('--surface <color>',     'Node surface / fill color')
  .option('--border <color>',      'Node border color')

  // beautiful-mermaid layout overrides
  .option('--padding <n>',         'Internal node padding in pixels', (v) => parseInt(v, 10))
  .option('--node-spacing <n>',    'Horizontal node spacing in pixels', (v) => parseInt(v, 10))
  .option('--layer-spacing <n>',   'Vertical layer spacing in pixels', (v) => parseInt(v, 10))

  // Rendering / Chrome options
  .option('--width <n>',           'Render width in pixels (SVG is scaled to this)', (v) => parseInt(v, 10), 1200)
  .option('--scale <n>',           'Device pixel ratio — 2 = Retina quality', (v) => parseFloat(v), 2)
  .option('--chrome <path>',       'Path to Chrome/Chromium executable (auto-detected if omitted)')
  .option('--font-timeout <ms>',   'Max milliseconds to wait for web fonts to load', (v) => parseInt(v, 10), 8000)

program.action(async (inputArg, assetsArg, options) => {
  // Resolve input: flag takes priority over positional arg
  const inputFile = options.input ?? inputArg

  if (!inputFile) {
    program.help()
    return
  }

  const absInput = resolve(inputFile)
  if (!existsSync(absInput)) {
    console.error(`Error: File not found: ${inputFile}`)
    process.exit(1)
  }

  const ext = extname(absInput).toLowerCase()

  // Build core options from CLI flags
  const coreOpts = {
    theme:        options.theme,
    format:       options.format,
    width:        options.width,
    scale:        options.scale,
    chrome:       options.chrome,
    fontTimeout:  options.fontTimeout,
  }

  // Pass through beautiful-mermaid overrides only when explicitly provided
  const colorFlags = ['bg', 'fg', 'font', 'transparent', 'line', 'accent', 'muted', 'surface', 'border']
  for (const key of colorFlags) {
    if (options[key] !== undefined) coreOpts[key] = options[key]
  }

  // commander converts --node-spacing to options.nodeSpacing automatically
  const layoutFlags = ['padding', 'nodeSpacing', 'layerSpacing']
  for (const key of layoutFlags) {
    if (options[key] !== undefined) coreOpts[key] = options[key]
  }

  try {
    if (ext === '.md') {
      // Markdown mode: assets dir is the second positional arg or -a flag
      const assetsDirResolved = options.assets !== 'assets'
        ? options.assets        // -a flag was explicitly set
        : (assetsArg ?? options.assets)  // positional arg or default

      await convertMarkdown(absInput, assetsDirResolved, coreOpts)

    } else if (ext === '.mmd' || ext === '.mermaid') {
      // Single-diagram mode: default output extension follows --format
      const outExt = options.format === 'svg' ? '.svg' : '.png'
      const outputFile = options.output
        ?? absInput.replace(/\.(mmd|mermaid)$/i, outExt)

      const code = readFileSync(absInput, 'utf8').trim()
      await convertMermaid(code, outputFile, coreOpts)

    } else {
      console.error(`Unsupported file type "${ext}". Use a .md file (markdown mode) or .mmd file (single-diagram mode).`)
      process.exit(1)
    }
  } catch (e) {
    console.error(`Error: ${e.message}`)
    process.exit(1)
  }
})

program.parse()
