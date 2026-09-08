// 寸进 · preload：向页面暴露安全的最小接口
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cunjin', {
  window: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    close: () => ipcRenderer.invoke('win:close'),
    showMain: () => ipcRenderer.invoke('win:show-main'),
    toggleAlwaysOnTop: () => ipcRenderer.invoke('win:toggle-top'),
    resize: (edge, dx, dy) => ipcRenderer.send('win:resize', { edge, dx, dy }),
    resizeBegin: (edge, sx, sy) => ipcRenderer.send('win:resize-begin', { edge, sx, sy }),
    resizeMove: (x, y) => ipcRenderer.send('win:resize-move', { x, y }),
    resizeEnd: () => ipcRenderer.send('win:resize-end'),
  },
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  widget: {
    toggle: () => ipcRenderer.invoke('widget:toggle'),
    show: () => ipcRenderer.invoke('widget:show'),
    onVisibility: (cb) => ipcRenderer.on('widget-visibility', (_e, v) => cb(v)),
  },
  bg: {
    pickFolder: () => ipcRenderer.invoke('bg:pick-folder'),
    pickFile: () => ipcRenderer.invoke('bg:pick-file'),
    pickLibrary: () => ipcRenderer.invoke('bg:pick-library'),
    rescan: (root) => ipcRenderer.invoke('bg:rescan', root),
    readImage: (p) => ipcRenderer.invoke('bg:read-image', p),
    thumb: (dir) => ipcRenderer.invoke('bg:thumb', dir),
    sceneExtract: (dir) => ipcRenderer.invoke('bg:scene-extract', dir),
    sceneComposite: (dir) => ipcRenderer.invoke('bg:scene-composite', dir),
  },
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
    onChange: (cb) => ipcRenderer.on('store-changed', (_e, key, value) => cb(key, value)),
  },
  colorPicker: {
    open: (opts) => ipcRenderer.invoke('color-picker:open', opts),
    preview: (hex) => ipcRenderer.send('color-picker:preview', hex),
    commit: (hex) => ipcRenderer.send('color-picker:commit', hex),
    cancel: () => ipcRenderer.send('color-picker:cancel'),
    onPreview: (cb) => ipcRenderer.on('color-picker:preview', (_e, data) => cb(data)),
    onCommit: (cb) => ipcRenderer.on('color-picker:commit', (_e, data) => cb(data)),
    onCancel: (cb) => ipcRenderer.on('color-picker:cancel', (_e, data) => cb(data)),
  },
  dataChanged: () => ipcRenderer.send('data-changed'),
  onDataChanged: (cb) => ipcRenderer.on('data-changed', () => cb()),
})
