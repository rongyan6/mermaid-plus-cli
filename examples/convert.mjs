/**
 * convert.mjs — mermaid → PNG（Chrome headless 渲染）
 *
 * 流程：
 *   1. 读取 markdown，提取所有 ```mermaid 块
 *   2. 用 beautiful-mermaid 生成 SVG，包成 HTML 写入 /tmp
 *   3. 用 puppeteer-core 启动系统 Chrome headless
 *   4. 打开每个 HTML，等字体加载，截图 .wrap 元素
 *   5. PNG 存入 <assetsDir>，更新 markdown 图片引用
 *
 * 用法：
 *   node convert.mjs <input.md> <assets-dir-relative-to-md>
 *
 * 示例：
 *   node convert.mjs ~/article.md ./assets
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname, basename } from 'path'
import { createHash } from 'crypto'
import { renderMermaidSVG, THEMES } from 'beautiful-mermaid'
import puppeteer from 'puppeteer-core'

// ── 配置 ───────────────────────────────────────────────────────────
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const THEME       = THEMES['github-light']
const RENDER_W    = 1200          // 渲染宽度 px（SVG 等比缩放）
const SCALE       = 2             // 设备像素比（2 = Retina 质量）
const TMP_DIR     = '/tmp/mermaid-previews'
const FONT_TIMEOUT = 8000         // 等字体加载最长 ms

// ── 参数 ───────────────────────────────────────────────────────────
const [,, mdFile, assetsArg] = process.argv
if (!mdFile || !assetsArg) {
  console.error('用法: node convert.mjs <input.md> <assets-dir>')
  process.exit(1)
}
const mdPath      = mdFile.startsWith('/') ? mdFile : join(process.cwd(), mdFile)
const mdDir       = dirname(mdPath)
const assetsDirAbs = assetsArg.startsWith('/') ? assetsArg : join(mdDir, assetsArg)
const assetsRelInMd = assetsArg.replace(/\/$/, '')  // md 里引用用的相对路径

mkdirSync(TMP_DIR, { recursive: true })
mkdirSync(assetsDirAbs, { recursive: true })

// ── 1. 提取 mermaid 块 ─────────────────────────────────────────────
let md = readFileSync(mdPath, 'utf8')
const MERMAID_RE = /```mermaid\n([\s\S]*?)```/g
const blocks = []
let match

while ((match = MERMAID_RE.exec(md)) !== null) {
  const code  = match[1].trim()
  const hash  = createHash('md5').update(code).digest('hex').slice(0, 8)
  const index = blocks.length + 1
  blocks.push({ fullBlock: match[0], code, hash, index })
}

if (blocks.length === 0) {
  console.log('没有找到 mermaid 代码块，退出。')
  process.exit(0)
}
console.log(`找到 ${blocks.length} 个 mermaid 块，开始转换…\n`)

// ── 2. 生成 SVG → HTML 临时文件 ────────────────────────────────────
const entries = []

for (const { fullBlock, code, hash, index } of blocks) {
  let svg
  try {
    svg = renderMermaidSVG(code, THEME)
  } catch (e) {
    console.error(`✗ [${index}] SVG 生成失败: ${e.message}`)
    continue
  }

  const pngName  = `mermaid-${index}-${hash}.png`
  const htmlFile = `${TMP_DIR}/mermaid-${index}-${hash}.html`
  const pngDest  = join(assetsDirAbs, pngName)
  const imgRef   = `![](${assetsRelInMd}/${pngName})`

  // 修复 Google Fonts 的 HTML 实体编码（SVG 里 & 被转义了）
  const svgFixed = svg.replace(/&amp;/g, '&')

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
  svg { display: block; width: ${RENDER_W}px; height: auto; }
</style>
</head>
<body>
<div class="wrap" id="wrap">
${svgFixed}
</div>
<script>
  window.__ready = false;
  document.fonts.ready.then(() => { window.__ready = true; });
</script>
</body>
</html>`

  writeFileSync(htmlFile, html)
  entries.push({ index, fullBlock, htmlFile, pngDest, imgRef, pngName })
}

// ── 3. 启动 headless Chrome ────────────────────────────────────────
console.log('启动 Chrome headless…')
const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    `--force-device-scale-factor=${SCALE}`,
    '--allow-file-access-from-files',
  ],
})

const page = await browser.newPage()
await page.setViewport({ width: RENDER_W + 80, height: 2400, deviceScaleFactor: SCALE })

// ── 4. 逐个截图 ────────────────────────────────────────────────────
const replacements = []

for (const { index, fullBlock, htmlFile, pngDest, imgRef, pngName } of entries) {
  try {
    await page.goto(`file://${htmlFile}`, { waitUntil: 'networkidle0', timeout: 15000 })

    // 等字体加载（最多 FONT_TIMEOUT ms）
    await page.waitForFunction('window.__ready === true', { timeout: FONT_TIMEOUT })
      .catch(() => {/* 超时也继续，系统字体 fallback 已够用 */})

    // 截取 #wrap 元素
    const wrap = await page.$('#wrap')
    if (!wrap) throw new Error('#wrap 元素不存在')

    await wrap.screenshot({ path: pngDest, type: 'png' })

    replacements.push({ fullBlock, imgRef })
    console.log(`✓ [${index}] ${pngName}`)
  } catch (e) {
    console.error(`✗ [${index}] 截图失败: ${e.message}`)
  }
}

await browser.close()

// ── 5. 更新 markdown ───────────────────────────────────────────────
for (const { fullBlock, imgRef } of replacements) {
  md = md.replace(fullBlock, imgRef)
}
writeFileSync(mdPath, md)

console.log(`\n完成：${replacements.length}/${entries.length} 张图，已更新 ${basename(mdPath)}`)
