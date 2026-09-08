// 寸进 · 独立调色盘窗口：实时 preview → 主窗口/悬浮窗（保存/取消按钮在这里）
'use strict'

const params = new URLSearchParams(location.search)
const initial = params.get('initial') || '#e2a24b'

const wheel = buildColorWheel(230, initial)
$('#cp-wheel').appendChild(wheel.el)
window.__wheel = wheel // 供自动化探针直接设色

let done = false
const finish = (fn) => {
  if (done) return
  done = true
  fn()
}

/* 调色盘拖动/点击 → 实时通知目标窗口临时改色（不写盘） */
wheel.onChange((hex) => {
  if (!done && window.cunjin?.colorPicker) window.cunjin.colorPicker.preview(hex)
})

const ok = () => finish(() => window.cunjin.colorPicker.commit(wheel.getValue()))
const cancel = () => finish(() => window.cunjin.colorPicker.cancel())

$('#cp-ok').addEventListener('click', ok)
$('#cp-cancel').addEventListener('click', cancel)

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cancel()
})

/* 窗口被系统关闭（Esc 已单独处理）时按取消处理 */
window.addEventListener('beforeunload', () => {
  if (!done) window.cunjin.colorPicker.cancel()
})
