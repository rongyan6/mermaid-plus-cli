/**
 * @rongyan/mermaid-plus-cli — programmatic API
 *
 * @example
 * import { convertMarkdown, convertMermaid, THEMES, DEFAULTS } from '@rongyan/mermaid-plus-cli'
 *
 * // Convert a markdown file (mermaid blocks → PNG, markdown updated in-place)
 * await convertMarkdown('article.md', './assets', { theme: 'github-dark', scale: 2 })
 *
 * // Convert a single mermaid code string to PNG
 * await convertMermaid('flowchart LR\n  A --> B', 'diagram.png', { theme: 'nord' })
 */

export { convertMarkdown, convertMermaid, resolveThemeOpts, DEFAULTS } from './core.js'
export { findChrome } from './chrome.js'
export { THEMES } from 'beautiful-mermaid'
