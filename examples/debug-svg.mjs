import { renderMermaidSVG, THEMES } from 'beautiful-mermaid'
import { writeFileSync } from 'fs'

const THEME = THEMES['github-light']

const flowchart = `graph TD
    A["大语言模型 LLM<br/>预测下一个 token"] -->|"套上推理增强"| B["推理模型<br/>thinking 过程更长、更深"]
    B -->|"套上控制循环"| C["Agent<br/>能决定：看什么、调什么工具、什么时候停"]
    C -->|"套上任务专用脚手架"| D["编程 Agent<br/>能在真实代码库里干活"]

    style A fill:#f0f0f0
    style B fill:#dde8f5
    style C fill:#b8d4f0
    style D fill:#4a90d9,color:#fff`

const svg = renderMermaidSVG(flowchart, THEME)
writeFileSync('/tmp/debug-flow.svg', svg)
console.log('SVG saved to /tmp/debug-flow.svg')
console.log('SVG length:', svg.length)
// 打印前500字符看结构
console.log(svg.slice(0, 800))
