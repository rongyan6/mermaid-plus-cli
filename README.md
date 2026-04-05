# @rongyan/mermaid-plus-cli

Convert mermaid diagrams in markdown or `.mmd` files to **beautiful PNG or SVG images**.

Built on top of [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) for high-quality SVG rendering, with PNG export via your **system Chrome** — zero bundled browsers, zero heavy dependencies.

**Compared to [mermaid-cli](https://github.com/mermaid-js/mermaid-cli)** — more beautiful output, uses system Chrome instead of bundling Chromium (~300 MB)

**Compared to [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid)** — adds PNG export and a ready-to-use CLI on top

**How PNG works**: Chrome is launched headlessly via native Chrome DevTools Protocol (CDP) using Node.js 22+ built-in `WebSocket` and `fetch` — no puppeteer, no extra npm dependencies.

---

## Requirements

- **Node.js ≥ 22** (built-in `WebSocket` required for CDP)
- **Google Chrome ≥ 112** installed on your system (for PNG export only)
  - macOS: `/Applications/Google Chrome.app` — auto-detected
  - Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe` — auto-detected
  - Linux: `/usr/bin/google-chrome` or `/usr/bin/chromium` — auto-detected
  - Custom path: `--chrome /path/to/chrome`
- SVG export does **not** require Chrome

---

## Installation

```bash
npm install -g @rongyan/mermaid-plus-cli
```

Or use without installing:

```bash
npx @rongyan/mermaid-plus-cli article.md
```

---

## Usage

### CLI

```bash
# Markdown mode — convert all mermaid blocks to images, update file in-place
mmdpc article.md [assets-dir]

# Single diagram mode — .mmd or .mermaid file
mmdpc diagram.mmd                         # → diagram.png
mmdpc diagram.mmd -o diagram.svg          # SVG (no Chrome needed)
mmdpc diagram.mmd --format svg            # same

# With options
mmdpc article.md ./assets --theme github-dark --scale 3
```

### npx

```bash
npx @rongyan/mermaid-plus-cli article.md ./assets --theme nord
```

### Programmatic API

```javascript
import { convertMarkdown, convertMermaid, THEMES } from '@rongyan/mermaid-plus-cli'

// Convert all mermaid blocks in a markdown file → PNGs, updates file in-place
await convertMarkdown('article.md', './assets', {
  theme: 'github-dark',
  scale: 2,
})

// Convert a single mermaid code string → PNG
await convertMermaid('flowchart LR\n  A --> B --> C', 'diagram.png', {
  theme: 'nord',
  width: 800,
})

// SVG output — no Chrome required
await convertMermaid('flowchart LR\n  A --> B', 'diagram.svg', {
  theme: 'catppuccin-mocha',
})

console.log(Object.keys(THEMES)) // list all 15 theme names
```

---

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `-i, --input <file>` | — | Input file (`.md` or `.mmd`) |
| `-o, --output <file>` | auto | Output file path (single-diagram mode) |
| `-a, --assets <dir>` | `assets` | Image output directory (markdown mode) |
| `-f, --format <fmt>` | `png` | Output format: `png` or `svg` |
| `--theme <name>` | `github-light` | Named theme (see list below) |
| `--bg <color>` | — | Background color override, e.g. `"#ffffff"` |
| `--fg <color>` | — | Foreground / text color override |
| `--font <family>` | — | Font family override (Google Fonts or local) |
| `--transparent` | — | Transparent background |
| `--line <color>` | — | Line / edge color override |
| `--accent <color>` | — | Accent / highlight color override |
| `--muted <color>` | — | Muted / secondary text color override |
| `--surface <color>` | — | Node surface / fill color override |
| `--border <color>` | — | Node border color override |
| `--padding <n>` | — | Internal node padding in pixels |
| `--node-spacing <n>` | — | Horizontal node spacing in pixels |
| `--layer-spacing <n>` | — | Vertical layer spacing in pixels |
| `--width <n>` | `1200` | Render width in pixels |
| `--scale <n>` | `2` | Device pixel ratio (2 = Retina) |
| `--chrome <path>` | auto | Path to Chrome ≥ 112 executable |
| `--font-timeout <ms>` | `8000` | Max wait for web fonts to load |

Color and layout flags override the selected `--theme`.

---

## Themes

15 built-in themes from [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid):

| | |
|:---:|:---:|
| <img src="docs/themes/github-light.png" width="380"><br>`github-light` | <img src="docs/themes/github-dark.png" width="380"><br>`github-dark` |
| <img src="docs/themes/nord.png" width="380"><br>`nord` | <img src="docs/themes/nord-light.png" width="380"><br>`nord-light` |
| <img src="docs/themes/tokyo-night.png" width="380"><br>`tokyo-night` | <img src="docs/themes/tokyo-night-storm.png" width="380"><br>`tokyo-night-storm` |
| <img src="docs/themes/tokyo-night-light.png" width="380"><br>`tokyo-night-light` | <img src="docs/themes/catppuccin-mocha.png" width="380"><br>`catppuccin-mocha` |
| <img src="docs/themes/catppuccin-latte.png" width="380"><br>`catppuccin-latte` | <img src="docs/themes/dracula.png" width="380"><br>`dracula` |
| <img src="docs/themes/one-dark.png" width="380"><br>`one-dark` | <img src="docs/themes/solarized-dark.png" width="380"><br>`solarized-dark` |
| <img src="docs/themes/solarized-light.png" width="380"><br>`solarized-light` | <img src="docs/themes/zinc-light.png" width="380"><br>`zinc-light` |
| <img src="docs/themes/zinc-dark.png" width="380"><br>`zinc-dark` | |

---

## Credits

PNG export is powered by Chrome's native [DevTools Protocol (CDP)](https://chromedevtools.github.io/devtools-protocol/) — the same protocol used by [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp). SVG rendering is powered by [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid).

---

## License

MIT
