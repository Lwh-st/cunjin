// 寸进 · 主窗口入口
'use strict'

/* ---------- 设置弹窗：命令式打开/关闭（compare-mode 等状态每次重置，防止卡死） ---------- */
function openSettings() {
  const modal = $('#settings-modal')
  modal.classList.remove('compare-mode') // 清残留
  modal.classList.remove('hidden')
  $('#btn-gear').classList.add('on')
  setTimeout(() => { try { window.__renderLib?.() } catch {} }, 50)
}
function closeSettings() {
  const modal = $('#settings-modal')
  modal.classList.remove('compare-mode')
  modal.classList.add('hidden')
  $('#btn-gear').classList.remove('on')
}

/* ---------- 窗口控制 ---------- */
$('#btn-min').addEventListener('click', () => window.cunjin?.window.minimize())
$('#btn-close').addEventListener('click', () => window.cunjin?.window.close())
$('#btn-pin').addEventListener('click', async () => {
  const on = await window.cunjin?.window.toggleAlwaysOnTop()
  $('#btn-pin').classList.toggle('on', !!on)
  store.set('alwaysOnTop', !!on)
})
$('#btn-widget').addEventListener('click', async () => {
  const on = await window.cunjin?.widget.toggle()
  $('#btn-widget').classList.toggle('on', !!on)
})
$('#btn-gear').addEventListener('click', () => {
  // 无条件打开：关闭只用弹窗内按钮/点背景，避免状态污染导致点不开
  openSettings()
})
/* 浮窗可见性同步（浮窗内部关闭/打开时更新「浮」按钮） */
try {
  window.cunjin?.widget.onVisibility((vis) => {
    $('#btn-widget').classList.toggle('on', !!vis)
  })
} catch {}
/* 关闭设置弹窗（外部按钮/背景）也同步按钮态 */
$('#settings-close')?.addEventListener('click', closeSettings)

/* 标签切换 */
function activateTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name))
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name))
  store.set('lastTab', name)
}
$$('.tab').forEach((t) => t.addEventListener('click', () => activateTab(t.dataset.tab)))

/* ---------- 列数切换（计时 / 进度）——设置面板里选择 ---------- */
function bindColSwitch(key, listEl) {
  const saved = parseInt(store.get('cols:' + key, 1), 10)
  listEl.dataset.cols = saved
}
function setCols(key, listEl, n) {
  store.set('cols:' + key, n)
  listEl.dataset.cols = n
}
$('#ui-cols-timer').value = String(store.get('cols:timer', 1))
$('#ui-cols-progress').value = String(store.get('cols:progress', 1))
$('#ui-cols-timer').addEventListener('change', (e) => setCols('timer', $('#timer-list'), parseInt(e.target.value, 10)))
$('#ui-cols-progress').addEventListener('change', (e) => setCols('progress', $('#pg-list'), parseInt(e.target.value, 10)))

/* ---------- 计时器面板 ---------- */
function renderTimers() {
  const panels = $('#panels')
  const prevScroll = panels ? panels.scrollTop : 0
  const list = $('#timer-list')
  list.innerHTML = ''
  Cards.allTimers().forEach((t) => list.appendChild(Cards.timerCard(t, { onChanged: renderTimers })))
  /* 全量重建会瞬间清空内容 → 滚动容器 scrollTop 被 clamp 到 0（回顶）。
     在重建后恢复（问题：移动靠下时拖完滚动条自动回顶） */
  if (panels) requestAnimationFrame(() => { panels.scrollTop = prevScroll })
}
/* 计时器卡片拖拽排序（手柄 ⠿ 拖动） */
Cards.bindReorder($('#timer-list'), 'timer', () => Cards.allTimers(), (arr) => Cards.saveTimers(arr), () => renderTimers())
$('#timer-add').addEventListener('click', () => {
  const arr = Cards.allTimers()
  arr.push({ id: uid(), name: Cards.nextTimerDefaultName(), mode: 'down', minutes: 25, every: 15, shape: 'digits', state: 'idle', left: 25 * 60000, base: 0, startAt: null, endAt: null, notified: 0 })
  Cards.saveTimers(arr)
  renderTimers()
  const cards = $$('#timer-list .timer-card')
  cards[cards.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  Cards.openTimerSettings(arr[arr.length - 1].id, renderTimers) // 新建即弹出设置
})

/* ---------- 进度面板 ---------- */
function renderProgress() {
  const panels = $('#panels')
  const prevScroll = panels ? panels.scrollTop : 0
  const list = $('#pg-list')
  list.innerHTML = ''
  Cards.allProgress().forEach((p, i) => list.appendChild(Cards.progressCard(p, i, { onChanged: renderProgress })))
  if (panels) requestAnimationFrame(() => { panels.scrollTop = prevScroll })
}
/* 进度条卡片拖拽排序 */
Cards.bindReorder($('#pg-list'), 'progress', () => Cards.allProgress(), (arr) => Cards.saveProgress(arr), () => renderProgress())
$('#pg-add').addEventListener('click', () => {
  const arr = Cards.allProgress()
  arr.push({ id: uid(), name: Cards.nextProgressDefaultName(), val: 0, step: 10, color: null, shape: 'bar', anim: 'smooth' })
  Cards.saveProgress(arr)
  renderProgress()
  const cards = $$('#pg-list .progress-card')
  cards[cards.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  Cards.openProgressSettings(arr[arr.length - 1].id, renderProgress) // 新建即弹出设置
})

/* ---------- 侧栏：收起/展开、左右切换 ---------- */
function applySidebarLayout() {
  const app = $('#app')
  const side = store.get('ui:sidebar', 'left')   // 'left' | 'right'
  const collapsed = store.get('ui:sidebarCollapsed', false)
  app.classList.toggle('side-right', side === 'right')
  app.classList.toggle('side-collapsed', !!collapsed)
  $('#btn-sidebar').classList.toggle('on', !!collapsed)
}
$('#btn-sidebar').addEventListener('click', () => {
  store.set('ui:sidebarCollapsed', !store.get('ui:sidebarCollapsed', false))
  applySidebarLayout()
})

/* ---------- 装配 ---------- */
initPlan()
/* 默认名迁移：未命名旧数据补名（防止换位后名字跟着位置变） */
Cards.ensureDefaultNames()
renderTimers()
renderProgress()
initBackground()
bindResizeHandles()
bindColSwitch('timer', $('#timer-list'))
bindColSwitch('progress', $('#pg-list'))
Cards.startTicking(document)
enhanceSelects(document) /* 替换原生 select 为自绘下拉（选项列表也风格统一） */
activateTab(store.get('lastTab', 'plan'))
applySidebarLayout()
// 恢复置顶状态
if (store.get('alwaysOnTop', false)) $('#btn-pin').classList.add('on')

/* 悬浮窗改了数据 → 主窗口刷新 */
onRemoteDataChanged(() => {
  renderTimers()
  renderProgress()
})
/* store 数据就绪/变化 → 主窗口刷新（跨窗口共享数据） */
document.addEventListener('store-ready', () => {
  renderTimers()
  renderProgress()
  activateTab(store.get('lastTab', 'plan'))
})
document.addEventListener('store-changed', () => {
  renderTimers()
  renderProgress()
})
