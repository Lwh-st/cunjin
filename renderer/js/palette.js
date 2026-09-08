// 寸进 · 壁纸主色 → 整套 UI 配色（互补色系）
// 取壁纸主色 → 主 UI 色用【互补/近互补】色相，保证 UI 与壁纸背景区分开：
//   蓝壁纸 → 橙/琥珀 UI；绿壁纸 → 紫/品红 UI；橙壁纸 → 蓝 UI。
// 面板/边框/文字保留壁纸色相的染色（轻），形成"壁纸决定氛围、互补色负责交互"的双层关系。
// 深浅自适应：壁纸深 → 主色更亮；壁纸浅 → 主色更深。两种绿色壁纸（深绿/浅绿）得到的 UI 必然不同。
'use strict'

const PALETTE = { active: false, current: null }

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return { r: 226, g: 162, b: 75 }
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function hslToHex(h, s, l) {
  const [r, g, b] = hslToRgb(h, s, l)
  return rgbToHex(r, g, b)
}

/* 主色 → 全面板。dominant 平均色代表"壁纸感觉"。 */
function buildPalette(dom) {
  const hsl = rgbToHsl(dom.r, dom.g, dom.b)
  const h = hsl.h
  /* 壁纸饱和/明暗决定"氛围浓度" */
  const vibe = Math.min(1, Math.max(0.2, hsl.s + 0.1 + (hsl.l - 0.5) * -0.15))

  /* --- 互补色相（180°），向"人眼协调边"微调：冷壁纸对暖 UI，暖壁纸对冷 UI --- */
  let accentH = (h + 180) % 360
  if (accentH < 0) accentH += 360
  /* 让互补色更耐看：蓝色(180-260) → 琥珀/橙(30-45)；绿色(60-160) → 品红/紫(280-330) */
  if (h >= 180 && h <= 260) accentH = 25 + (vibe - 0.5) * 20   // 蓝系 → 橙/琥珀
  else if (h >= 60 && h <= 160) accentH = 300 + (vibe - 0.5) * 40 // 绿系 → 紫/品红
  else if (h > 260 && h <= 330) accentH = 85                    // 紫系 → 黄绿
  else if (h > 0 && h < 60) accentH = 195                       // 橙/红 → 青蓝

  const vivid = Math.min(0.75, Math.max(0.42, 0.55 + (hsl.s - 0.45) * 0.3 + (hsl.l - 0.5) * -0.1))
  const accentL = Math.min(0.72, Math.max(0.5, 0.64 - (hsl.l - 0.5) * 0.28))
  const strongL = Math.min(0.88, accentL + 0.14)

  return {
    h,
    /* 互补主色：按钮/高亮/激活态/进度条 */
    accent: hslToHex(accentH, vivid, accentL),
    accentStrong: hslToHex(accentH, Math.min(0.9, vivid + 0.08), strongL),
    accentSoft: { h: accentH, s: vivid, l: accentL, a: 0.18 },
    /* 辅助色：近互补偏一点，用在沙漏上腔/次级强调 */
    secondary: hslToHex((accentH + 32) % 360, Math.min(0.7, vivid - 0.08), Math.min(0.68, accentL - 0.05)),
    secondarySoft: { h: (accentH + 32) % 360, s: Math.min(0.7, vivid - 0.08), l: Math.min(0.68, accentL - 0.05), a: 0.14 },
    /* 文字：近白微染壁纸色调，始终高亮 */
    text: hslToHex(h, Math.min(0.18, vibe * 0.2), Math.min(0.96, Math.max(0.88, 0.92 + (hsl.l - 0.5) * 0.05))),
    /* 次要文字：壁纸色调的中亮灰——必须明显可读（之前太暗） */
    muted: hslToHex(h, Math.min(0.32, vibe * 0.35), Math.min(0.82, Math.max(0.62, 0.72 + (hsl.l - 0.5) * 0.08))),
    /* 面板：壁纸色相的明灰蓝灰玻璃（不再灰黑） */
    panelRgb: hexToRgb(hslToHex(h, Math.min(0.34, vibe * 0.36), Math.min(0.36, Math.max(0.2, 0.28 + (hsl.l - 0.5) * -0.08)))),
    /* 输入框深一档 */
    inputRgb: hexToRgb(hslToHex(h, Math.min(0.3, vibe * 0.32), Math.min(0.3, Math.max(0.16, 0.24 + (hsl.l - 0.5) * -0.06)))),
    /* 渐变底（默认无壁纸时也按壁纸氛围） */
    bgGradTop: hslToHex(h, Math.min(0.3, vibe * 0.3), Math.min(0.2, 0.16 + (hsl.l - 0.5) * -0.05)),
    bgGradBottom: hslToHex(h, Math.min(0.35, vibe * 0.4), Math.min(0.13, 0.1 + (hsl.l - 0.5) * -0.04)),
  }
}

/* 把调色板写进 CSS 变量；同时存一份供悬浮窗复用（persist=false 时只改样式不写盘，供探针/预览用） */
function applyPaletteToCss(p, persist = true) {
  const root = document.documentElement.style
  if (!p) {
    root.setProperty('--accent', '#e2a24b')
    root.setProperty('--accent-strong', '#f0c98c')
    root.setProperty('--accent-soft-color', '226, 162, 75')
    root.setProperty('--secondary', '#7fb069')
    root.setProperty('--secondary-soft-color', '127, 176, 105')
    root.setProperty('--text', '#eceae4')
    root.setProperty('--muted', '#c8c5be')
    root.setProperty('--line', 'rgba(226, 162, 75, 0.22)')
    root.setProperty('--line-soft', 'rgba(226, 162, 75, 0.12)')
    root.setProperty('--panel-rgb', '34, 38, 46')
    root.setProperty('--input-rgb', '255, 255, 255')
    root.setProperty('--bg-top', '#1b2233')
    root.setProperty('--bg-bottom', '#241b13')
    PALETTE.active = false
    if (persist) { try { store.set('palette', null) } catch {} }
    return
  }

  const accentRgb = hexToRgb(p.accent)
  const secondaryRgb = hexToRgb(p.secondary)

  root.setProperty('--accent', p.accent)
  root.setProperty('--accent-strong', p.accentStrong)
  root.setProperty('--accent-soft-color', `${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}`)
  root.setProperty('--secondary', p.secondary)
  root.setProperty('--secondary-soft-color', `${secondaryRgb.r}, ${secondaryRgb.g}, ${secondaryRgb.b}`)
  root.setProperty('--text', p.text)
  root.setProperty('--muted', p.muted)
  /* 边框 = 互补主色的低透明线，处处可见 */
  root.setProperty('--line', `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.28)`)
  root.setProperty('--line-soft', `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.14)`)
  root.setProperty('--panel-rgb', `${p.panelRgb.r}, ${p.panelRgb.g}, ${p.panelRgb.b}`)
  root.setProperty('--input-rgb', '255, 255, 255')
  root.setProperty('--bg-top', p.bgGradTop)
  root.setProperty('--bg-bottom', p.bgGradBottom)
  PALETTE.active = true
  PALETTE.current = p
  if (persist) { try { store.set('palette', p) } catch {} }
}
