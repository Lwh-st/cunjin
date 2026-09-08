// 寸进 · 主进程：无边框透明置顶窗 + 悬浮窗 + 壁纸库 + 记忆设置
const { app, BrowserWindow, ipcMain, dialog, session } = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

/* ---------- 打包版数据目录：exe 旁边的 data/ 文件夹（绿色免安装，数据随软件走） ---------- */
if (app.isPackaged) {
  const exeDir = path.dirname(process.execPath)
  const dataDir = path.join(exeDir, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  /* 首次迁移：只搬关键数据（设置 + Local Storage + pkg-cache），跳过 Chromium 缓存目录
     ——缓存被运行中的旧实例占用会导致 EACCES，且缓存本来就可重建 */
  try {
    const legacy = path.join(process.env.APPDATA, '寸进')
    const migratedMarker = path.join(dataDir, '.migrated')
    const VITAL = ['Local Storage', 'Session Storage', 'IndexedDB', 'Preferences', 'settings.json', 'pkg-cache']
    if (fs.existsSync(legacy) && !fs.existsSync(migratedMarker)) {
      for (const name of VITAL) {
        const src = path.join(legacy, name)
        if (!fs.existsSync(src)) continue
        try {
          fs.cpSync(src, path.join(dataDir, name), { recursive: true, force: true })
        } catch (e) {
          // 单个文件/目录失败不影响其它
        }
      }
      fs.writeFileSync(migratedMarker, '1')
      console.log('[cunjin] migrated user data from', legacy)
    }
  } catch (e) {
    console.error('[cunjin] migration skipped:', e.message)
  }
  app.setPath('userData', dataDir)
}

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])
const VID_EXT = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi'])

/* ---------- 单实例锁：防止重复启动出多个窗口，导致点击错乱/按钮失灵 ---------- */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.show()
      mainWin.focus()
    } else if (widgetWin && !widgetWin.isDestroyed() && widgetWin.isVisible()) {
      widgetWin.focus()
    }
  })
}

let mainWin = null
let widgetWin = null
let isQuitting = false

/* ---------- 设置持久化（userData/settings.json） ---------- */
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json')
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))
  } catch {
    return {}
  }
}
function saveSettings(s) {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2))
  } catch {}
}
const settings = loadSettings()

/* ---------- 跨窗口共享 store：主窗口/浮窗天然同一份数据 ---------- */
/* 渲染层 store.get/set 走 IPC；数据存在主进程内存 + settings.json，
   这样主窗口和悬浮窗读写的是同一份，彻底解决 localStorage 各窗口独立的问题 */
const mainStore = new Map(Object.entries(settings.store || {}))
let storeSaveTimer = null
function persistStore() {
  clearTimeout(storeSaveTimer)
  storeSaveTimer = setTimeout(() => {
    settings.store = Object.fromEntries(mainStore)
    saveSettings(settings)
  }, 300)
}
ipcMain.handle('store:get', (_e, key) => {
  if (key === '__all__') return Object.fromEntries(mainStore)
  return mainStore.has(key) ? mainStore.get(key) : null
})
ipcMain.handle('store:set', (_e, key, value) => {
  mainStore.set(key, value)
  persistStore()
  // 广播给其它窗口（本地窗口自己已更新）
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.webContents !== _e.sender) w.webContents.send('store-changed', key, value)
  }
  return true
})

let saveTimer = null
function persistBounds(win, key) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      settings[key] = win.getBounds()
      saveSettings(settings)
    } catch {}
  }, 500)
}

/* ---------- 壁纸解析 ---------- */
/* RePKG：解包 scene.pkg 用（开源的 WE PKG 解包工具，随应用放在 tools/repkg/）
   打包后 tools 通过 extraResources 拷到 resources/tools，路径要切换 */
const REPKG_EXE = app.isPackaged
  ? path.join(process.resourcesPath, 'tools', 'repkg', 'RePKG.exe')
  : path.join(__dirname, 'tools', 'repkg', 'RePKG.exe')
const PKG_CACHE_DIR = () => path.join(app.getPath('userData'), 'pkg-cache')

function findPreview(dir) {
  for (const name of ['preview.jpg', 'preview.jpeg', 'preview.png', 'preview.gif']) {
    const p = path.join(dir, name)
    if (fs.existsSync(p)) return p
  }
  try {
    const first = fs.readdirSync(dir).find((f) => IMG_EXT.has(path.extname(f).toLowerCase()))
    if (first) return path.join(dir, first)
  } catch {}
  return null
}

function parseWallpaperFolder(dir) {
  let meta = null
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'))
  } catch {}
  const weType = (meta && meta.type) || null
  const previewFile = findPreview(dir)
  const preview = previewFile ? pathToFileURL(previewFile).href : null
  const title = (meta && meta.title) || path.basename(dir)

  if (weType === 'video' && meta.file) {
    const v = path.join(dir, meta.file)
    if (fs.existsSync(v)) {
      return { kind: 'video', src: pathToFileURL(v).href, srcPath: v, preview, previewPath: previewFile, title, weType, dir: path.basename(dir) }
    }
  }
  if (weType === 'web') {
    const entry = path.join(dir, meta.file || 'index.html')
    return { kind: 'web', src: fs.existsSync(entry) ? pathToFileURL(entry).href : null, srcPath: entry, preview, previewPath: previewFile, title, weType, dir: path.basename(dir) }
  }
  if (weType === 'scene') {
    return { kind: 'scene', src: preview, srcPath: previewFile, preview, previewPath: previewFile, title, weType, dir: path.basename(dir) }
  }
  if (previewFile) {
    return { kind: 'image', src: preview, srcPath: previewFile, preview, previewPath: previewFile, title, weType, dir: path.basename(dir) }
  }
  try {
    const v = fs.readdirSync(dir).map((f) => path.join(dir, f)).find((p) => VID_EXT.has(path.extname(p).toLowerCase()))
    if (v) return { kind: 'video', src: pathToFileURL(v).href, srcPath: v, preview: null, previewPath: null, title, weType, dir: path.basename(dir) }
  } catch {}
  return { kind: 'none', src: null, srcPath: null, preview: null, previewPath: null, title, weType, dir: path.basename(dir) }
}

/* 解包 scene.pkg：RePKG 提取贴图到缓存，返回最佳"全屏背景"图
   注意：RePKG 可能耗时 10~60 秒，必须异步执行（spawn），绝不能同步阻塞主进程。 */
function extractScenePkg(dir) {
  return new Promise((resolve) => {
    try {
      const pkgName = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.pkg'))
      if (!pkgName) return resolve(null)
      const pkgPath = path.join(dir, pkgName)
      const cacheKey = path.basename(dir) + '-' + (fs.statSync(pkgPath).size || '')
      const cacheDir = path.join(PKG_CACHE_DIR(), cacheKey)
      const bestMarker = path.join(cacheDir, '.best.json')

      const finish = () => {
        try {
          const pngs = []
          const walk = (d) => {
            for (const f of fs.readdirSync(d)) {
              const p = path.join(d, f)
              const st = fs.statSync(p)
              if (st.isDirectory()) walk(p)
              else if (/\.(png|jpg)$/i.test(f)) pngs.push(p)
            }
          }
          const outDir = path.join(cacheDir, 'output')
          if (fs.existsSync(outDir)) walk(outDir)
          if (!pngs.length) return resolve(null)

          const { nativeImage } = require('electron')
          const best = pngs
            .map((p) => {
              const img = nativeImage.createFromPath(p)
              const size = img.getSize()
              let score = size.width * size.height
              const name = path.basename(p).toLowerCase()
              if (/天空|背景|skys?|back(g|drop)|base|full|scene/i.test(name)) score *= 10
              const ratio = size.height > 0 ? size.width / size.height : 0
              if (ratio > 1.5 && ratio < 2.4) score *= 2
              return { p, w: size.width, h: size.height, score }
            })
            .sort((a, b) => b.score - a.score)[0]

          fs.writeFileSync(bestMarker, JSON.stringify({ p: best.p }))
          resolve({ png: best.p, width: best.w, height: best.h })
        } catch (e) {
          console.error('[cunjin] extractScenePkg pick failed:', e.message)
          resolve(null)
        }
      }

      if (fs.existsSync(path.join(cacheDir, 'output')) && fs.existsSync(bestMarker)) {
        return finish() // 已缓存
      }

      fs.mkdirSync(cacheDir, { recursive: true })
      const localPkg = path.join(cacheDir, 'scene.pkg')
      fs.copyFileSync(pkgPath, localPkg)

      const { execFile, execFileSync } = require('child_process')
      // 同步预热：确保 RePKG.exe 可执行（若被杀软拦截会立刻抛错）
      try {
        execFileSync(REPKG_EXE, ['version'], { timeout: 15000, stdio: 'pipe' })
      } catch (e) {
        console.error('[cunjin] RePKG not runnable:', e.message)
        fs.rmSync(localPkg, { force: true })
        return resolve(null)
      }

      execFile(REPKG_EXE, ['extract', 'scene.pkg'], { cwd: cacheDir, timeout: 180000 }, (err) => {
        fs.rmSync(localPkg, { force: true })
        if (err && err.code !== 0 && !fs.existsSync(path.join(cacheDir, 'output'))) {
          console.error('[cunjin] RePKG extract failed:', err.message)
          return resolve(null)
        }
        finish()
      })
    } catch (e) {
      console.error('[cunjin] extractScenePkg failed:', e.message)
      resolve(null)
    }
  })
}

/* scene 图层布局解析：读 scene.json + model/material json，按 z 序输出
   每层：贴图路径、绘制位置(px,py)、尺寸(w,h) —— 渲染进程按此用 canvas 合成 */
function parseSceneLayout(dir) {
  const cacheKey = path.basename(dir) + '-layout'
  const layoutPath = path.join(PKG_CACHE_DIR(), cacheKey + '.json')
  if (fs.existsSync(layoutPath)) {
    try { return JSON.parse(fs.readFileSync(layoutPath, 'utf8')) } catch {}
  }
  const pkgName = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.pkg'))
  if (!pkgName) return null
  const cacheKey2 = path.basename(dir) + '-' + (fs.statSync(path.join(dir, pkgName)).size || '')
  const cacheDir = path.join(PKG_CACHE_DIR(), cacheKey2)
  const outDir = path.join(cacheDir, 'output')
  const sceneJson = path.join(outDir, 'scene.json')
  if (!fs.existsSync(sceneJson)) return null

  try {
    const scene = JSON.parse(fs.readFileSync(sceneJson, 'utf8'))
    const objs = scene.objects || []
    const layers = []
    for (const o of objs) {
      try {
        const imgPath = o.image
        if (!imgPath) continue
        const mdlPath = path.join(outDir, imgPath)
        if (!fs.existsSync(mdlPath)) continue
        const mdl = JSON.parse(fs.readFileSync(mdlPath, 'utf8'))
        const matPath = path.join(outDir, mdl.material)
        if (!mdl.material || !fs.existsSync(matPath)) continue
        const mat = JSON.parse(fs.readFileSync(matPath, 'utf8'))
        const tex = mat.passes?.[0]?.textures?.[0]
        if (!tex) continue
        const png = path.join(outDir, 'materials', tex + '.png')
        if (!fs.existsSync(png)) continue

        const origin = (o.origin || '').split(' ').map(Number)
        const size = (o.size || '').split(' ').map(Number)
        const scale = (o.scale || '').split(' ').map(Number)
        if (origin.length < 2 || size.length < 2 || scale.length < 2) continue
        const w = Math.round(size[0] * scale[0])
        const h = Math.round(size[1] * scale[1])
        if (w <= 0 || h <= 0) continue
        const px = Math.round(origin[0] - w / 2)
        const py = Math.round(origin[1] - h / 2)
        layers.push({ tex, png, px, py, w, h })
      } catch {}
    }
    const layout = { width: 960, height: 540, layers }
    fs.writeFileSync(layoutPath, JSON.stringify(layout))
    return layout
  } catch {
    return null
  }
}

/* scene 合成帧：读回渲染进程需要的每层 dataURL 与大图 */
async function buildSceneComposite(dir) {
  const r = await extractScenePkg(dir)
  if (!r) return null
  const layout = parseSceneLayout(dir)
  if (!layout || !layout.layers.length) return null
  const layers = []
  for (const l of layout.layers) {
    try {
      const buf = fs.readFileSync(l.png)
      const mime = path.extname(l.png).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg'
      layers.push({ tex: l.tex, px: l.px, py: l.py, w: l.w, h: l.h, dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64') })
    } catch {}
  }
  if (!layers.length) return null
  return { width: layout.width, height: layout.height, layers }
}

/* 生成缩略图（壁纸库网格用，避免一次加载 144 张大图）
   jpg/png → 主进程缩到 320px 返回 dataURL；
   GIF → 返回 file:// URL 让渲染进程 <img> 直接解码（Chromium 原生支持 GIF） */
function makeThumb(p, width = 320) {
  try {
    const { nativeImage } = require('electron')
    const ext = path.extname(p).toLowerCase()
    if (ext === '.gif') return pathToFileURL(p).href
    const img = nativeImage.createFromPath(p)
    if (img.isEmpty()) return null
    return img.resize({ width }).toDataURL()
  } catch {
    return null
  }
}

/* 扫描壁纸库目录（如 steamapps/workshop/content/431960）：
   ① 子文件夹：Wallpaper Engine 目录（project.json/scene.pkg 等）
   ② 根目录下直接放的单个媒体文件：图片/视频/动图也作为一张壁纸（kind=image/video，preview 自引用） */
function scanLibrary(root) {
  const items = []
  try {
    const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())
    for (const d of dirs) {
      const full = path.join(root, d.name)
      const w = parseWallpaperFolder(full)
      if (w.kind !== 'none') {
        w.dirFullPath = full
        items.push(w)
      }
    }
    /* 根目录下的单个媒体文件也识别为壁纸 */
    const media = fs.readdirSync(root, { withFileTypes: true }).filter((d) => {
      if (!d.isFile()) return false
      const ext = path.extname(d.name).toLowerCase()
      return IMG_EXT.has(ext) || VID_EXT.has(ext)
    })
    for (const f of media) {
      const full = path.join(root, f.name)
      const ext = path.extname(f.name).toLowerCase()
      const isVideo = VID_EXT.has(ext)
      const preview = pathToFileURL(full).href
      items.push({
        kind: isVideo ? 'video' : 'image',
        src: preview,
        srcPath: full,
        preview,
        previewPath: full,
        title: path.basename(f.name, ext),
        weType: null,
        dir: f.name,
        dirFullPath: full,
        isFile: true,
      })
    }
  } catch {}
  return { root, items }
}

/* ---------- 窗口 ---------- */
const PRELOAD = path.join(__dirname, 'preload.js')

function createMainWindow() {
  const b = settings.mainBounds
  const win = new BrowserWindow({
    width: b?.width || 560,
    height: b?.height || 560,
    x: b?.x,
    y: b?.y,
    minWidth: 340,
    minHeight: 420,
    frame: false,
    transparent: true,
    /* 默认不置顶；是否置顶由「顶」按钮（store.alwaysOnTop）控制，避免首次点击语义错位 */
    alwaysOnTop: false,
    backgroundColor: '#00000000',
    resizable: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  win.once('ready-to-show', () => {
    win.show()
    /* 按 store 恢复「顶」状态（主窗口初始不置顶，由用户点击「顶」控制） */
    try {
      const saved = settings.store && settings.store.alwaysOnTop
      if (saved !== false && saved != null) win.setAlwaysOnTop(!!saved)
    } catch {}
    console.log('[cunjin] window ready')
  })
  win.webContents.on('console-message', (e) => {
    const msg = typeof e === 'object' && e && e.message ? e.message : String(e)
    console.log('[renderer]', msg)
  })
  win.webContents.on('render-process-gone', (_e, d) => console.error('[cunjin] renderer gone:', d.reason))
  win.on('resized', () => persistBounds(win, 'mainBounds'))
  win.on('moved', () => persistBounds(win, 'mainBounds'))
  win.on('close', (e) => {
    if (isQuitting) return
    e.preventDefault() // 主窗口 × 只是收起：悬浮窗继续可用；两个都收起才退出
    win.hide()
    maybeQuit()
  })
  return win
}

/* 主窗口+悬浮窗都隐藏 → 真正退出应用 */
function maybeQuit() {
  if (isQuitting) return
  const mainHidden = !mainWin || !mainWin.isVisible()
  const widgetHidden = !widgetWin || !widgetWin.isVisible()
  if (mainHidden && widgetHidden) {
    isQuitting = true
    app.quit()
  }
}

/* 悬浮窗「主」按钮 → 显示（或重建）主窗口 */
function showMainWindow() {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.show()
    mainWin.focus()
  } else {
    mainWin = createMainWindow()
    mainWin.once('ready-to-show', () => mainWin.show())
  }
}

function getWidgetWin() {
  if (widgetWin && !widgetWin.isDestroyed()) return widgetWin
  const b = settings.widgetBounds
  widgetWin = new BrowserWindow({
    width: b?.width || 320,
    height: b?.height || 420,
    x: b?.x,
    y: b?.y,
    minWidth: 240,
    minHeight: 200,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    resizable: true,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  widgetWin.loadFile(path.join(__dirname, 'renderer', 'widget.html'))
  widgetWin.on('resized', () => persistBounds(widgetWin, 'widgetBounds'))
  widgetWin.on('moved', () => persistBounds(widgetWin, 'widgetBounds'))
  widgetWin.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault() // 悬浮窗点 × 只是收起，钉着的内容还在
      widgetWin.hide()
      broadcastWidgetState()
      maybeQuit()
    }
  })
  widgetWin.on('show', () => broadcastWidgetState())
  widgetWin.on('hide', () => broadcastWidgetState())
  return widgetWin
}

/* 悬浮窗可见性 → 广播给其它窗口（必须为函数声明，getWidgetWin 事件回调可能先于 IPC 绑定触发） */
function broadcastWidgetState() {
  const vis = !!(widgetWin && widgetWin.isVisible())
  for (const w of BrowserWindow.getAllWindows()) {
    if (w !== widgetWin) w.webContents.send('widget-visibility', vis)
  }
}

/* ---------- 启动 ---------- */
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'notifications'))

  /* 窗口控制 */
  ipcMain.handle('win:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.handle('win:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.handle('win:show-main', () => { showMainWindow(); return true })
  /* 系统通知（作用在 Windows 系统通知中心，最小化也能看到） */
  ipcMain.on('notify', (_e, { title, body }) => {
    try {
      const { Notification } = require('electron')
      if (Notification.isSupported()) new Notification({ title, body }).show()
    } catch (err) { console.error('[cunjin] notify failed:', err && err.message) }
  })
  ipcMain.handle('win:toggle-top', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    const next = !w.isAlwaysOnTop()
    w.setAlwaysOnTop(next)
    return next
  })
  ipcMain.on('win:resize', (e, { edge, dx, dy }) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    const [mw, mh] = w.getMinimumSize().length ? w.getMinimumSize() : [200, 200]
    const b = w.getBounds()
    let { x, y, width, height } = b
    if (edge.includes('e')) width = Math.max(mw, width + dx)
    if (edge.includes('s')) height = Math.max(mh, height + dy)
    if (edge.includes('w')) {
      const nw = Math.max(mw, width - dx)
      x += width - nw
      width = nw
    }
    if (edge.includes('n')) {
      const nh = Math.max(mh, height - dy)
      y += height - nh
      height = nh
    }
    w.setBounds({ x, y, width, height })
  })
  /* 边缘拖拽缩放：以按下瞬间为基准，用「屏幕绝对坐标」算增量（不用视口坐标，
     否则窗口变大时同一点在视口中的坐标会漂移，导致转圈后窗口只增不减） */
  let resizeBase = null
  ipcMain.on('win:resize-begin', (e, { edge, sx, sy }) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    const b = w.getBounds()
    resizeBase = { w, edge, sx, sy, x: b.x, y: b.y, width: b.width, height: b.height }
  })
  ipcMain.on('win:resize-move', (e, { x, y }) => {
    if (!resizeBase || !resizeBase.w || resizeBase.w.isDestroyed()) return
    const { w, edge, sx, sy, x: bx, y: by, width, height } = resizeBase
    const [mw, mh] = w.getMinimumSize().length ? w.getMinimumSize() : [200, 200]
    const dx = x - sx, dy = y - sy
    let nx = bx, ny = by, nw = width, nh = height
    if (edge.includes('e')) nw = Math.max(mw, width + dx)
    if (edge.includes('s')) nh = Math.max(mh, height + dy)
    if (edge.includes('w')) { const t = Math.max(mw, width - dx); nx = bx + (width - t); nw = t }
    if (edge.includes('n')) { const t = Math.max(mh, height - dy); ny = by + (height - t); nh = t }
    w.setBounds({ x: nx, y: ny, width: nw, height: nh })
  })
  ipcMain.on('win:resize-end', () => { resizeBase = null })

  /* 悬浮窗 */
  ipcMain.handle('widget:toggle', () => {
    const w = getWidgetWin()
    if (w.isVisible()) {
      w.hide()
      broadcastWidgetState()
      return false
    }
    w.show()
    broadcastWidgetState()
    return true
  })
  ipcMain.handle('widget:show', () => {
    getWidgetWin().show()
    broadcastWidgetState()
    return true
  })

  /* ---------- 独立调色盘窗口：设置弹窗点「选择颜色」后，在主窗口右侧额外弹一个小窗 ---------- */
  let colorPickerWin = null
  let pickerTarget = null // { kind:'timer'|'progress', id, original }
  let pickerOwner = null // 打开它的主窗口/悬浮窗 webContents
  function closeColorPicker() {
    if (colorPickerWin && !colorPickerWin.isDestroyed()) colorPickerWin.close()
    colorPickerWin = null
    pickerTarget = null
    pickerOwner = null
  }
  ipcMain.handle('color-picker:open', (e, { kind, id, original, initial }) => {
    pickerTarget = { kind, id, original: original || null }
    pickerOwner = e.sender
    const ownerWin = BrowserWindow.fromWebContents(e.sender)
    if (colorPickerWin && !colorPickerWin.isDestroyed()) colorPickerWin.close()
    const { screen } = require('electron')
    const owner = ownerWin?.getBounds() || { x: 200, y: 100, width: 900, height: 700 }
    const WA = screen.getDisplayMatching(owner).workArea
    const W = 380, H = 430
    let x = owner.x + owner.width + 10
    if (x + W > WA.x + WA.width) x = owner.x - W - 10 // 右边放不下就放左边
    x = Math.max(WA.x + 4, Math.min(x, WA.x + WA.width - W - 4))
    const y = Math.max(WA.y + 4, Math.min(owner.y, WA.y + WA.height - H - 4))
    colorPickerWin = new BrowserWindow({
      width: W,
      height: H,
      x, y,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      backgroundColor: '#1a1a1e',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    })
    colorPickerWin.loadFile(path.join(__dirname, 'renderer', 'colorpicker.html'), { query: { initial: initial || '#e2a24b' } })
    colorPickerWin.once('ready-to-show', () => colorPickerWin.show())
    /* 兜底：did-finish-load 后强制显示（ready-to-show 在无边框+透明窗口偶发不触发） */
    colorPickerWin.webContents.once('did-finish-load', () => {
      if (colorPickerWin && !colorPickerWin.isDestroyed() && !colorPickerWin.isVisible()) {
        setTimeout(() => colorPickerWin.show(), 50)
      }
    })
    colorPickerWin.on('closed', () => {
      // 未确认关闭 = 取消（浏览器窗口销毁时取消，目标窗口恢复）
      if (pickerTarget && pickerOwner && !pickerOwner.isDestroyed()) {
        pickerOwner.send('color-picker:cancel', pickerTarget)
      }
      colorPickerWin = null
      pickerTarget = null
      pickerOwner = null
    })
    return true
  })
  /* 实时预览：色盘窗口拖动 → **所有窗口**（主界面+悬浮窗）同 id 卡片临时改色（不写盘）。
     用户预期「悬浮窗的计时器对应主界面的计时器」——调一个窗口，另一个窗口也实时变 */
  ipcMain.on('color-picker:preview', (e, hex) => {
    if (e.sender !== colorPickerWin?.webContents) return
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents !== colorPickerWin.webContents) {
        w.webContents.send('color-picker:preview', { target: pickerTarget, hex })
      }
    }
  })
  /* 保存：所有窗口把颜色写入数据（卡片主题色），并关闭色盘窗口 */
  ipcMain.on('color-picker:commit', (e, hex) => {
    const t = pickerTarget
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents !== colorPickerWin?.webContents) {
        w.webContents.send('color-picker:commit', { target: t, hex })
      }
    }
    closeColorPicker()
  })
  /* 取消：所有窗口恢复原色（原先是主题色 → 跟随主题色；原先是自定义 → 回原色） */
  ipcMain.on('color-picker:cancel', () => {
    const t = pickerTarget
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents !== colorPickerWin?.webContents) {
        w.webContents.send('color-picker:cancel', { target: t })
      }
    }
    closeColorPicker()
  })

  /* 数据同步广播：任一窗口改数据 → 其它窗口刷新 */
  ipcMain.on('data-changed', (e) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents !== e.sender) w.webContents.send('data-changed')
    }
  })

  /* 文件选择（记住上次目录） */
  ipcMain.handle('bg:pick-folder', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择 Wallpaper Engine 壁纸文件夹',
      defaultPath: settings.lastDir,
      properties: ['openDirectory'],
    })
    if (r.canceled || !r.filePaths?.[0]) return null
    settings.lastDir = r.filePaths[0]
    saveSettings(settings)
    const w = parseWallpaperFolder(r.filePaths[0])
    w.dirFullPath = r.filePaths[0]
    return w
  })
  ipcMain.handle('bg:pick-file', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择背景图片或视频',
      defaultPath: settings.lastDir,
      properties: ['openFile'],
      filters: [
        { name: '图片 / 视频', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'mp4', 'webm', 'mkv', 'mov'] },
      ],
    })
    if (r.canceled || !r.filePaths?.[0]) return null
    settings.lastDir = path.dirname(r.filePaths[0])
    saveSettings(settings)
    const p = r.filePaths[0]
    const kind = VID_EXT.has(path.extname(p).toLowerCase()) ? 'video' : 'image'
    return { kind, src: pathToFileURL(p).href, srcPath: p, preview: null, previewPath: kind === 'image' ? p : null, title: path.basename(p), weType: null, dir: null }
  })

  /* 壁纸库 */
  ipcMain.handle('bg:pick-library', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择壁纸库根目录（如 steamapps\\workshop\\content\\431960）',
      defaultPath: settings.lastDir,
      properties: ['openDirectory'],
    })
    if (r.canceled || !r.filePaths?.[0]) return null
    settings.wallpaperRoot = r.filePaths[0]
    settings.lastDir = r.filePaths[0]
    saveSettings(settings)
    return scanLibrary(settings.wallpaperRoot)
  })
  ipcMain.handle('bg:rescan', (_e, root) => {
    const r = root || settings.wallpaperRoot
    if (!r) return { root: null, items: [] }
    return scanLibrary(r)
  })

  /* 读取图片为 dataURL（主窗口取主色调调用，canvas 不污染） */
  ipcMain.handle('bg:read-image', (_e, p) => {
    try {
      if (typeof p !== 'string' || !fs.existsSync(p)) return null
      const buf = fs.readFileSync(p)
      if (buf.length > 8 * 1024 * 1024) return null
      const ext = path.extname(p).toLowerCase()
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
      return 'data:' + mime + ';base64,' + buf.toString('base64')
    } catch {
      return null
    }
  })

  /* 壁纸库缩略图：给文件夹路径，返回小尺寸 dataURL（先预览图，scene 则解包后取最佳图）。
     也支持**单文件**（用户图文目录直接放的图片/视频/动图）：parseWallpaperFolder 只认目录，
     单文件直接 makeThumb(文件自身)（视频则用同目录文件或 preview 同级图，无则按参数预览） */
  ipcMain.handle('bg:thumb', async (_e, dir) => {
    try {
      /* 单文件：文件存在且是文件 → 直接缩略图（jpg/png/webp/gif/bmp；视频无缩略图返回 null 由渲染层显示名称） */
      try {
        const st = fs.statSync(dir)
        if (st.isFile()) {
          const ext = path.extname(dir).toLowerCase()
          if (IMG_EXT.has(ext)) return makeThumb(dir)
          /* 视频等无缩略图：找同目录的 preview 图或自身不带 */
          const sibling = findPreview(path.dirname(dir))
          return sibling ? makeThumb(sibling) : null
        }
      } catch {}
      const w = parseWallpaperFolder(dir)
      // 注意 parseWallpaperFolder 返回的 preview 是 file:// URL；nativeImage 要的是原生路径
      if (w.previewPath) return makeThumb(w.previewPath)
      if (w.weType === 'scene') {
        const r = await extractScenePkg(dir)
        return r ? makeThumb(r.png) : null
      }
      return null
    } catch {
      return null
    }
  })

  /* scene 壁纸真·按原始布局合成：返回各图层 dataURL，渲染进程 canvas 合成 */
  ipcMain.handle('bg:scene-composite', async (_e, dir) => {
    try {
      return await buildSceneComposite(dir)
    } catch {
      return null
    }
  })

  /* scene 壁纸真解包：返回解出的最佳背景图 dataURL 和路径 */
  ipcMain.handle('bg:scene-extract', async (_e, dir) => {
    try {
      const r = await extractScenePkg(dir)
      if (!r) return null
      const buf = fs.readFileSync(r.png)
      if (buf.length > 20 * 1024 * 1024) return { dataUrl: null, path: r.png, width: r.width, height: r.height, fallbackImage: true }
      const ext = path.extname(r.png).toLowerCase()
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg'
      return { dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64'), path: r.png, width: r.width, height: r.height }
    } catch {
      return null
    }
  })

  mainWin = createMainWindow()

  if (process.env.CUNJIN_SMOKE) {
    const SMOKE_MS = parseInt(process.env.CUNJIN_SMOKE_MS || '45000', 10)
    setTimeout(() => {
      console.log('[cunjin] smoke ok')
      app.quit()
    }, SMOKE_MS)
    // 冒烟同时验证悬浮窗能正常加载（getWidgetWin 内部已 loadFile，这里只等待加载完成）
    setTimeout(() => {
      const w = getWidgetWin()
      const onLoad = () => {
        w.webContents.removeListener('did-finish-load', onLoad)
        w.show()
        console.log('[cunjin] widget smoke ok')
      }
      const url = w.webContents.getURL()
      if (url && url.startsWith('file://')) onLoad()
      else w.webContents.once('did-finish-load', onLoad)
    }, 1000)
    // 冒烟探测：设置按钮点击后弹窗是否真的打开
    setTimeout(async () => {
      const r = await mainWin.webContents.executeJavaScript(`(() => {
        const gear = document.querySelector('#btn-gear')
        const modal = document.querySelector('#settings-modal')
        const before = modal ? modal.className : 'NO-MODAL'
        if (gear) gear.click()
        const after = modal ? modal.className : 'NO-MODAL'
        return JSON.stringify({ gearFound: !!gear, before, after, opened: before !== after && !after.includes('hidden') })
      })()`)
      console.log('[cunjin] gear probe', r)
    }, 1800)

    // 冒烟探测：壁纸库浏览页 + scene 合成
    setTimeout(async () => {
      const libRoot = 'D:/steamz/steamapps/workshop/content/431960'
      const sceneDir = 'D:/steamz/steamapps/workshop/content/431960/3407317466'
      const probeJs = `(async () => {
        const out = {}
        localStorage.setItem('cunjin:bg:library', ${JSON.stringify(JSON.stringify({ root: libRoot }))})
        // 打开浏览页
        document.querySelector('#bg-open-library')?.click()
        await new Promise((res) => setTimeout(res, 300))
        const grid = document.querySelector('#lib-browser-grid')
        if (!grid) return JSON.stringify({ grid: false })
        await new Promise((res) => setTimeout(res, 5000))
        const imgs = [...grid.querySelectorAll('img')]
        out.items = imgs.length
        out.loaded = imgs.filter((i) => (i.src || '').startsWith('data:image') || (i.src || '').startsWith('file://')).length
        // 布局诊断
        const firstItem = grid.querySelector('.lib-item')
        const firstImg = grid.querySelector('.lib-item img')
        if (firstItem && firstImg) {
          const cs = getComputedStyle(firstImg)
          out.imgRect = { w: Math.round(firstImg.getBoundingClientRect().width), h: Math.round(firstImg.getBoundingClientRect().height) }
          out.imgCss = { cssHeight: cs.height, display: cs.display, objectFit: cs.objectFit, position: cs.position }
          out.itemRect = { w: Math.round(firstItem.getBoundingClientRect().width), h: Math.round(firstItem.getBoundingClientRect().height) }
          out.itemClass = firstItem.className
          out.itemCss = { display: getComputedStyle(firstItem).display, h: getComputedStyle(firstItem).height }
          // 规则是否命中
          out.matchesImgRule = firstImg.matches('.lib-item img')
          out.ruleSource = cs.height || 'none'
          out.styleSheetInfo = (() => {
            for (const sheet of document.styleSheets) {
              try {
                for (const r of sheet.cssRules) {
                  if (r.selectorText && /lib-item/.test(r.selectorText || '')) {
                    return r.selectorText + ' -> ' + r.style.height
                  }
                }
              } catch {}
            }
            return 'no rule'
          })()
        }
        const noImgs = grid.querySelectorAll('.lib-noimg').length
        out.noImgs = noImgs
        return JSON.stringify(out)
      })()`
      const r = await mainWin.webContents.executeJavaScript(probeJs)
      console.log('[cunjin] lib+scene probe', r)
    }, 2500)

    // 冒烟探测：调色板写入 CSS 变量（用蓝色壁纸主色验证互补)
    setTimeout(async () => {
      const r = await mainWin.webContents.executeJavaScript(`(() => {
        applyPaletteToCss(buildPalette({ r: 70, g: 120, b: 200 }), false) // 蓝壁纸（不持久化，避免污染用户配色）
        const cs = getComputedStyle(document.documentElement)
        return JSON.stringify({
          accent: cs.getPropertyValue('--accent').trim(),
          accentSoft: cs.getPropertyValue('--accent-soft-color').trim(),
          muted: cs.getPropertyValue('--muted').trim(),
          panel: cs.getPropertyValue('--panel-rgb').trim(),
          text: cs.getPropertyValue('--text').trim()
        })
      })()`)
      console.log('[cunjin] palette probe', r)
    }, 3500)

    // 冒烟探测：主进程直接解包一个 scene 壁纸（验证 RePKG 集成）
    setTimeout(async () => {
      const testDir = 'D:/steamz/steamapps/workshop/content/431960/3407317466'
      const r = await extractScenePkg(testDir)
      console.log('[cunjin] scene extract probe', JSON.stringify(r ? { png: r.png.split(/[\\/]/).pop(), w: r.width, h: r.height } : null))
    }, 3000)

    // 冒烟探测：时间样式溢出（双列 + 最小窗口下量时间文本宽 vs 显示区宽）
    if (process.env.CUNJIN_FIT_PROBE) {
      setTimeout(async () => {
        try {
          mainWin.setSize(360, 560)
          await new Promise((r) => setTimeout(r, 600))
          const res = await mainWin.webContents.executeJavaScript(`(async () => {
            document.querySelector('[data-tab="timer"]')?.click()
            const cols = document.querySelector('#ui-cols-timer')
            if (cols) { cols.value = '2'; cols.dispatchEvent(new Event('change', { bubbles: true })) }
            await new Promise(r => setTimeout(r, 600))
            const cols3 = document.querySelector('#ui-cols-timer')
            if (cols3) { cols3.value = '3'; cols3.dispatchEvent(new Event('change', { bubbles: true })) }
            await new Promise(r => setTimeout(r, 1200))
            const out = []
            document.querySelectorAll('.timer-card').forEach((card, i) => {
              const disp = card.querySelector('.t-display')
              const d = card.querySelector('.time-display')
              const ring = card.querySelector('.ring')
              if (disp) {
                const dw = disp.clientWidth
                let textW = null, fs = null
                if (d) { textW = Math.round(d.getBoundingClientRect().width); fs = d.style.fontSize }
                if (ring) { const t = ring.querySelector('text'); textW = t ? Math.round(t.getBoundingClientRect().width) : null; fs = t ? (t.style.fontSize || 'css') : null }
                out.push({ i: i + 1, shape: ring ? 'ring' : 'digits', dispW: dw, textW, fs, overflow: textW != null && textW > dw })
              }
            })
            return JSON.stringify(out)
          })()`)
          console.log('[cunjin] fit probe', res)
        } catch (e) {
          console.log('[cunjin] fit probe ERROR', e && e.message)
        }
      }, 5000)
    }
  }
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => app.quit())
