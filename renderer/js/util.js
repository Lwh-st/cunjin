// 寸进 · 公共工具：存储、通知、格式化、DOM、颜色
'use strict'

/* 全局错误兜底：渲染层任何异常都转发到主进程终端 */
window.addEventListener('error', (e) => console.log('[page-error]', e.message, e.filename + ':' + e.lineno))
window.addEventListener('unhandledrejection', (e) => console.log('[page-reject]', String(e.reason && e.reason.message || e.reason)))

const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]

/* ---------- 跨窗口共享 store：本地缓存 + IPC 读写主进程，主窗口/浮窗同一份数据 ---------- */
const storeCache = new Map()
/* 启动时把主进程已有的 store 全量拉下来（localStorage 兜底，浮窗首次拿主窗口数据靠它） */
function initStore() {
  try {
    if (window.cunjin?.store) {
      window.cunjin.store.onChange((key, value) => {
        storeCache.set(key, value)
        // 触发页面按需重渲染（各模块可监听）
        document.dispatchEvent(new CustomEvent('store-changed', { detail: { key, value } }))
      })
    }
  } catch {}
}
const store = {
  get(key, fallback) {
    // 内存缓存优先；缓存没有时回退 localStorage（两窗口启动序不同，先读本地兜底）
    if (storeCache.has(key)) return storeCache.get(key)
    try {
      const v = JSON.parse(localStorage.getItem('cunjin:' + key))
      if (v != null) {
        storeCache.set(key, v)
        return v
      }
    } catch {}
    return fallback
  },
  set(key, val) {
    storeCache.set(key, val)
    try { localStorage.setItem('cunjin:' + key, JSON.stringify(val)) } catch {}
    try { window.cunjin?.store?.set(key, val) } catch {}
    try { window.cunjin?.dataChanged() } catch {}
  },
}
/* 异步预热：主进程数据 → 本地缓存（浮窗因此能读到主窗口写的数据） */
if (window.cunjin?.store) {
  initStore()
  // 一次性拉一份全量（有则覆盖本地缓存，无则跳过）
  ;(async () => {
    try {
      const keys = await window.cunjin.store.get('__all__')
      if (keys && typeof keys === 'object') {
        for (const [k, v] of Object.entries(keys)) storeCache.set(k, v)
      }
      // 迁移：把本窗口 localStorage 里主进程还没有的键写进主进程（两窗口数据从此统一）
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k || !k.startsWith('cunjin:')) continue
        const key = k.slice('cunjin:'.length)
        if (!storeCache.has(key)) {
          try {
            storeCache.set(key, JSON.parse(localStorage.getItem(k)))
            window.cunjin.store.set(key, storeCache.get(key))
          } catch {}
        }
      }
      document.dispatchEvent(new Event('store-ready'))
    } catch {}
  })()
}

/* 本窗口是否主窗口（只有主窗口发系统通知，避免双窗口重复提醒） */
const IS_MAIN = !!document.querySelector('#panels')

function notify(title, body) {
  // 优先系统通知（主进程 Electron Notification）：最小化/后台也能看到
  try { window.cunjin?.notify?.(title, body) } catch {}
  // 兜底：页面 Notification（无 preload 时用）
  if (!window.cunjin?.notify) {
    if (!('Notification' in window)) return
    if (Notification.permission === 'granted') new Notification(title, { body })
    else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => { if (p === 'granted') new Notification(title, { body }) })
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

/* 秒级向上取整，mm:ss 或 h:mm:ss */
function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const two = (n) => String(n).padStart(2, '0')
  return h > 0 ? h + ':' + two(m) + ':' + two(sec) : two(m) + ':' + two(sec)
}

/* 秒 → 可读间隔文本（如 "1分30秒" / "45秒"） */
function fmtEvery(sec) {
  const s = Math.max(0, Math.round(parseFloat(sec) || 0))
  if (s < 60) return s + ' 秒'
  const m = Math.floor(s / 60), r = s % 60
  return r ? m + ' 分 ' + r + ' 秒' : m + ' 分钟'
}

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

/* ---------- 颜色工具（壁纸取色用） ---------- */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  const d = max - min
  if (d > 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0))
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h, s, l }
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

/* ---------- 悬浮窗/窗口通用：边缘拖拽调整大小 ---------- */
function bindResizeHandles() {
  $$('.resize-handle').forEach((h) => {
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      h.setPointerCapture(e.pointerId)
      /* 关键：用「屏幕绝对坐标」作为基准（按下瞬间记录），窗口变大不影响它；
         若用视口坐标，窗口变化会导致坐标漂移 → 转圈后窗口只增不减 */
      window.cunjin?.window.resizeBegin(h.dataset.edge, e.screenX, e.screenY)
      const move = (ev) => {
        window.cunjin?.window.resizeMove(ev.screenX, ev.screenY)
      }
      const end = () => {
        window.cunjin?.window.resizeEnd()
        h.removeEventListener('pointermove', move)
        h.removeEventListener('pointercancel', end)
        h.removeEventListener('pointerup', end)
      }
      h.addEventListener('pointermove', move)
      h.addEventListener('pointerup', end)
      h.addEventListener('pointercancel', end)
    })
  })
}

/* 跨窗口数据同步：主进程广播 → 重渲染 */
function onRemoteDataChanged(cb) {
  try { window.cunjin?.onDataChanged(cb) } catch {}
}

/* ---------- 标准调色盘（仿系统取色器：方形选区 + 横向色相条 + RGB 数字输入） ---------- */
function hsvToRgb(h, s, v) {
  s = Math.max(0, Math.min(1, s)); v = Math.max(0, Math.min(1, v))
  h = ((h % 360) + 360) % 360
  const c = v * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x } else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x } else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c } else { r = c; b = x }
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) }
}
function rgbToHexObj({ r, g, b }) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  if (h < 0) h += 360
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

/* 返回 { el, setValue(hex), getValue()=>hex }。
   结构：上方=方形选区（X=饱和度，Y=明度），下方=横向色相条 + RGB 输入框 + 预览。 */
function buildColorWheel(size = 230, initial = '#e2a24b') {
  const wrap = el('div', 'color-wheel-wrap')
  /* --- 当前色状态 --- */
  let cur = rgbToHsv(226, 162, 75)
  const setFromHex = (hex) => {
    const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
    if (!m) return
    const n = parseInt(m[1], 16)
    cur = rgbToHsv((n >> 16) & 255, (n >> 8) & 255, n & 255)
    paintAll()
  }
  const hexOf = () => rgbToHexObj(hsvToRgb(cur.h, cur.s, cur.v))

  /* --- 方形选区（X=饱和度，Y=明度） --- */
  const svc = document.createElement('canvas')
  svc.width = 300; svc.height = 180
  svc.classList.add('color-sv')
  const sctx = svc.getContext('2d')
  let dotX = 0, dotY = 0
  function paintSV() {
    // 底色 = 当前色相；上白下黑渐变
    const base = hsvToRgb(cur.h, 1, 1)
    const g = sctx.createLinearGradient(0, 0, svc.width, 0)
    g.addColorStop(0, '#fff'); g.addColorStop(1, `rgb(${base.r},${base.g},${base.b})`)
    sctx.fillStyle = `rgb(${base.r},${base.g},${base.b})`
    sctx.fillRect(0, 0, svc.width, svc.height)
    const wg = sctx.createLinearGradient(0, 0, svc.width, 0)
    wg.addColorStop(0, 'rgba(255,255,255,1)'); wg.addColorStop(1, 'rgba(255,255,255,0)')
    sctx.fillStyle = wg
    sctx.fillRect(0, 0, svc.width, svc.height)
    const bg = sctx.createLinearGradient(0, 0, 0, svc.height)
    bg.addColorStop(0, 'rgba(0,0,0,0)'); bg.addColorStop(1, 'rgba(0,0,0,1)')
    sctx.fillStyle = bg
    sctx.fillRect(0, 0, svc.width, svc.height)
    // 指示器
    dotX = cur.s * svc.width
    dotY = (1 - cur.v) * svc.height
    sctx.beginPath()
    sctx.arc(dotX, dotY, 7, 0, Math.PI * 2)
    sctx.strokeStyle = '#fff'; sctx.lineWidth = 3; sctx.stroke()
    sctx.beginPath()
    sctx.arc(dotX, dotY, 7, 0, Math.PI * 2)
    sctx.strokeStyle = 'rgba(0,0,0,0.55)'; sctx.lineWidth = 1.5; sctx.stroke()
  }
  svc.addEventListener('pointerdown', (e) => svc.setPointerCapture(e.pointerId))
  svc.addEventListener('pointermove', (e) => {
    if (!e.buttons) return
    const r = svc.getBoundingClientRect()
    cur.s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    cur.v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))
    paintAll()
  })
  svc.addEventListener('click', (e) => {
    const r = svc.getBoundingClientRect()
    cur.s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    cur.v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))
    paintAll()
  })

  /* --- 横向色相条 --- */
  const huec = document.createElement('canvas')
  huec.width = 300; huec.height = 16
  huec.classList.add('color-hue')
  const hctx = huec.getContext('2d')
  let hueDotX = 0
  function paintHue() {
    const g = hctx.createLinearGradient(0, 0, huec.width, 0)
    ;[0, 60, 120, 180, 240, 300, 360].forEach((h, i, arr) => {
      const c = hsvToRgb(h, 1, 1)
      g.addColorStop(i / (arr.length - 1), `rgb(${c.r},${c.g},${c.b})`)
    })
    hctx.fillStyle = g
    hctx.fillRect(0, 0, huec.width, huec.height)
    hueDotX = (cur.h / 360) * huec.width
    hctx.beginPath()
    hctx.arc(hueDotX, huec.height / 2, 6, 0, Math.PI * 2)
    hctx.strokeStyle = '#fff'; hctx.lineWidth = 3; hctx.stroke()
    hctx.beginPath()
    hctx.arc(hueDotX, huec.height / 2, 6, 0, Math.PI * 2)
    hctx.strokeStyle = 'rgba(0,0,0,0.5)'; hctx.lineWidth = 1.5; hctx.stroke()
  }
  huec.addEventListener('pointerdown', (e) => huec.setPointerCapture(e.pointerId))
  huec.addEventListener('pointermove', (e) => {
    if (!e.buttons) return
    const r = huec.getBoundingClientRect()
    cur.h = ((e.clientX - r.left) / r.width) * 360
    paintAll()
  })
  huec.addEventListener('click', (e) => {
    const r = huec.getBoundingClientRect()
    cur.h = ((e.clientX - r.left) / r.width) * 360
    paintAll()
  })

  /* --- RGB 输入 + 预览 --- */
  const bottom = el('div', 'color-bottom')
  const preview = el('div', 'color-preview')
  const rInp = el('input', 'color-rgb'); rInp.type = 'number'; rInp.min = 0; rInp.max = 255
  const gInp = el('input', 'color-rgb'); gInp.type = 'number'; gInp.min = 0; gInp.max = 255
  const bInp = el('input', 'color-rgb'); bInp.type = 'number'; bInp.min = 0; bInp.max = 255
  const hexInp = el('input', 'color-hex'); hexInp.type = 'text'; hexInp.maxLength = 7
  let inputCb = null
  function paintAll() {
    paintSV()
    paintHue()
    const rgb = hsvToRgb(cur.h, cur.s, cur.v)
    const hex = rgbToHexObj(rgb)
    preview.style.background = hex
    rInp.value = rgb.r; gInp.value = rgb.g; bInp.value = rgb.b
    hexInp.value = hex
    if (inputCb) inputCb(hex)
  }
  ;[rInp, gInp, bInp].forEach((inp) => {
    inp.addEventListener('change', () => {
      const rgb = {
        r: Math.max(0, Math.min(255, parseInt(rInp.value, 10) || 0)),
        g: Math.max(0, Math.min(255, parseInt(gInp.value, 10) || 0)),
        b: Math.max(0, Math.min(255, parseInt(bInp.value, 10) || 0)),
      }
      cur = rgbToHsv(rgb.r, rgb.g, rgb.b)
      paintAll()
    })
  })
  hexInp.addEventListener('change', () => {
    if (/^#([0-9a-fA-F]{6})$/.test(hexInp.value.trim())) setFromHex(hexInp.value.trim())
  })
  // 原生取色器兜底
  const native = el('input', 'color-native')
  native.type = 'color'
  native.addEventListener('input', () => setFromHex(native.value))

  bottom.append(preview, rInp, gInp, bInp, hexInp)
  wrap.append(svc, huec, bottom)
  setFromHex(initial)

  return {
    el: wrap,
    setValue: setFromHex,
    getValue: () => hexOf(),
    setNative: (hex) => { native.value = hex },
    onChange: (cb) => { inputCb = cb },
  }
}

/* ---------- 自定义下拉列表（原生 select 弹出的选项列表是系统渲染，CSS 改不了，只能自绘） ---------- */
function enhanceSelects(root = document) {
  $$('select', root).forEach((sel) => {
    if (sel.__enhanced) return
    sel.__enhanced = true
    const wrap = el('div', 'cs-wrap')
    sel.style.display = 'none'
    sel.parentNode.insertBefore(wrap, sel)
    wrap.appendChild(sel)

    const btn = el('button', 'cs-btn', sel.options[sel.selectedIndex]?.textContent || sel.value)
    btn.type = 'button'
    const menu = el('div', 'cs-menu')
    const render = (val) => {
      btn.textContent = sel.options[sel.selectedIndex]?.textContent || '—'
      $$('.cs-option', menu).forEach((o) => o.classList.toggle('on', o.dataset.value === String(sel.value)))
    }
    Array.from(sel.options).forEach((o) => {
      const item = el('div', 'cs-option', o.textContent)
      item.dataset.value = o.value
      item.addEventListener('click', () => {
        sel.value = item.dataset.value
        render()
        menu.classList.remove('open')
        sel.dispatchEvent(new Event('change', { bubbles: true }))
      })
      menu.appendChild(item)
    })
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const wasOpen = menu.classList.contains('open')
      $$('.cs-menu.open').forEach((m) => m.classList.remove('open'))
      if (!wasOpen) menu.classList.add('open')
    })
    wrap.append(btn, menu)
    wrap.addEventListener('click', (e) => e.stopPropagation())
    const close = () => menu.classList.remove('open')
    document.addEventListener('click', close)
    sel.addEventListener('change', () => render())
    render(sel.value)
  })
}
