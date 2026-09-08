// 寸进 · 悬浮窗入口：自由钉住 计时器 / 进度条 / 今日任务 的组合
'use strict'

/* 用户钉住的布局：[{type:'timer',id}, {type:'progress',id}, {type:'today'}] */
const getLayout = () => store.get('widget:layout', [])

$('#wg-close').addEventListener('click', () => window.cunjin?.window.close())
$('#wg-main').addEventListener('click', () => window.cunjin?.window.showMain())

/* ---------- 悬浮窗独立组件外观（透明/毛玻璃，参数与主界面分开存储） ---------- */
const wgStyle = () => store.get('widgetStyle', { alpha: 0.4, panelBlur: 16 })
const wgAlpha = $('#wg-alpha')
const wgBlur = $('#wg-panel-blur')
wgAlpha.value = Math.round(wgStyle().alpha * 100)
wgBlur.value = Math.round((wgStyle().panelBlur / 40) * 100)
function applyWgStyle() {
  const s = wgStyle()
  document.documentElement.style.setProperty('--panel-alpha', s.alpha)
  document.documentElement.style.setProperty('--panel-blur', s.panelBlur + 'px')
  wgAlpha.value = Math.round(s.alpha * 100)
  wgBlur.value = Math.round((s.panelBlur / 40) * 100)
  $('#wg-alpha-val').textContent = Math.round(s.alpha * 100) + '%'
  $('#wg-panel-blur-val').textContent = Math.round((s.panelBlur / 40) * 100) + '%'
  $('#wg-alpha').style.setProperty('--fill', Math.round(s.alpha * 100) + '%')
  $('#wg-panel-blur').style.setProperty('--fill', Math.round((s.panelBlur / 40) * 100) + '%')
}
/* 悬浮窗独立组件外观（透明/毛玻璃，参数与主界面分开存储）
   compare-mode：滑杆拖动时悬浮窗外观设置页**原地透明化**（visibility 方案，位置不变），
   用户直接看到悬浮窗实时变化 —— 与主界面外观滑杆同思路 */
function enterWgCompare(row) {
  const modal = $('#wg-settings')
  modal.classList.add('compare-mode')
  row.classList.add('cmp-live')
  row.querySelector('input')?.focus()
}
function exitWgCompare() {
  const modal = $('#wg-settings')
  modal.classList.remove('compare-mode')
  $$('#wg-settings .cmp-live').forEach((r) => r.classList.remove('cmp-live'))
}
function bindWgCompare(sliderId) {
  const slider = $(sliderId)
  const row = slider.closest('.set-row')
  slider.addEventListener('pointerdown', () => enterWgCompare(row))
  slider.addEventListener('pointerup', () => {
    if ($('#wg-settings').classList.contains('compare-mode')) exitWgCompare()
  })
  slider.addEventListener('blur', () => {
    if ($('#wg-settings').classList.contains('compare-mode')) exitWgCompare()
  })
}
bindWgCompare('#wg-alpha')
bindWgCompare('#wg-panel-blur')

wgAlpha.addEventListener('input', () => {
  store.set('widgetStyle', { ...wgStyle(), alpha: parseInt(wgAlpha.value, 10) / 100 })
  applyWgStyle()
})
wgBlur.addEventListener('input', () => {
  store.set('widgetStyle', { ...wgStyle(), panelBlur: Math.round((parseInt(wgBlur.value, 10) / 100) * 40) })
  applyWgStyle()
})
$('#wg-gear').addEventListener('click', () => $('#wg-settings').classList.toggle('hidden'))
$('#wg-settings-close').addEventListener('click', () => $('#wg-settings').classList.add('hidden'))
$('#wg-settings').addEventListener('click', (e) => { if (e.target === $('#wg-settings')) $('#wg-settings').classList.add('hidden') })
applyWgStyle()

/* ---------- 右键 / ⋯ 菜单：移除单项 ---------- */
const editMenu = el('div', 'wg-edit-menu')
document.body.appendChild(editMenu)

/* 右键菜单：弹在鼠标位置下方；触碰窗口边缘时上下/左右翻转（问题 5.1） */
function openEditMenu(anchor, layoutItem, rerender, ev) {
  editMenu.innerHTML = ''
  const remove = el('button', 'danger', '从这里移除')
  remove.addEventListener('click', () => {
    const l = getLayout()
    const i = l.findIndex((x) => x.type === layoutItem.type && x.id === layoutItem.id)
    if (i >= 0) l.splice(i, 1)
    store.set('widget:layout', l)
    editMenu.classList.remove('open')
    rerender()
  })
  editMenu.appendChild(remove)
  if (layoutItem.type !== 'today') {
    editMenu.appendChild(el('div', 'wg-menu-sep'))
    const cfg = el('button', null, '设置')
    cfg.addEventListener('click', () => {
      editMenu.classList.remove('open')
      if (layoutItem.type === 'timer') Cards.openTimerSettings(layoutItem.id, rerender)
      else Cards.openProgressSettings(layoutItem.id, rerender)
    })
    editMenu.appendChild(cfg)
  }
  /* 定位：默认鼠标位置下方；右/下触碰窗口边缘则翻转 */
  let x = ev ? ev.clientX : (anchor.getBoundingClientRect().right - 130)
  let y = ev ? ev.clientY + 6 : (anchor.getBoundingClientRect().bottom + 4)
  editMenu.classList.remove('open')
  editMenu.style.visibility = 'hidden'
  editMenu.style.left = '0px'; editMenu.style.top = '0px'
  editMenu.style.left = x + 'px'
  editMenu.style.top = y + 'px'
  editMenu.classList.add('open')
  const mw = editMenu.offsetWidth, mh = editMenu.offsetHeight
  const vw = window.innerWidth, vh = window.innerHeight
  if (mh && y + mh > vh - 6) editMenu.style.top = Math.max(4, (ev ? ev.clientY : vh) - mh - 6) + 'px'
  if (mw && x + mw > vw - 6) editMenu.style.left = Math.max(4, (ev ? ev.clientX : vw) - mw - 6) + 'px'
  editMenu.style.visibility = ''
}
document.addEventListener('click', (e) => {
  if (!editMenu.contains(e.target)) editMenu.classList.remove('open')
})

/* ---------- 悬浮窗：拖拽排序（完全复用 Cards 的 FLIP 版 pointer 拖拽，避免双份逻辑漂移） ---------- */
function bindWgReorder(container) {
  if (container.__reorder) return
  container.__reorder = true
  container.__reorderCtx = {
    commit(arrIds) {
      /* 卡片 DOM 顺序（data-id）→ 悬浮窗 layout 顺序（混合类型，today id='today'） */
      const layout = getLayout()
      const orderMap = new Map(arrIds.map((id, i) => [id, i]))
      const sorted = layout.slice().sort((a, b) => (orderMap.get(a.type === 'today' ? 'today' : a.id) ?? 999) - (orderMap.get(b.type === 'today' ? 'today' : b.id) ?? 999))
      store.set('widget:layout', sorted)
      render()
    },
  }
  Cards.attachDrag(container)
}
bindWgReorder($('#wg-stack'))

/* ---------- 渲染 ---------- */
function render() {
  const stack = $('#wg-stack')
  /* 保留悬浮窗滚动位置（问题：点击今日任务圆圈后整窗重渲染 → 滑杆跳回顶部/底部） */
  const scrollEl = stack.parentElement && stack.parentElement.scrollTop !== undefined ? stack.parentElement : stack
  const prevScroll = scrollEl.scrollTop || 0
  stack.innerHTML = ''
  const layout = getLayout()

  layout.forEach((item, idx) => {
    if (item.type === 'today') {
      const box = el('div')
      renderTodayCompact(box, render, (needConfirm) => {
        const l = getLayout()
        store.set('widget:layout', l.filter((x) => !(x.type === 'today')))
        render()
      }) // onChanged → 整窗重渲染（否则旧 card 不替换，圆圈点击无反馈）
      const card = box.firstChild
      if (card) {
        card.addEventListener('contextmenu', (e) => {
          e.preventDefault()
          openEditMenu(card, item, render, e)
        })
      }
      stack.appendChild(card || el('div'))
      return
    }
    if (item.type === 'timer') {
      const t = Cards.getTimer(item.id)
      if (!t) return
      const card = Cards.timerCard(t, {
        onChanged: render,
        widget: true,
        onRemoveFromLayout: () => {
          const l = getLayout()
          store.set('widget:layout', l.filter((x) => !(x.type === 'timer' && x.id === item.id)))
          render()
        },
      })
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        openEditMenu(card, item, render, e)
      })
      stack.appendChild(card)
      return
    }
    if (item.type === 'progress') {
      const p = Cards.getProgress(item.id)
      if (!p) return
      const card = Cards.progressCard(p, idx, {
        onChanged: render,
        widget: true,
        onRemoveFromLayout: () => {
          const l = getLayout()
          store.set('widget:layout', l.filter((x) => !(x.type === 'progress' && x.id === item.id)))
          render()
        },
      })
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        openEditMenu(card, item, render, e)
      })
      stack.appendChild(card)
    }
  })

  if (!layout.length) {
    const empty = el('div', 'card')
    empty.appendChild(el('h3', null, '悬浮窗'))
    empty.appendChild(el('p', 'hint', '点右上角 ＋ 把计时器、进度条、今日任务钉在这里'))
    stack.appendChild(empty)
  }
  /* 恢复滚动位置 */
  requestAnimationFrame(() => { scrollEl.scrollTop = prevScroll })
}

/* ---------- 添加菜单：选择已有的 或 新建 ---------- */
const addMenu = $('#wg-add-menu')
$('#wg-add').addEventListener('click', (e) => {
  e.stopPropagation()
  addMenu.classList.toggle('open')
})
document.addEventListener('click', (e) => {
  if (!addMenu.contains(e.target) && e.target.id !== 'wg-add') addMenu.classList.remove('open')
})

/* 选择面板：列出所有已有的计时器/进度条 + 「新建」按钮 */
function openPicker(type, reRender) {
  addMenu.classList.remove('open')
  const modal = el('div', 'modal')
  modal.style.zIndex = '70'
  const card = el('div', 'card modal-card')
  card.appendChild(el('h3', null, type === 'timer' ? '添加计时器' : '添加进度条'))

  const listBox = el('div', 'stack')
  const items = type === 'timer' ? Cards.allTimers() : Cards.allProgress()
  items.forEach((it) => {
    /* 优先显示名字；没取名显示默认编号名；并标注类型（正计时/倒计时） */
    let label
    if (type === 'timer') {
      const idx = Cards.allTimers().findIndex((x) => x.id === it.id)
      label = it.name || '计时器 ' + (idx + 1)
      if (it.mode === 'up') label += ' · 正计时'
      else label += ' · 倒计时 ' + (it.minutes ?? 25) + ' 分钟'
    } else {
      const idx = Cards.allProgress().findIndex((x) => x.id === it.id)
      label = it.name || '进度 ' + (idx + 1)
    }
    const row = el('button', 'picker-row', label)
    row.addEventListener('click', () => {
      const layout = getLayout()
      /* 去重：同一 timer/progress 不允许重复加入悬浮窗（今日任务唯一；bug 修复） */
      if (layout.some((x) => x.type === type && x.id === it.id)) {
        modal.remove()
        reRender()
        return
      }
      layout.push({ type, id: it.id })
      store.set('widget:layout', layout)
      modal.remove()
      reRender()
    })
    listBox.appendChild(row)
  })
  if (!items.length) listBox.appendChild(el('p', 'hint', '还没有可添加的，先新建一个'))

  /* 新建 */
  const newBtn = el('button', 'btn picker-new', '＋ 新建')
  newBtn.addEventListener('click', () => {
    const layout = getLayout()
    if (type === 'timer') {
      const arr = Cards.allTimers()
      arr.push({ id: uid(), name: Cards.nextTimerDefaultName(), mode: 'down', minutes: 25, every: 15, shape: 'digits', state: 'idle', left: 25 * 60000, base: 0, startAt: null, endAt: null, notified: 0 })
      Cards.saveTimers(arr)
      layout.push({ type: 'timer', id: arr[arr.length - 1].id })
    } else {
      const arr = Cards.allProgress()
      arr.push({ id: uid(), name: Cards.nextProgressDefaultName(), val: 0, step: 10, color: null, shape: 'bar', anim: 'smooth' })
      Cards.saveProgress(arr)
      layout.push({ type: 'progress', id: arr[arr.length - 1].id })
    }
    store.set('widget:layout', layout)
    modal.remove()
    reRender()
  })

  const closeBtn = el('button', 'btn btn-ghost', '取消')
  closeBtn.addEventListener('click', () => modal.remove())
  const btnRow = el('div', 'picker-actions')
  btnRow.append(newBtn, closeBtn)

  card.append(listBox, btnRow)
  modal.appendChild(card)
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove() })
  document.body.appendChild(modal)
}

$$('#wg-add-menu button').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.dataset.add === 'timer') {
      openPicker('timer', render)
    } else if (b.dataset.add === 'progress') {
      openPicker('progress', render)
    } else if (b.dataset.add === 'today') {
      const layout = getLayout()
      if (!layout.some((x) => x.type === 'today')) layout.push({ type: 'today' })
      store.set('widget:layout', layout)
      addMenu.classList.remove('open')
      render()
    }
  })
})

/* ---------- 装配 ---------- */
migratePlanData()
render()
bindResizeHandles()
Cards.startTicking(document)

/* 主题：读取主窗口保存的调色板（含文字/边框/面板色，跟着主窗口变） */
const savedPalette = (() => {
  try { return store.get('palette', null) } catch { return null }
})()
applyPaletteToCss(savedPalette)
const bgCfg0 = store.get('bg', {})
/* 悬浮窗组件样式（透明/毛玻璃）由 widgetStyle 独立控制，不随主界面 bg 覆盖 */

/* 主窗口改了数据 → 悬浮窗刷新（只跟颜色，组件透明/毛玻璃保持自身独立设置） */
function refreshFromStore() {
  render()
  const p = (() => {
    try { return store.get('palette', null) } catch { return null }
  })()
  applyPaletteToCss(p)
}
onRemoteDataChanged(refreshFromStore)
document.addEventListener('store-ready', refreshFromStore)
document.addEventListener('store-changed', refreshFromStore)
