// 寸进 · 背景与主题模块（仅主窗口使用）
// 壁纸库浏览（缩略图 + 点击大图预览）、图片/视频/web/场景 scene 背景、
// 透明·跟随桌面模式、组件透明度、滑杆对比条、壁纸主色 → 整套 UI 配色
'use strict'

function initBackground() {
  const bgMedia = $('#bg-media')
  const bgDim = $('#bg-dim')
  const modal = $('#settings-modal')

  const defaultCfg = () => ({
    src: null, kind: 'none', title: '', blur: 8, dim: 30, live: false,
    weType: null, webSrc: null, previewSrc: null, alpha: 0.72, panelBlur: 16,
    theme: 'auto', transparent: false, lib: null, dirPath: null,
  })
  const cfg = () => ({ ...defaultCfg(), ...store.get('bg', {}) })
  const setCfg = (patch) => store.set('bg', { ...cfg(), ...patch })

  let paletteTimer = null

  /* ---------- 背景应用 ---------- */
  function apply() {
    const c = cfg()

    if (c.transparent) {
      $('#bg-layer').style.display = 'none'
      bgMedia.innerHTML = ''
      bgMedia.style.display = 'none'
      bgDim.style.opacity = 0
      return
    }
    $('#bg-layer').style.display = ''
    bgMedia.style.display = ''

    bgMedia.innerHTML = ''
    bgMedia.style.filter = c.src ? 'blur(' + (c.blur ?? 8) + 'px)' : ''
    bgDim.style.opacity = c.src ? (c.dim ?? 30) / 100 : 0
    $('#bg-current').textContent = c.src
      ? '当前背景：' + (c.title || '未命名') + '（' + kindName(c) + '）'
      : '当前背景：默认'

    if (!c.src) { scheduleTheme(); return }

    if (c.kind === 'video') {
      const v = document.createElement('video')
      v.src = c.src
      v.autoplay = true; v.muted = true; v.loop = true; v.playsInline = true
      bgMedia.appendChild(v)
    } else if (c.kind === 'web') {
      const f = document.createElement('iframe')
      f.src = c.src
      f.setAttribute('allow', 'autoplay')
      bgMedia.appendChild(f)
    } else {
      const img = document.createElement('img')
      img.src = c.src
      img.alt = ''
      bgMedia.appendChild(img)
    }
    scheduleTheme()
  }

  function kindName(c) {
    if (c.weType === 'scene') return 'WE 场景（合成画面）'
    if (c.weType === 'web') return 'WE 网页'
    if (c.weType === 'video') return 'WE 视频'
    if (c.kind === 'video') return '视频'
    if (c.kind === 'image') return '图片'
    return c.kind || '未知'
  }

  /* ---------- scene 图层合成（canvas 按 z 序铺贴图） ---------- */
  async function compositeScene(dirPath) {
    const data = await window.cunjin.bg.sceneComposite(dirPath)
    if (!data || !data.layers || !data.layers.length) return null
    const cv = document.createElement('canvas')
    cv.width = data.width; cv.height = data.height
    const ctx = cv.getContext('2d')
    for (const l of data.layers) {
      try {
        const img = new Image()
        await new Promise((res) => {
          img.onload = res
          img.onerror = res
          img.src = l.dataUrl
        })
        if (img.naturalWidth > 0) ctx.drawImage(img, l.px, l.py, l.w, l.h)
      } catch {}
    }
    try { return cv.toDataURL('image/jpeg', 0.92) } catch { return null }
  }

  /* ---------- 壁纸主色 → 整套 UI 配色 ---------- */
  function scheduleTheme() {
    clearTimeout(paletteTimer)
    paletteTimer = setTimeout(applyTheme, 60)
  }

  function applyTheme() {
    const c = cfg()
    /* 仅「主题色=默认」时才用默认色；透明模式（跟随桌面壁纸）也要按壁纸取色，
       否则配色永远回退默认琥珀色（用户反复遇到「怎么换壁纸都是橙色」的根因） */
    if (c.theme === 'default') {
      applyPaletteToCss(null)
      return
    }
    const src = c.palettePath || c.previewPath || null
    if (!src) {
      /* 没有取色源：有已存 palette 就保留（透明模式刚打开/读图失败时），否则默认 */
      const cur = store.get('palette', null)
      if (!cur || !cur.accent) applyPaletteToCss(null)
      return
    }
    /* scene 合成图是 dataURL，没有文件路径可读 */
    if (String(src).startsWith('data:')) { extractPaletteFromDataUrl(src); return }
    window.cunjin.bg.readImage(src).then((dataUrl) => {
      if (!dataUrl) {
        const cur = store.get('palette', null)
        if (cur && cur.accent) return // 读图失败：保留已有配色
        applyPaletteToCss(null)
        return
      }
      extractPaletteFromDataUrl(dataUrl)
    }).catch(() => {
      const cur = store.get('palette', null)
      if (cur && cur.accent) return
      applyPaletteToCss(null)
    })
  }

  /* ---------- 组件透明度 ---------- */
  function applyAlpha() {
    const a = (cfg().alpha ?? 0.72).toFixed(2)
    document.documentElement.style.setProperty('--panel-alpha', a)
  }

  /* ---------- 使用某个壁纸 ---------- */
  async function useWallpaper(w) {
   if (!w || (!w.src && !w.preview)) {
     $('#bg-current').textContent = '没识别到可用的背景（可能缺少预览图）'
     return
   }
   const base = cfg()
   let kind = w.kind
   let src = w.src
   let palettePath = w.previewPath || null
   const dirPath = w.dirFullPath || base.dirPath || null

   if (w.kind === 'scene' && dirPath) {
     $('#bg-current').textContent = '正在解包场景壁纸（首次约 10~60 秒）…'
     const comp = await compositeScene(dirPath)
     if (comp) {
       kind = 'image'
       src = comp
       palettePath = comp // dataURL，主题取色直接识别
     } else {
       const r = await window.cunjin.bg.sceneExtract(dirPath)
       if (r && (r.dataUrl || r.path)) {
         kind = 'image'
         src = r.dataUrl || ('file:///' + r.path.replace(/\\/g, '/'))
         palettePath = r.path || palettePath
       } else {
         kind = 'image'
         src = w.preview || w.src
       }
     }
   } else if (w.kind === 'web' && !base.live) {
     if (w.preview) { kind = 'image'; src = w.preview }
   } else if (w.kind === 'web' && base.live) {
     kind = 'web'; src = w.src
   } else if (w.kind === 'video') {
     kind = 'video'; src = w.src
   }

   if (!src) kind = 'none'
   setCfg({
     kind, src, title: w.title || '', weType: w.weType || null,
     live: base.live, transparent: false, dirPath,
     webSrc: w.weType === 'web' && w.src ? w.src : base.webSrc || null,
     previewSrc: w.preview || base.previewSrc || null,
     previewPath: (!String(palettePath).startsWith('data:')) ? (palettePath || w.previewPath || base.previewPath || null) : null,
     palettePath,
   })
   apply()
   applyAlpha()
   renderLibBrowser()
   }

  /* 直接从 dataURL 取主色（scene 合成图没有文件路径可用） */
  function extractPaletteFromDataUrl(dataUrl) {
    if (!dataUrl) { applyPaletteToCss(null); return }
    const img = new Image()
    img.onload = () => {
      try {
        const cv = document.createElement('canvas')
        const size = 48
        cv.width = size; cv.height = size
        const ctx = cv.getContext('2d')
        ctx.drawImage(img, 0, 0, size, size)
        const d = ctx.getImageData(0, 0, size, size).data
        let r = 0, g = 0, b = 0, w = 0
        for (let i = 0; i < d.length; i += 4) {
          const px = [d[i], d[i + 1], d[i + 2]]
          const hsl = rgbToHsl(px[0], px[1], px[2])
          const wt = 0.15 + hsl.s * 2 * (hsl.l > 0.12 && hsl.l < 0.85 ? 1 : 0.15)
          r += px[0] * wt; g += px[1] * wt; b += px[2] * wt; w += wt
        }
        if (w === 0) { applyPaletteToCss(null); return }
        document.body.classList.add('theme-shift')
        applyPaletteToCss(buildPalette({ r: r / w, g: g / w, b: b / w }))
        setTimeout(() => document.body.classList.remove('theme-shift'), 500)
      } catch {
        applyPaletteToCss(null)
      }
    }
    img.onerror = () => applyPaletteToCss(null)
    img.src = dataUrl
  }

  /* ---------- 壁纸库浏览页（独立弹窗） ---------- */
  const libModal = $('#lib-browser-modal')
  const libGrid = $('#lib-browser-grid')
  const libStatus = $('#lib-browser-status')

  async function openLibBrowser() {
    libModal.classList.remove('hidden')
    await renderLibBrowser()
  }

  async function renderLibBrowser() {
    const c = cfg()
    const lib = store.get('bg:library', null)
    libGrid.innerHTML = ''
    if (!lib || !lib.root) {
      libStatus.textContent = '尚未选择壁纸库'
      libGrid.appendChild(el('div', 'lib-empty', '先在设置里点「选择壁纸库…」，选择 Wallpaper Engine 壁纸目录（通常是 steamapps\\workshop\\content\\431960）'))
      return
    }
    libStatus.textContent = '扫描中…'
    const res = await window.cunjin.bg.rescan(lib.root)
    const items = res?.items || []
    libStatus.textContent = items.length ? items.length + ' 张壁纸 · 点击查看大图' : '目录里没找到壁纸'
    items.forEach((w) => {
      const item = el('div', 'lib-item' + (c.src && (w.src === c.src || w.preview === c.src) ? ' on' : ''))
      const nameBox = el('div', 'lib-name', '加载中…')
      const img = document.createElement('img')
      img.alt = ''
      img.loading = 'lazy'
      /* 加载失败的占位：图标 + 名称，不再出现"线条" */
      img.onerror = () => {
        img.style.display = 'none'
        nameBox.textContent = (w.title || w.dir) + '（无预览）'
        nameBox.style.color = 'var(--muted)'
        item.classList.add('lib-noimg')
      }
      item.append(img, nameBox)
      libGrid.appendChild(item)
      item.addEventListener('click', () => openLibPreview(w))
      /* 缩略图：jpg/png 主进程缩放；gif 给 file:// URL；scene 解包贴图 */
      window.cunjin.bg.thumb(w.dirFullPath || w.dir).then((dataUrl) => {
        if (dataUrl) { img.src = dataUrl; nameBox.textContent = w.title || w.dir }
        else if (!img.src) { img.dispatchEvent(new Event('error')) }
      }).catch(() => {
        if (!img.src) img.dispatchEvent(new Event('error'))
      })
    })
  }

  $('#bg-open-library').addEventListener('click', () => openLibBrowser())
  $('#lib-browser-close').addEventListener('click', () => libModal.classList.add('hidden'))
  $('#lib-browser-rescan').addEventListener('click', () => renderLibBrowser())
  libModal.addEventListener('click', (e) => {
    if (e.target === libModal) libModal.classList.add('hidden')
  })

  /* 点击缩略图 → 打开大图预览（scene 会合成显示原画面） */
  const previewModal = $('#lib-preview-modal')
  const previewImg = $('#lib-preview-img')
  const previewName = $('#lib-preview-name')
  const previewStatus = $('#lib-preview-status')
  let previewCurrent = null

  async function openLibPreview(w) {
    previewCurrent = w
    previewName.textContent = w.title || w.dir
    previewStatus.textContent = ''
    previewImg.src = ''
    previewModal.classList.add('open')
    if (w.weType === 'scene' && w.dirFullPath) {
      previewStatus.textContent = 'scene 壁纸：正在合成原始画面…'
      const comp = await compositeScene(w.dirFullPath)
      if (comp) {
        previewImg.src = comp
        previewStatus.textContent = '已按原布局合成（静态画面；动画效果需 Wallpaper Engine 渲染）'
      } else {
        fbx(w)
      }
    } else {
      fbx(w)
    }
    function fbx(w2) {
      if (w2.preview) { previewImg.src = w2.preview; previewStatus.textContent = '（预览图）' }
      else { previewStatus.textContent = '没有预览图' }
    }
  }

  $('#lib-preview-apply').addEventListener('click', () => {
    if (previewCurrent) useWallpaper(previewCurrent)
    /* 应用后自动关闭预览，返回壁纸库（问题：之前只应用不关闭） */
    previewModal.classList.remove('open')
  })
  $('#lib-preview-close').addEventListener('click', () => previewModal.classList.remove('open'))

  /* ---------- 原地对比模式：按下滑杆 → 设置页整体隐形，仅当前滑杆留在原位 ----------
     原理：用 visibility（不是 display/fixed/DOM 移动），布局完全不变 → 滑杆位置绝对不变、
     永远是同一个元素，拖动连续不中断；设置页背景透明，看起来消失了。 */
  function enterCompare(row) {
    modal.classList.add('compare-mode')
    row.classList.add('cmp-live')
    row.querySelector('input')?.focus()
  }
  function exitCompare() {
    modal.classList.remove('compare-mode')
    $$('.cmp-live').forEach((r) => r.classList.remove('cmp-live'))
  }

  /* 滑杆直接在模态里保持原位；背景半透明露出主界面 */
  function bindCompare(sliderId) {
    const slider = $(sliderId)
    const row = slider.closest('.set-row')
    slider.addEventListener('pointerdown', () => enterCompare(row))
    /* 兜底：按住没拖动就松开（change 不触发），也要退出对比 */
    slider.addEventListener('pointerup', () => {
      if (modal.classList.contains('compare-mode')) exitCompare()
    })
  }

  /* ✅ 完成按钮已移除；松手（change）自动持久化并退出对比，无需手动确认 */
  /* 拖动结束（松开）并持久化，然后退出对比 */
  ;['#bg-blur', '#bg-dim-range', '#bg-alpha', '#bg-panel-blur'].forEach((id) => {
    const s = $(id)
    s.addEventListener('change', () => {
      // change 时持久化完整配置（UI 百分比 → 内部值）
      const c = cfg()
      c.blur = Math.round((parseInt($('#bg-blur').value, 10) / 100) * 24)
      c.dim = Math.round((parseInt($('#bg-dim-range').value, 10) / 100) * 80)
      c.alpha = parseInt($('#bg-alpha').value, 10) / 100
      c.panelBlur = Math.round((parseInt($('#bg-panel-blur').value, 10) / 100) * 40)
      setCfg(c)
      apply()
      applyAlpha()
      applyPanelBlurLive(parseInt($('#bg-panel-blur').value, 10))
      exitCompare()
    })
  })

  /* ---------- 事件绑定（齿轮/关闭由 app.js 统一管理，避免重复监听导致状态错乱） ---------- */
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeSettings()
  })
  window.__renderLib = renderLibBrowser

  $('#bg-pick-folder').addEventListener('click', async () => {
    const w = await window.cunjin.bg.pickFolder()
    if (w) useWallpaper(w)
  })
  $('#bg-pick-file').addEventListener('click', async () => {
    const w = await window.cunjin.bg.pickFile()
    if (w) useWallpaper(w)
  })
  $('#bg-pick-library').addEventListener('click', async () => {
    const res = await window.cunjin.bg.pickLibrary()
    if (res) {
      store.set('bg:library', { root: res.root })
      renderLibBrowser()
    }
  })

  const blurRange = $('#bg-blur')
  const dimRange = $('#bg-dim-range')
  const alphaRange = $('#bg-alpha')
  const panelBlurRange = $('#bg-panel-blur')
  /* UI 全部按 0-100%：内部换算（blur: 0-24px, dim: 0-80%, alpha: 0-1, panelBlur: 0-40px） */
  blurRange.value = Math.round(((cfg().blur ?? 8) / 24) * 100)
  dimRange.value = Math.round(((cfg().dim ?? 30) / 80) * 100)
  alphaRange.value = Math.round(((cfg().alpha ?? 0.72)) * 100)
  panelBlurRange.value = Math.round(((cfg().panelBlur ?? 16) / 40) * 100)

  /* 拖动中：只轻量改样式（不重建背景媒体、不写盘），松手/完成时才持久化 → 不卡 */
  function applyBlurLive(pct) {
    bgMedia.style.filter = pct > 0 ? 'blur(' + (pct * 0.24).toFixed(1) + 'px)' : ''
  }
  function applyDimLive(pct) {
    bgDim.style.opacity = (pct * 0.8) / 100
  }
  function applyAlphaLive(pct) {
    document.documentElement.style.setProperty('--panel-alpha', pct / 100)
  }
  function applyPanelBlurLive(pct) {
    document.documentElement.style.setProperty('--panel-blur', (pct * 0.4).toFixed(1) + 'px')
  }
  /* 滑杆填充色 = 当前值比例（轨道左侧高亮） */
  function paintRangeFill(input) {
    const r = (parseFloat(input.value) - parseFloat(input.min)) / (parseFloat(input.max) - parseFloat(input.min))
    input.style.setProperty('--fill', (r * 100).toFixed(0) + '%')
  }
  function syncRangeVal(input, valEl, unit) {
    valEl.textContent = input.value + unit
  }
  const valMap = [
    [blurRange, $('#bg-blur-val'), '', applyBlurLive],
    [dimRange, $('#bg-dim-val'), '%', applyDimLive],
    [alphaRange, $('#bg-alpha-val'), '%', applyAlphaLive],
    [panelBlurRange, $('#bg-panel-blur-val'), '', applyPanelBlurLive],
  ]
  valMap.forEach(([range, valEl, unit, live]) => {
    paintRangeFill(range)
    syncRangeVal(range, valEl, unit)
    range.addEventListener('input', () => {
      live(parseInt(range.value, 10))
      paintRangeFill(range)
      syncRangeVal(range, valEl, unit)
    })
  })
  /* change（松手）→ 由下方对比模式 change 监听统一持久化 + 退出对比 */

  /* 对比模式接管滑杆拖动 */
  bindCompare('#bg-blur')
  bindCompare('#bg-dim-range')
  bindCompare('#bg-alpha')
  bindCompare('#bg-panel-blur')

  /* 透明·跟随桌面模式 */
  const transCheck = $('#bg-transparent')
  transCheck.checked = !!cfg().transparent
  transCheck.addEventListener('change', () => {
    const c = cfg()
    c.transparent = transCheck.checked
    setCfg(c)
    apply()
  })

  /* 动态嵌入 web 壁纸 */
  const liveCheck = $('#bg-live')
  liveCheck.checked = !!cfg().live
  liveCheck.addEventListener('change', () => {
    const c = cfg()
    c.live = liveCheck.checked
    if (c.weType === 'web') {
      if (c.live && c.webSrc) { c.kind = 'web'; c.src = c.webSrc; c.transparent = false; transCheck.checked = false }
      else if (!c.live && c.previewSrc) { c.kind = 'image'; c.src = c.previewSrc }
    }
    setCfg(c)
    apply()
  })

  /* 侧栏位置 */
  const sideSel = $('#ui-sidebar')
  sideSel.value = store.get('ui:sidebar', 'left')
  sideSel.addEventListener('change', () => {
    store.set('ui:sidebar', sideSel.value)
    // 触发主窗口重新应用布局
    applySidebarLayout()
  })

  /* 主题模式 */
  const themeSel = $('#bg-theme')
  themeSel.value = cfg().theme || 'auto'
  themeSel.addEventListener('change', () => {
    const c = cfg(); c.theme = themeSel.value; setCfg(c); applyTheme()
  })

  $('#bg-clear').addEventListener('click', () => {
    setCfg({ src: null, kind: 'none', title: '', weType: null, live: false, webSrc: null, previewSrc: null, previewPath: null, palettePath: null, transparent: false, dirPath: null })
    liveCheck.checked = false
    transCheck.checked = false
    apply()
    renderLibBrowser()
  })

  applyAlpha()
  applyPanelBlurLive(panelBlurRange.value || (cfg().panelBlur ?? 16))
  apply()
}
