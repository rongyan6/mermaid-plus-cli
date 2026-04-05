/**
 * gen-html.mjs
 * 第一步：从 markdown 提取 mermaid 块 → 生成 SVG → 包成 HTML 文件
 * 输出：/tmp/mermaid-previews/manifest.json + 各 HTML 文件
 *
 * 用法：node gen-html.mjs <input.md>
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { renderMermaidSVG, THEMES } from 'beautiful-mermaid'
import { createHash } from 'crypto'

const THEME = THEMES['github-light']
const OUT_DIR = '/tmp/mermaid-previews'
mkdirSync(OUT_DIR, { recursive: true })

const [,, mdFile] = process.argv
if (!mdFile) { console.error('用法: node gen-html.mjs <input.md>'); process.exit(1) }

const md = readFileSync(mdFile, 'utf8')
const MERMAID_RE = /```mermaid\n([\s\S]*?)```/g

const manifest = []  // { index, hash, htmlFile, pngName, fullBlock }
let match, count = 0

while ((match = MERMAID_RE.exec(md)) !== null) {
  const fullBlock = match[0]
  const code = match[1].trim()
  const hash = createHash('md5').update(code).digest('hex').slice(0, 8)
  const index = ++count
  const htmlFile = `${OUT_DIR}/mermaid-${index}-${hash}.html`
  const pngName  = `mermaid-${index}-${hash}.png`

  let svg
  try {
    svg = renderMermaidSVG(code, THEME)
  } catch (e) {
    console.error(`✗ [${index}] SVG 生成失败: ${e.message}`)
    continue
  }

  // 从 SVG 拿 viewBox 尺寸，用于设置 canvas 宽高
  const wMatch = svg.match(/width="([\d.]+)"/)
  const hMatch = svg.match(/height="([\d.]+)"/)
  const svgW = wMatch ? parseFloat(wMatch[1]) : 800
  const svgH = hMatch ? parseFloat(hMatch[1]) : 600

  // 渲染宽度：固定 1200px，等比缩放高度
  const renderW = 1200
  const renderH = Math.round((svgH / svgW) * renderW)

  // 把 Google Fonts 的外链改为内联 preload 避免跨域问题
  const svgFixed = svg.replace(
    `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap');`,
    `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');`
  )

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #ffffff; display: inline-block; }
  .wrap { padding: 32px 40px; background: #ffffff; display: inline-block; }
  svg { display: block; width: ${renderW}px; height: auto; }
</style>
</head>
<body>
<div class="wrap" id="wrap">
${svgFixed}
</div>
<script>
  window.__svgW = ${svgW};
  window.__svgH = ${svgH};
  window.__renderW = ${renderW};
  window.__renderH = ${renderH};
  window.__ready = false;
  // 字体加载完成后标记 ready
  document.fonts.ready.then(() => { window.__ready = true; });
</script>
</body>
</html>`

  writeFileSync(htmlFile, html)
  manifest.push({ index, hash, htmlFile, pngName, fullBlock })
  console.log(`✓ [${index}] ${pngName}  (${renderW}×${renderH})`)
}

writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify(manifest, null, 2))
console.log(`\n共 ${manifest.length} 个图表，manifest → ${OUT_DIR}/manifest.json`)
