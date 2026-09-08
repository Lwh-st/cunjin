// 寸进 · 计划模块：长期 / 短期 / 今日（主窗口）+ 今日紧凑视图（悬浮窗）
'use strict'

function autosize(ta) {
  ta.style.height = 'auto'
  ta.style.height = Math.min(140, ta.scrollHeight) + 'px'
}

function migratePlanData() {
  ;['long', 'short', 'today'].forEach((kind) => {
    const items = store.get('plan:' + kind, [])
    if (items.some((it) => !it.id)) {
      store.set('plan:' + kind, items.map((it) => ({ id: uid(), text: it.text || '', done: !!it.done })))
    }
  })
}

/* ---------- 计划文字样式：颜色 / 字号 / 粗细（每组单独设置） ----------
   store 键 plan:style:<kind> = { color: hex|null(跟随主题), size: 14, weight: 400 } */
function getPlanStyle(kind) { return store.get('plan:style:' + kind, { color: null, size: 14, weight: 400 }) }
function applyPlanStyle(kind, root = document) {
  const s = getPlanStyle(kind)
  /* 关系：主窗口计划与悬浮窗今日卡是不同的 DOM 容器——
     ① 主窗：.plan-group[data-kind=X] 下 .pi-text / .plan-item
     ② 悬浮窗：.today-card 下 .pi-text（今日任务，无 plan-group 父容器） */
  const groups = kind === 'today'
    ? root.querySelectorAll('.plan-group[data-kind="today"] .pi-text, .plan-group[data-kind="today"] .plan-item')
    : root.querySelectorAll('.plan-group[data-kind="' + kind + '"] .pi-text, .plan-group[data-kind="' + kind + '"] .plan-item')
  groups.forEach((t) => {
    const txt = t.classList.contains('pi-text') ? t : t.querySelector('.pi-text')
    if (!txt) return
    txt.style.color = s.color || ''
    txt.style.fontSize = (s.size || 14) + 'px'
    txt.style.fontWeight = String(s.weight || 400)
  })
  if (kind === 'today') {
    root.querySelectorAll('.today-card .pi-text').forEach((txt) => {
      txt.style.color = s.color || ''
      txt.style.fontSize = (s.size || 14) + 'px'
      txt.style.fontWeight = String(s.weight || 400)
    })
  }
}
function applyPlanStyleAll() { ['today', 'short', 'long'].forEach((k) => applyPlanStyle(k)) }
function paintRangeFill(inp) {
  const min = parseFloat(inp.min) || 0, max = parseFloat(inp.max) || 100
  const v = parseFloat(inp.value) || 0
  const pct = max > min ? ((v - min) / (max - min)) * 100 : 0
  inp.style.setProperty('--fill', pct + '%')
}
function openPlanStyle(kind) {
  const modal = el('div', 'modal')
  modal.id = 'plan-style-modal'
  modal.style.zIndex = '90'
  const card = el('div', 'card modal-card')
  const names = { today: '今日任务', short: '短期计划', long: '长期目标' }
  card.appendChild(el('h3', null, '「' + (names[kind] || kind) + '」文字样式'))
  const s = getPlanStyle(kind)
  const colorRow = el('div', 'set-row')
  colorRow.append(el('span', 'unit', '颜色'))
  let picked = s.color || null
  const themeBtn = el('button', 'btn btn-ghost' + (picked ? '' : ' on'), '跟随主题色')
  themeBtn.style.fontSize = '11px'
  const pickBtn = el('button', 'btn btn-ghost' + (picked ? ' on' : ''), '选择颜色')
  pickBtn.style.fontSize = '11px'
  const original = s.color || null
  const curTheme = () => Cards.currentThemeHex()
  themeBtn.addEventListener('click', () => {
    picked = null
    themeBtn.classList.add('on'); pickBtn.classList.remove('on')
    store.set('plan:style:' + kind, { color: null, size: parseInt(sizeIn.value, 10) || 14, weight: parseInt(weightIn.value, 10) || 400 })
    applyPlanStyle(kind)
  })
  pickBtn.addEventListener('click', () => {
    window.cunjin?.colorPicker?.open({ kind: 'plan', id: kind, original, initial: picked || curTheme() })
    themeBtn.classList.remove('on'); pickBtn.classList.add('on')
    modal.classList.add('color-compare')
  })
  const unreg = () => Cards.unregisterColorPickerModal('plan')
  Cards.registerColorPickerModal('plan', {
    onPicked: (hex) => {
      picked = hex || null
      store.set('plan:style:' + kind, { color: picked, size: parseInt(sizeIn.value, 10) || 14, weight: parseInt(weightIn.value, 10) || 400 })
      applyPlanStyle(kind)
    },
    onResolved: () => { modal.classList.remove('color-compare'); unreg() },
  })
  colorRow.append(themeBtn, pickBtn)

  /* 字号滑杆：拖动时设置页透明（compare-mode 原地保留滑杆行），进度显示修复（paintRangeFill） */
  const sizeRow = el('div', 'set-row')
  sizeRow.append(el('span', 'unit', '字号'))
  const sizeIn = document.createElement('input')
  sizeIn.type = 'range'; sizeIn.min = 11; sizeIn.max = 22; sizeIn.value = s.size || 14
  paintRangeFill(sizeIn)
  const sizeVal = el('span', 'range-val', (s.size || 14) + 'px')
  sizeRow.append(sizeIn, sizeVal)

  const weightRow = el('div', 'set-row')
  weightRow.append(el('span', 'unit', '粗细'))
  const weightIn = document.createElement('input')
  weightIn.type = 'range'; weightIn.min = 300; weightIn.max = 900; weightIn.step = 100; weightIn.value = s.weight || 400
  paintRangeFill(weightIn)
  const weightVal = el('span', 'range-val', String(s.weight || 400))
  weightRow.append(weightIn, weightVal)

  /* compare-mode：拖滑杆 → 设置页透明化（只留滑杆行，用户在现实中看计划文字变化） */
  const bindCompare = (row, inp) => {
    inp.addEventListener('pointerdown', () => { modal.classList.add('compare-mode'); row.classList.add('cmp-live') })
    inp.addEventListener('pointerup', () => { modal.classList.remove('compare-mode'); row.classList.remove('cmp-live') })
    inp.addEventListener('blur', () => { modal.classList.remove('compare-mode'); row.classList.remove('cmp-live') })
  }
  bindCompare(sizeRow, sizeIn)
  bindCompare(weightRow, weightIn)

  const liveApply = () => {
    const ps = { color: picked, size: parseInt(sizeIn.value, 10) || 14, weight: parseInt(weightIn.value, 10) || 400 }
    store.set('plan:style:' + kind, ps)
    applyPlanStyle(kind)
  }
  ;[sizeIn, weightIn].forEach((inp) => inp.addEventListener('input', () => { paintRangeFill(inp); liveApply() }))

  const btnRow = el('div', 'set-row')
  const cancel = el('button', 'btn btn-ghost', '关闭')
  cancel.addEventListener('click', () => { unreg(); modal.remove() })
  const ok = el('button', 'btn', '完成')
  ok.style.flex = '1'
  ok.addEventListener('click', () => { unreg(); liveApply(); modal.remove() })
  btnRow.append(cancel, ok)

  card.append(colorRow, sizeRow, weightRow, btnRow)
  modal.appendChild(card)
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove() })
  document.body.appendChild(modal)
}

/* 计划任务行拖拽排序（占位符方案：被拖行跟手 + 原位置保留等高占位符，其他行不动 → 不反复移动） */
function dragItem(li, items, id, save, ev) {
  const list = li.parentElement
  const startX = ev.clientX
  const startY = ev.clientY
  const orig = li.getBoundingClientRect()
  li.classList.add('pi-dragging')
  li.style.position = 'absolute'
  li.style.left = orig.left + 'px'
  li.style.top = orig.top + 'px'
  li.style.width = orig.width + 'px'
  li.style.zIndex = '90'
  li.style.margin = '0'
  /* 原位置留等高占位符（flex column 下须 flex-shrink:0，防被压缩 → 空间不缩减） */
  const ph = document.createElement('li')
  ph.className = 'plan-item reorder-ph'
  ph.style.height = orig.height + 'px'
  ph.style.minHeight = orig.height + 'px'
  ph.style.flexShrink = '0'
  list.replaceChild(ph, li)
  document.body.appendChild(li) // 脱离滚动容器（与组件卡片幽灵同理）

  const movePh = (e) => {
    const cy = e.clientY
    const items = [...list.children].filter((x) => x !== ph && !x.classList.contains('reorder-ph'))
    const idx = items.findIndex((c) => {
      const r = c.getBoundingClientRect()
      return r.top + r.height / 2 > cy
    })
    const target = idx === -1 ? null : items[idx]
    if (target && target.id !== id) list.insertBefore(ph, target)
    else if (!target) list.appendChild(ph)
  }
  const onMove = (e) => {
    li.style.left = (orig.left + (e.clientX - startX)) + 'px'
    li.style.top = (orig.top + (e.clientY - startY)) + 'px'
    movePh(e)
  }
  const onUp = () => {
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onUp)
    /* li 插回占位符位置（占位符保持在文档流槽位） */
    list.insertBefore(li, ph)
    ph.remove()
    li.classList.remove('pi-dragging')
    li.style.position = ''
    li.style.left = ''; li.style.top = ''; li.style.width = ''; li.style.zIndex = ''; li.style.margin = ''
    /* 提交顺序 */
    const newItems = [...list.querySelectorAll('.plan-item[data-id]')].map((x) => items.find((it) => it.id === x.dataset.id) || null).filter(Boolean)
    save(newItems)
  }
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onUp)
}

function initPlan() {
  migratePlanData()
  const planRenders = [] // 供 store-changed 跨窗口同步（悬浮窗改计划 → 主界面重渲染）

  $$('.plan-group').forEach((group) => {
    const kind = group.dataset.kind
    const list = $('.plan-list', group)
    const toggleBtn = $('.plan-toggle', group)
    const inputWrap = $('.plan-input-wrap', group)
    const input = $('.plan-input', group)
    const cancelBtn = $('.plan-cancel', group)
    const okBtn = $('.plan-ok', group)

    const render = () => {
      const items = store.get('plan:' + kind, [])
      list.innerHTML = ''
      items.forEach((it) => {
        const li = el('li', 'plan-item' + (it.done ? ' done' : ''))
        li.dataset.id = it.id

        const check = el('span', 'pi-check')
        check.title = '完成 / 取消完成'
        check.addEventListener('click', () => {
          const items = store.get('plan:' + kind, [])
          const cur = items.find((x) => x.id === it.id)
          if (cur) cur.done = !cur.done
          store.set('plan:' + kind, items)
          render()
        })

        let text = el('span', 'pi-text')
        text.textContent = it.text

        const edit = el('button', 'pi-edit', '✎')
        edit.title = '编辑'
        edit.addEventListener('click', () => {
          /* 行内编辑：任务本身变成输入框（不是下面弹输入框） */
          text.remove()
          const input = document.createElement('input')
          input.type = 'text'
          input.className = 'pi-inline-edit'
          input.value = it.text
          const commit = () => {
            const v = input.value.trim()
            const items = store.get('plan:' + kind, [])
            const cur = items.find((x) => x.id === it.id)
            if (cur && v) cur.text = v
            store.set('plan:' + kind, items)
            render()
          }
          input.addEventListener('keydown', (e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') render()
          })
          input.addEventListener('blur', commit)
          input.addEventListener('click', (e) => e.stopPropagation())
          li.insertBefore(input, edit)
          input.focus()
          input.select()
        })

        const del = el('button', 'pi-del', '×')
        del.title = '删除'
        del.addEventListener('click', () => {
          store.set('plan:' + kind, store.get('plan:' + kind, []).filter((x) => x.id !== it.id))
          render()
        })

        /* 拖拽排序手柄（圆圈左边） */
        const drag = el('button', 'pi-drag', '≡')
        drag.title = '拖动排序'
        drag.addEventListener('pointerdown', (e) => {
          e.preventDefault()
          const items = store.get('plan:' + kind, [])
          dragItem(li, items, it.id, (newItems) => { store.set('plan:' + kind, newItems); render() }, e)
        })

        li.append(drag, check, text, edit, del)
        list.appendChild(li)
      })
    }

    const showInput = () => {
      inputWrap.classList.remove('hidden')
      input.focus()
      autosize(input)
    }
    const hideInput = () => {
      inputWrap.classList.add('hidden')
      input.value = ''
      autosize(input)
    }
    const add = () => {
      const text = input.value.replace(/\s+$/, '')
      if (!text.trim()) { hideInput(); return }
      const items = store.get('plan:' + kind, [])
      items.push({ id: uid(), text, done: false })
      store.set('plan:' + kind, items)
      hideInput()
      render()
    }

    /* 右上角小「＋」按钮，点击才展开输入框 */
    toggleBtn.addEventListener('click', () => {
      if (inputWrap.classList.contains('hidden')) showInput()
      else hideInput()
    })
    cancelBtn.addEventListener('click', () => hideInput())
    okBtn.addEventListener('click', () => add())
    input.addEventListener('input', () => autosize(input))
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        add()
      } else if (e.key === 'Escape') {
        hideInput()
      }
    })
    /* 点击输入区之外收起（但点击卡片内部按钮除外） */
    document.addEventListener('click', (e) => {
      if (!group.contains(e.target) && !inputWrap.classList.contains('hidden')) hideInput()
    })

    render()
    planRenders.push(render)
  })
  /* 主界面计划随跨窗口数据变化刷新（悬浮窗勾选/编辑 → 主界面同步） */
  document.addEventListener('store-changed', () => { planRenders.forEach((r) => r()); applyPlanStyleAll() })
  /* 首次应用计划文字样式（每组独立） */
  applyPlanStyleAll()
  /* 每组标题行的 ⋯ 按钮：打开该组样式设置 */
  $$('.plan-style-for').forEach((b) => {
    b.addEventListener('click', () => openPlanStyle(b.dataset.for))
  })
}

/* 悬浮窗：今日任务紧凑视图（勾选/取消，编辑去主窗口） */
function renderTodayCompact(container, onChanged, onRemove) {
  container.innerHTML = ''
  const card = el('div', 'card today-card')
  card.dataset.type = 'today'
  card.dataset.id = 'today'
  /* 悬浮窗按钮：− 移出悬浮窗（数据保留）；× 移出（确认后，同样只是移出窗口，今日任务数据保在 plan:today） */
  const head = el('div', 't-head')
  const title = el('span', null, '今日任务')
  if (onRemove) {
    const remove = el('button', 't-out', '−')
    remove.title = '移出悬浮窗（数据保留）'
    remove.addEventListener('click', (e) => { e.stopPropagation(); onRemove(false) })
    const del = el('button', 't-del', '×')
    del.title = '移出悬浮窗（确认）'
    del.addEventListener('click', () => {
      if (window.confirm('确定要将「今日任务」移出悬浮窗吗？（数据保留）')) onRemove(false)
    })
    head.append(remove, del)
  }
  const drag = el('button', 't-drag', '≡')
  drag.title = '拖动排序'
  head.append(title, drag)
  card.appendChild(head)
  const list = el('ul', 'plan-list')
  const items = store.get('plan:today', [])
  if (!items.length) {
    const empty = el('li', 'plan-item')
    const t = el('span', 'pi-text', '今天还没有任务')
    t.style.color = 'var(--muted)'
    empty.appendChild(t)
    list.appendChild(empty)
  }
  items.forEach((it) => {
    const li = el('li', 'plan-item' + (it.done ? ' done' : ''))
    li.dataset.id = it.id
    const check = el('span', 'pi-check')
    check.addEventListener('click', () => {
      const arr = store.get('plan:today', [])
      const cur = arr.find((x) => x.id === it.id)
      if (cur) cur.done = !cur.done
      store.set('plan:today', arr)
      if (typeof onChanged === 'function') onChanged()
      else renderTodayCompact(container) // 兜底
    })
    const text = el('span', 'pi-text')
    text.textContent = it.text
    /* 拖拽排序手柄（圆圈左边；写在 check 前） */
    const drag = el('button', 'pi-drag', '≡')
    drag.title = '拖动排序'
    drag.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      const arr = store.get('plan:today', [])
      dragItem(li, arr, it.id, (newItems) => {
        store.set('plan:today', newItems)
        if (typeof onChanged === 'function') onChanged()
        else renderTodayCompact(container)
      }, e)
    })
    li.append(drag, check, text)
    list.appendChild(li)
  })
  card.appendChild(list)
  container.appendChild(card)
  /* 悬浮窗今日任务文字应用「今日任务」组样式。
     关系：renderTodayCompact 的 container 在 render() 里尚未挂到 document，
     必须对 container 应用样式（默认 root=document 匹配不到 → 用户看到"不生效"） */
  applyPlanStyle('today', container)
}
