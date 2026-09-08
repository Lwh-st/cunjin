// 寸进 · 共享卡片组件：计时器 / 进度条（主窗口 + 悬浮窗共用）
// 精简形态：名字 + 设置(⋯) + 删除(×) + 显示 + 开始/重置（正计时附间隔徽标）
// 修改配置走设置弹窗（openTimerSettings / openProgressSettings）
'use strict'

const RING_C = 213.6

const Cards = (() => {
  /* ---------- 数据访问 ---------- */
  const allTimers = () => store.get('timers', [])
  const saveTimers = (arr) => store.set('timers', arr)
  const getTimer = (id) => allTimers().find((t) => t.id === id)
  function setTimer(id, patch) {
    const arr = allTimers()
    const t = arr.find((x) => x.id === id)
    if (t) Object.assign(t, patch)
    saveTimers(arr)
  }
  const allProgress = () => store.get('progress', [])
  const saveProgress = (arr) => store.set('progress', arr)
  const getProgress = (id) => allProgress().find((p) => p.id === id)
  function setProgress(id, patch) {
    const arr = allProgress()
    const p = arr.find((x) => x.id === id)
    if (p) Object.assign(p, patch)
    saveProgress(arr)
  }

  /* ---------- 默认名字：按「场上最大编号 + 1」，不与位置/数量绑定 ----------
     背景：旧版按数组下标（idx+1）生成显示名 → 换位后名字跟着位置变，用户误判"没换位"。
     现在：新建即写入 store（名字持久化），编号 = 现已存在名字里最大数字 + 1。
     例如场上 [计时器1, 计时器2, 计时器4] → 新建默认「计时器5」。 */
  const maxNumOf = (arr, prefix) => arr.reduce((m, x) => {
    const m2 = new RegExp('^' + prefix + '\\s?(\\d+)$').exec((x.name || '').trim())
    return m2 ? Math.max(m, parseInt(m2[1], 10)) : m
  }, 0)
  const nextTimerDefaultName = () => '计时器 ' + (maxNumOf(allTimers(), '计时器') + 1)
  const nextProgressDefaultName = () => '进度 ' + (maxNumOf(allProgress(), '进度') + 1)
  /* 给未命名旧数据补默认名（一次性迁移：保证名字在 store 里，换位不联动）。
     编号取「已处理项」当前最大 +1，保证每项唯一且递增 */
  function ensureDefaultNames() {
    const timers = allTimers()
    const progress = allProgress()
    let changed = false
    let tMax = maxNumOf(timers, '计时器')
    for (const t of timers) {
      if (!t.name || !t.name.trim()) {
        tMax += 1
        t.name = '计时器 ' + tMax
        changed = true
      }
      /* every 语义迁移：旧版正计时间隔按「分钟」存（15=15分钟）；新版按「秒」。
         一次性标记 __everyMigrated=1 后不再迁移 */
      if (!t.__everyMigrated) {
        if (parseFloat(t.every) > 0) t.every = parseFloat(t.every) * 60 // 分钟 → 秒
        t.__everyMigrated = 1
        changed = true
      }
    }
    let pMax = maxNumOf(progress, '进度')
    for (const p of progress) {
      if (!p.name || !p.name.trim()) {
        pMax += 1
        p.name = '进度 ' + pMax
        changed = true
      }
    }
    if (changed) { saveTimers(timers); saveProgress(progress) }
  }

  /* ---------- 计时器：时间计算 ---------- */
  function totalMs(t) {
    const sec = (parseFloat(t.minutes) || 0) * 60 + (parseFloat(t.seconds) || 0)
    return Math.max(1000, sec * 1000) /* 秒精度（旧数据 minutes=25 → 25分；新数据 minutes+seconds） */
  }
  function leftOf(t) {
    if (t.mode !== 'down') return 0
    if (t.state === 'running' && t.endAt) return Math.max(0, t.endAt - Date.now())
    return t.left ?? totalMs(t)
  }
  function elapsedOf(t) {
    if (t.mode !== 'up') return 0
    return (t.base || 0) + (t.state === 'running' && t.startAt ? Date.now() - t.startAt : 0)
  }
  function fracOf(t) {
    if (t.mode === 'down') return Math.min(1, leftOf(t) / totalMs(t))
    const every = (parseFloat(t.every) || 0) * 1000
    const cycle = every > 0 ? every : 3600000
    return (elapsedOf(t) % cycle) / cycle
  }

  /* ---------- 行内名字编辑：点击名字 → 变输入框，Enter/失焦保存、Esc 取消 ---------- */
  function inlineNameEdit(nameEl, getText, save) {
    nameEl.addEventListener('click', () => {
      const input = document.createElement('input')
      input.type = 'text'
      input.className = nameEl.classList.contains('t-name') ? 't-name-edit' : 'p-name-edit'
      input.value = getText()
      const commit = () => {
        const v = input.value.trim()
        if (v) save(v)
        nameEl.style.display = ''
        input.remove()
        nameEl.textContent = getText()
      }
      const cancel = () => {
        nameEl.style.display = ''
        input.remove()
      }
      input.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') cancel()
      })
      input.addEventListener('blur', commit)
      input.addEventListener('click', (e) => e.stopPropagation())
      nameEl.style.display = 'none'
      nameEl.parentNode.insertBefore(input, nameEl.nextSibling)
      input.focus()
      input.select()
      input.addEventListener('keyup', (e) => e.stopPropagation())
    })
  }

  /* ---------- 计时器：显示 ---------- */
  function buildTimerDisplay(t, box) {
    box.innerHTML = ''
    if (t.shape === 'ring') {
      const svgNS = 'http://www.w3.org/2000/svg'
      const svg = document.createElementNS(svgNS, 'svg')
      svg.setAttribute('viewBox', '0 0 84 84')
      svg.classList.add('ring')
      const bg = document.createElementNS(svgNS, 'circle')
      bg.setAttribute('cx', 42); bg.setAttribute('cy', 42); bg.setAttribute('r', 34)
      bg.classList.add('ring-bg')
      const fg = document.createElementNS(svgNS, 'circle')
      fg.setAttribute('cx', 42); fg.setAttribute('cy', 42); fg.setAttribute('r', 34)
      fg.classList.add('ring-fg')
      fg.style.strokeDasharray = RING_C
      fg.dataset.role = 'fg'
      const label = document.createElementNS(svgNS, 'text')
      label.setAttribute('x', 42); label.setAttribute('y', 43)
      label.dataset.role = 'time'
      svg.append(bg, fg, label)
      box.appendChild(svg)
    } else if (t.shape === 'hourglass') {
      const wrap = el('div', 'hg-wrap')
      const hg = el('div', 'hg')
      hg.append(el('div', 'hg-glass'), el('div', 'hg-top'), el('div', 'hg-sand'), el('div', 'hg-stream'))
      const time = el('div', 'hg-time')
      time.dataset.role = 'time'
      wrap.append(hg, time)
      box.appendChild(wrap)
    } else {
      const d = el('div', 'time-display')
      d.dataset.role = 'time'
      box.appendChild(d)
    }
    paintTimerDisplay(t, box)
  }

  function paintTimerDisplay(t, box) {
    box.classList.toggle('running', t.state === 'running')
    const frac = fracOf(t)
    const timeEl = box.querySelector('[data-role="time"]')
    const str = t.mode === 'down' ? fmt(leftOf(t)) : fmt(elapsedOf(t))

    if (t.shape === 'ring') {
      box.querySelector('[data-role="fg"]').style.strokeDashoffset = String(RING_C * (1 - frac))
      timeEl.textContent = str
    } else if (t.shape === 'hourglass') {
      const bottom = t.mode === 'down' ? 1 - frac : frac
      box.querySelector('.hg-top').style.transform = 'scaleY(' + (1 - bottom) + ')'
      box.querySelector('.hg-sand').style.transform = 'scaleY(' + bottom + ')'
      timeEl.textContent = str
    } else {
      timeEl.textContent = str
    }
  }

  /* 时间样式等比适配：用「离屏克隆」实测文本宽度（不受容器宽度/overflow 污染），
     探针必须带与 .time-display 完全相同的 letter-spacing，否则实测偏窄、字号算大、最后一位被切 */
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;white-space:nowrap;font-family:"Cascadia Mono",Consolas,monospace;font-size:100px;letter-spacing:2px'
  document.body.appendChild(probe)
  function measureRatio(text) {
    probe.textContent = text
    const w = probe.getBoundingClientRect().width
    return Math.max(1, w / 100) // 每个 1px 字号占多少 px 宽
  }
  function fitTimerDisplay(t, box) {
    const w = box.clientWidth, h = box.clientHeight
    if (!w || !h) return
    /* 显示区高度随宽度增长（h = w × 0.62），但封顶 260px：三种形态跟窗口等比例变化
       且不再无限变大（用户要求组件最高高度有限制） */
    const targetH = Math.min(Math.round(w * 0.62), 260)
    if (Math.abs(box.clientHeight - targetH) > 4 && targetH >= 44) {
      box.style.minHeight = targetH + 'px'
    }
    const str = t.mode === 'down' ? fmt(leftOf(t)) : fmt(elapsedOf(t))
    if (t.shape === 'ring') {
      const ring = box.querySelector('.ring')
      if (ring) {
        const side = Math.min(w * 0.92, h * 0.92)   // 正方形：取最大能放下
        ring.style.width = side + 'px'
        ring.style.height = side + 'px'
        /* 圆环内时间字号由 CSS 控制（viewBox 单位 15px）——不能按屏幕像素设，
           SVG text 字号按 viewBox 坐标系渲染，像素值会变成巨型文字超出圆环 */
      }
    } else if (t.shape === 'hourglass') {
      const hg = box.querySelector('.hg')
      if (hg) {
        hg.style.width = Math.round(w * 0.18) + 'px'
        hg.style.height = Math.round(h * 0.62) + 'px'
      }
      const ht = box.querySelector('.hg-time')
      if (ht) {
        const ratio = measureRatio(str)
        ht.style.fontSize = Math.max(10, Math.min((w * 0.5) / ratio, h * 0.2)) + 'px'
      }
    } else {
      const d = box.querySelector('.time-display')
      if (d) {
        /* 直接实测 DOM 宽度（inline-block 宽度=文本实际宽度），循环降档直到装下。
           无最小字号下限：极窄显示区（双列+小窗）下也要缩到能装下 */
        const limitW = w * 0.86
        let fs = Math.min(limitW / measureRatio(str), h * 1.1) // 初始值稍大，往下降
        d.style.fontSize = Math.max(8, Math.round(fs)) + 'px'
        for (let i = 0; i < 10; i++) {
          const realW = d.getBoundingClientRect().width
          if (realW <= limitW || Math.round(fs) <= 8) break
          fs = fs * (limitW / realW) * 0.97
          d.style.fontSize = Math.max(8, Math.round(fs)) + 'px'
        }
      }
    }
  }

  /* ---------- 计时器：卡片 ---------- */
  function timerCard(t, opts = {}) {
    const card = el('div', 'card timer-card')
    card.dataset.id = t.id
    card.dataset.type = 'timer'

    /* 默认名：像进度条一样自动编号（计时器 1、计时器 2…） */
    if (!t.name) {
      const idx = allTimers().findIndex((x) => x.id === t.id)
      t = { ...t, name: '计时器 ' + (idx + 1) }
    }

    const body = el('div', 't-body')          // 左右分栏：左=名字+控件，右=显示区
    const side = el('div', 't-side')          // 左栏
    const head = el('div', 't-head')
    const name = el('div', 't-name', t.name || '计时器')
    name.title = '点击直接修改名称'
    inlineNameEdit(name, () => getTimer(t.id)?.name || t.name || '', (v) => {
      setTimer(t.id, { name: v })
      opts.onChanged?.()
    })
    const gear = el('button', 't-gear', '⋯')
    gear.title = '设置'
    gear.addEventListener('click', () => openTimerSettings(t.id, opts.onChanged))
    const del = el('button', 't-del', '×')
    if (opts.widget) {
      /* 悬浮窗：×=删除（确认后删数据）；「−」=仅移出由 buildWidgetCardButtons 加 */
      del.title = '删除（需确认）'
      del.addEventListener('click', () => {
        confirmDialog('确定要删除这个计时器吗？删除后主界面与悬浮窗都没有了。', '删除', () => {
          saveTimers(allTimers().filter((x) => x.id !== t.id))
          opts.onChanged?.()
        })
      })
    } else {
      del.title = '删除计时器'
      del.addEventListener('click', () => {
        saveTimers(allTimers().filter((x) => x.id !== t.id))
        opts.onChanged?.()
      })
    }
    /* 悬浮窗头部加「−」移出按钮（独立 class .t-out，避免被拖拽捕获）；
       位置：组件设置按钮(⋯)与删除(×)中间 */
    let remove = null
    if (opts.widget) {
      remove = el('button', 't-out', '−')
      remove.title = '移出悬浮窗（数据保留）'
      remove.addEventListener('click', (e) => { e.stopPropagation(); opts.onRemoveFromLayout?.() })
    }
    /* 拖拽排序手柄（主界面/悬浮窗通用）：pointer 事件版（cards.js attachDrag 处理） */
    const drag = el('button', 't-drag', '≡')
    drag.title = '拖动排序'
    head.append(name, drag, gear)
    if (opts.widget && remove) head.append(remove)
    head.append(del)

    const controls = el('div', 't-controls')
    const mainBtn = el('button', 'btn', t.state === 'running' ? '暂停' : t.state === 'paused' ? '继续' : '开始')
    const resetBtn = el('button', 'btn btn-ghost', '重置')
    mainBtn.addEventListener('click', () => {
      const cur = getTimer(t.id)
      if (!cur) return
      if (cur.state === 'running') {
        if (cur.mode === 'down') setTimer(t.id, { state: 'paused', left: leftOf(cur), endAt: null })
        else setTimer(t.id, { state: 'paused', base: elapsedOf(cur), startAt: null })
      } else {
        const patch = { state: 'running' }
        if (cur.mode === 'down') patch.endAt = Date.now() + leftOf(cur)
        else patch.startAt = Date.now()
        setTimer(t.id, patch)
      }
      opts.onChanged?.()
    })
    resetBtn.addEventListener('click', () => {
      setTimer(t.id, { state: 'idle', left: t.mode === 'down' ? totalMs(t) : 0, base: 0, startAt: null, endAt: null, notified: 0 })
      opts.onChanged?.()
    })
    controls.append(mainBtn, resetBtn)

    /* 正计时：常显间隔徽标（点击可改） */
    if (t.mode === 'up') {
      const badge = el('span', 't-every-badge', '每 ' + fmtEvery(t.every) + ' 提醒')
      badge.title = '点击修改提醒间隔'
      badge.style.cursor = 'pointer'
      badge.addEventListener('click', () => openTimerSettings(t.id, opts.onChanged))
      controls.appendChild(badge)
    }
    side.append(head, controls)

    const display = el('div', 't-display')    // 右栏：大显示区，三种样式统一高度
    /* 时间数字颜色：effectiveColor = 临时预览色（previewColors）优先 > store color > 主题色 */
    display.style.setProperty('--time-color', effectiveColor('timer', t.id, t.color, 'var(--accent-strong)'))
    buildTimerDisplay(t, display)

    body.append(side, display)
    card.appendChild(body)

    /* 尺寸变化（窗口缩放/列数切换）→ 立即重新等比适配时间样式 */
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => fitTimerDisplay(getTimer(t.id) || t, display))
      ro.observe(display)
      display._fitObserver = ro
    }
    /* 初次渲染完成即适配一次（不等 tick） */
    requestAnimationFrame(() => fitTimerDisplay(getTimer(t.id) || t, display))
    return card
  }

  /* ---------- 计时器：tick 引擎（每窗口一个；状态变更与通知仅主窗口执行，避免竞态） ---------- */
  function startTicking(queryRoot) {
    setInterval(() => {
      const timers = allTimers()
      /* 所有计时器卡片（含 idle）：每 tick 重绘+尺寸适配，保证时间样式随卡片变化 */
      for (const t of timers) {
        const card = queryRoot.querySelector('.timer-card[data-id="' + t.id + '"]')
        if (card) {
          const disp = $('.t-display', card)
          paintTimerDisplay(t, disp)
          fitTimerDisplay(t, disp)
          const b = $('.t-controls .btn', card)
          if (b) b.textContent = t.state === 'running' ? '暂停' : t.state === 'paused' ? '继续' : '开始'
        }
        if (t.state !== 'running') continue
        if (IS_MAIN) {
          if (t.mode === 'down' && leftOf(t) <= 0) {
            setTimer(t.id, { state: 'idle', left: totalMs(t), endAt: null, startAt: null, base: 0, notified: 0 })
            notify('寸进 · ' + (t.name || '倒计时') + ' 结束', '时间到了，休息一下或进行下一项。')
            document.body.classList.add('flash')
            setTimeout(() => document.body.classList.remove('flash'), 2200)
            continue
          }
          if (t.mode === 'up') {
            const e = elapsedOf(t)
            const every = (parseFloat(t.every) || 0) * 1000
            if (every > 0) {
              const n = Math.floor(e / every)
              if (n > (t.notified || 0)) {
                setTimer(t.id, { notified: n })
                notify('寸进 · ' + (t.name || '正计时'), '已坚持 ' + fmt(e) + '，继续保持。')
              }
            }
          }
        }
      }
    }, 250)
  }

  /* ---------- 计时器：设置弹窗 ---------- */
  function openTimerSettings(id, onChanged) {
    const t = getTimer(id)
    if (!t) return
    closeModal()

    const modal = el('div', 'modal')
    const card = el('div', 'card modal-card')
    const title = el('h3', null, '计时器设置')

    const nameRow = el('div', 'set-row')
    const nameInput = document.createElement('input')
    nameInput.type = 'text'
    nameInput.value = t.name || ''
    nameInput.placeholder = '名称'
    nameInput.style.flex = '1'
    nameRow.append(nameInput)

    const typeRow = el('div', 'set-row')
    typeRow.append(el('span', 'unit', '类型'))
    const mkSeg = (mode, label) => {
      const b = el('button', 'seg' + (t.mode === mode ? ' on' : ''), label)
      b.dataset.mode = mode
      b.addEventListener('click', () => {
        $$('.seg', typeRow).forEach((x) => x.classList.toggle('on', x.dataset.mode === mode))
        numWrap.innerHTML = ''
        buildNumInputs(mode)
      })
      return b
    }
    typeRow.append(mkSeg('down', '倒计时'), mkSeg('up', '正计时'))

    const numWrap = el('div', 'set-row')
    let minutesInput = null, secondsInput = null, everyInput = null, everySecInput = null
    function buildNumInputs(mode) {
      numWrap.innerHTML = ''
      if (mode === 'down') {
        minutesInput = document.createElement('input')
        minutesInput.type = 'number'; minutesInput.min = 0; minutesInput.max = 600
        minutesInput.value = t.minutes ?? 25
        minutesInput.style.width = '56px'
        secondsInput = document.createElement('input')
        secondsInput.type = 'number'; secondsInput.min = 0; secondsInput.max = 59
        secondsInput.value = t.seconds ?? 0
        secondsInput.style.width = '56px'
        numWrap.append(el('span', 'unit', '时长'), minutesInput, el('span', 'unit', '分'), secondsInput, el('span', 'unit', '秒'))
      } else {
        everyInput = document.createElement('input')
        everyInput.type = 'number'; everyInput.min = 0; everyInput.max = 480
        everyInput.value = Math.floor(t.every ?? 15)
        everyInput.style.width = '56px'
        everySecInput = document.createElement('input')
        everySecInput.type = 'number'; everySecInput.min = 0; everySecInput.max = 59
        everySecInput.value = ((t.every ?? 15) % 1) ? Math.round(((t.every ?? 15) % 1) * 60) : 0
        everySecInput.style.width = '56px'
        numWrap.append(el('span', 'unit', '每'), everyInput, el('span', 'unit', '分'), everySecInput, el('span', 'unit', '秒提醒（全0=关）'))
      }
    }
    buildNumInputs(t.mode)

    const shapeRow = el('div', 'set-row')
    const shapeSel = document.createElement('select')
    ;[['digits', '数字'], ['ring', '圆环时钟'], ['hourglass', '沙漏']].forEach(([v, label]) => {
      const o = document.createElement('option')
      o.value = v; o.textContent = label
      if (t.shape === v) o.selected = true
      shapeSel.appendChild(o)
    })
    shapeSel.classList.add('cs-dynamic')
    shapeRow.append(el('span', 'unit', '形态'), shapeSel)
    enhanceSelects(shapeRow) // 动态 create 的 select 也要自绘（浮窗内同样生效）

    /* 时间数字颜色：跟随主题色（默认）/ 选择颜色（**独立窗口**弹在右侧，可超出主界面窗口） */
    const colorRow = el('div', 'set-row')
    colorRow.append(el('span', 'unit', '时间颜色'))
    let pickedColor = t.color || null
    const themeBtn = el('button', 'btn btn-ghost' + (pickedColor ? '' : ' on'), '跟随主题色')
    themeBtn.type = 'button'
    themeBtn.style.fontSize = '11px'
    const pickBtn = el('button', 'btn btn-ghost' + (pickedColor ? ' on' : ''), '选择颜色')
    pickBtn.type = 'button'
    pickBtn.style.fontSize = '11px'
    /* 独立调色盘窗口共享处理器（preview/commit/cancel 全局只绑定一次） */
    ensureColorPickerHandlers()
    const original = t.color || null
    let pickerOpen = false

    themeBtn.addEventListener('click', () => {
      pickedColor = null
      setTimer(id, { color: null })
      themeBtn.classList.add('on')
      pickBtn.classList.remove('on')
      onChanged?.()
    })
    pickBtn.addEventListener('click', () => {
      /* 若之前选了「选择颜色」，初始色=已选色；若之前跟随主题色，初始色=当前主题色 */
      const curColor = pickedColor || currentThemeHex()
      window.cunjin?.colorPicker?.open({ kind: 'timer', id, original, initial: curColor })
      pickerOpen = true
      themeBtn.classList.remove('on')
      pickBtn.classList.add('on')
      modal.classList.add('color-compare') // 调色期间：左设置页透明（只有独立色盘窗口不透明）
      onChanged?.()
    })
    colorRow.append(themeBtn, pickBtn)

    /* 注册「色盘窗口 → 设置弹窗」同步（关系索引 §23）：色盘 commit/preview 更新 pickedColor，
       否则弹窗保存用旧值覆盖回；弹窗关闭时注销。
       ⚠️ onPicked 只更新 pickedColor+按钮态：preview 时绝不能移除 color-compare（否则调色时设置页
       又会变不透明，失去观察效果）——恢复设置页只发生在 commit/cancel/弹窗关闭时 */
    const setPicked = (hex) => {
      pickedColor = hex || null
      themeBtn.classList.toggle('on', !pickedColor)
      pickBtn.classList.toggle('on', !!pickedColor)
    }
    registerColorPickerModal('timer', { onPicked: setPicked, onResolved: () => { modal.classList.remove('color-compare') } })
    const unregTimer = () => unregisterColorPickerModal('timer')

    const btnRow = el('div', 'set-row')
    const cancel = el('button', 'btn btn-ghost', '取消')
    cancel.addEventListener('click', () => {
      /* 取消：恢复原色，不写盘 */
      if (original) setTimer(id, { color: original })
      else setTimer(id, { color: null })
      unregTimer()
      onChanged?.()
      closeModal()
    })
    const ok = el('button', 'btn', '保存')
    ok.style.flex = '1'
    ok.addEventListener('click', () => {
      const mode = $$('.seg', typeRow).find((x) => x.classList.contains('on'))?.dataset.mode || t.mode
      const patch = {
        name: nameInput.value.trim(),
        mode,
        shape: shapeSel.value,
        color: pickedColor, // null = 跟随主题色（已被色盘窗口 commit 同步为最新）
        state: 'idle',
        startAt: null,
        endAt: null,
        base: 0,
        notified: 0,
      }
      if (mode === 'down') {
        patch.minutes = Math.min(600, Math.max(0, parseFloat(minutesInput?.value) || 0))
        patch.seconds = Math.min(59, Math.max(0, parseFloat(secondsInput?.value) || 0))
        const totalSec = patch.minutes * 60 + patch.seconds
        patch.left = totalSec * 1000
      } else {
        patch.every = Math.min(480, Math.max(0, parseFloat(everyInput?.value) || 0)) * 60 + Math.min(59, Math.max(0, parseFloat(everySecInput?.value) || 0))
        patch.left = 0
      }
      unregTimer()
      setTimer(id, patch)
      closeModal()
      onChanged?.()
    })
    btnRow.append(cancel, ok)

    /* 单列布局（调色盘已是独立窗口，无需弹窗内右栏） */
    const body = el('div', 'modal-body')
    body.append(nameRow, typeRow, numWrap, shapeRow, colorRow, btnRow)
    card.append(title, body)
    modal.appendChild(card)
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal() })
    document.body.appendChild(modal)
    nameInput.focus()
  }

  /* ---------- 进度条 ---------- */
  const PG_COLORS = ['#e2a24b', '#7fb069', '#5aa9d6', '#b58ccf', '#e26d5a', '#8f8b83']

  function paintProgress(card, p) {
    const v = p.val
    const pctEl = $('.pg-pct', card)
    if (pctEl) pctEl.textContent = Math.round(v) + '%'
    const fill = $('.pg-fill', card)
    if (fill) fill.style.width = v + '%'
    /* 发光：条子**四周轮廓**都发光（多向 box-shadow），强度/范围随 v 增大；100% 时闪烁 */
    if (fill) {
      const glow = Math.max(0, v) / 100
      const blur = Math.round(6 + glow * 34)
      const spread = Math.round(glow * 12)
      const intensity = Math.round(20 + glow * 65)
      const col = `color-mix(in srgb, var(--pg-color, var(--accent)) ${intensity}%, transparent)`
      fill.style.boxShadow = `0 0 ${blur}px ${spread}px ${col}, 0 0 ${Math.round(blur * 0.7)}px ${col}, 0 0 ${Math.round(blur * 1.4)}px ${col}`
      /* 100% 闪烁 class（CSS 动画） */
      fill.classList.toggle('pg-full', v >= 99.5)
    }
    /* 圆环样式已删除（进度条只留横条；圆环与计时器共用 .ring 互相影响） */
    /* 达 100% 且未提示过 → 弹祝贺（每进度条只弹一次：__celebrated 防重复） */
    if (v >= 99.5 && !p.__celebrated) {
      p.__celebrated = true
      setProgress(p.id, { __celebrated: true })
      celebrateProgress(p)
    }
  }

  /* 100% 祝贺弹窗（复用 confirmDialog 的 modal 风格，贴合 app 主题） */
  function celebrateProgress(p) {
    const dispName = (p.name || '').trim() || '你的进度'
    const modal = el('div', 'modal')
    modal.style.zIndex = '96'
    const card = el('div', 'card modal-card celebrate-card')
    card.appendChild(el('h3', null, '🎉 恭喜完成'))
    card.appendChild(el('p', 'celebrate-msg', '恭喜「' + dispName + '」已达成 100%！'))
    const row = el('div', 'set-row')
    const ok = el('button', 'btn', '太棒了')
    ok.style.flex = '1'
    ok.addEventListener('click', () => modal.remove())
    row.append(ok)
    card.appendChild(row)
    modal.appendChild(card)
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove() })
    document.body.appendChild(modal)
  }

  function setProgressValue(card, p, v) {
    const nv = Math.min(100, Math.max(0, v))
    setProgress(p.id, { val: nv })
    paintProgress(card, { ...p, val: nv })
  }

  function progressCard(p, idx, opts = {}) {
    const card = el('div', 'card progress-card anim-' + (p.anim || 'smooth'))
    card.dataset.id = p.id
    card.dataset.type = 'progress'
    card.style.setProperty('--pg-color', effectiveColor('progress', p.id, p.color, 'var(--accent)'))

    /* 显示名：自定义名 > 数据索引默认名（主界面/悬浮窗统一；悬浮窗传的 idx 是渲染位置，不可靠） */
    const dataIdx = allProgress().findIndex((x) => x.id === p.id)
    const defName = '进度 ' + (dataIdx + 1)
    const dispName = () => {
      const cur = getProgress(p.id)
      return (cur?.name || '').trim() || defName
    }
    const head = el('div', 'p-head')
    const name = el('div', 'p-name', dispName())
    name.title = '点击直接修改名称'
    inlineNameEdit(name, dispName, (v) => {
      setProgress(p.id, { name: v })
      opts.onChanged?.()
    })
    const gear = el('button', 'p-gear', '⋯')
    gear.title = '设置'
    gear.addEventListener('click', () => openProgressSettings(p.id, opts.onChanged))
    const del = el('button', 'p-del', '×')
    if (opts.widget) {
      del.title = '删除（需确认）'
      del.addEventListener('click', () => {
        confirmDialog('确定要删除这个进度条吗？删除后主界面与悬浮窗都没有了。', '删除', () => {
          saveProgress(allProgress().filter((x) => x.id !== p.id))
          opts.onChanged?.()
        })
      })
    } else {
      del.title = '删除进度条'
      del.addEventListener('click', () => {
        saveProgress(allProgress().filter((x) => x.id !== p.id))
        opts.onChanged?.()
      })
    }
    /* 悬浮窗头部加「−」移出按钮（独立 class；位置：⋯ 与 × 之间） */
    let remove = null
    if (opts.widget) {
      remove = el('button', 'p-out', '−')
      remove.title = '移出悬浮窗（数据保留）'
      remove.addEventListener('click', (e) => { e.stopPropagation(); opts.onRemoveFromLayout?.() })
    }
    /* 拖拽排序手柄（pointer 事件版） */
    const drag = el('button', 'p-drag', '≡')
    drag.title = '拖动排序'
    head.append(name, drag, gear)
    if (opts.widget && remove) head.append(remove)
    head.append(del)

    const display = el('div', 'p-display')
    /* 进度条只保留横条形态（圆环样式已删除，与计时器圆环共用 .ring/.ring-fg 互相影响）；
       旧数据 shape:'ring' 也按横条渲染 */
    {
      const pct = el('div', 'pg-pct')
      const track = el('div', 'pg-track')
      track.title = '拖动设置进度'
      const fill = el('div', 'pg-fill')
      track.appendChild(fill)
      track.addEventListener('pointerdown', (e) => {
        track.setPointerCapture(e.pointerId)
        const move = (ev) => {
          const r = track.getBoundingClientRect()
          setProgressValue(card, getProgress(p.id) || p, ((ev.clientX - r.left) / r.width) * 100)
        }
        move(e)
        track.addEventListener('pointermove', move)
        track.addEventListener('pointerup', () => track.removeEventListener('pointermove', move), { once: true })
      })
      display.append(pct, track)
    }

    const controls = el('div', 'p-controls')
    const minus = el('button', 'round-btn', '−')
    const plus = el('button', 'round-btn', '+')
    const stepLabel = el('span', 'unit', '每步')
    const stepInput = document.createElement('input')
    stepInput.type = 'number'; stepInput.min = 1; stepInput.max = 50
    stepInput.value = p.step ?? 10
    stepInput.title = '步长（%）'
    stepInput.style.width = '48px'
    /* 输入后直接保存到 store（问题：之前只改显示值不落库，重建后回旧值；
       悬浮窗/主界面共用 progressCard，一处改两处生效） */
    stepInput.addEventListener('change', () => {
      const v = Math.min(50, Math.max(1, parseFloat(stepInput.value) || 10))
      setProgress(p.id, { step: v })
      opts.onChanged?.()
    })
    minus.addEventListener('click', () => {
      const cur = getProgress(p.id) || p
      setProgressValue(card, cur, cur.val - (parseFloat(stepInput.value) || 10))
    })
    plus.addEventListener('click', () => {
      const cur = getProgress(p.id) || p
      setProgressValue(card, cur, cur.val + (parseFloat(stepInput.value) || 10))
    })
    controls.append(minus, plus, stepLabel, stepInput, el('span', 'unit', '%'))

    card.append(head, display, controls)
    paintProgress(card, p)
    return card
  }

  /* ---------- 进度条：设置弹窗 ---------- */
  function openProgressSettings(id, onChanged) {
    const p = getProgress(id)
    if (!p) return
    closeModal()

    const modal = el('div', 'modal')
    const card = el('div', 'card modal-card')
    const title = el('h3', null, '进度条设置')

    const nameRow = el('div', 'set-row')
    const nameInput = document.createElement('input')
    nameInput.type = 'text'
    nameInput.value = p.name || ''
    nameInput.placeholder = '名称'
    nameInput.style.flex = '1'
    nameRow.append(nameInput)

    /* 圆环形态已删除（进度条只留横条）——移除形状选择行 */

    const colorRow = el('div', 'set-row')
    colorRow.append(el('span', 'unit', '颜色'))
    /* 跟随主题色（默认）/ 选择颜色（**独立窗口**弹在右侧，可超出主界面窗口） */
    let pickedColor = p.color || null
    const themeBtn = el('button', 'btn btn-ghost' + (pickedColor ? '' : ' on'), '跟随主题色')
    themeBtn.type = 'button'
    themeBtn.style.fontSize = '11px'
    const pickBtn = el('button', 'btn btn-ghost' + (pickedColor ? ' on' : ''), '选择颜色')
    pickBtn.type = 'button'
    pickBtn.style.fontSize = '11px'
    /* 独立调色盘窗口共享处理器 */
    ensureColorPickerHandlers()
    const original = p.color || null

    themeBtn.addEventListener('click', () => {
      pickedColor = null
      setProgress(id, { color: null })
      themeBtn.classList.add('on')
      pickBtn.classList.remove('on')
      onChanged?.()
    })
    pickBtn.addEventListener('click', () => {
      const curColor = pickedColor || currentThemeHex()
      window.cunjin?.colorPicker?.open({ kind: 'progress', id, original, initial: curColor })
      themeBtn.classList.remove('on')
      pickBtn.classList.add('on')
      modal.classList.add('color-compare') // 调色期间：左设置页透明（只有独立色盘窗口不透明）
      onChanged?.()
    })
    colorRow.append(themeBtn, pickBtn)

    /* 色盘 commit/preview 同步更新 pickedColor（关系索引 §23），弹窗关闭注销
       ⚠️ preview 时不移除 color-compare（保持设置页透明观察），只在 commit/cancel 后恢复 */
    const setPicked = (hex) => {
      pickedColor = hex || null
      themeBtn.classList.toggle('on', !pickedColor)
      pickBtn.classList.toggle('on', !!pickedColor)
    }
    registerColorPickerModal('progress', { onPicked: setPicked, onResolved: () => { modal.classList.remove('color-compare') } })
    const unregProgress = () => unregisterColorPickerModal('progress')

    const animRow = el('div', 'set-row')
    const animSel = document.createElement('select')
    ;[['smooth', '顺滑'], ['spring', '回弹'], ['none', '无动画']].forEach(([v, label]) => {
      const o = document.createElement('option')
      o.value = v; o.textContent = label
      if (p.anim === v) o.selected = true
      animSel.appendChild(o)
    })
    animRow.append(el('span', 'unit', '动画'), animSel)
    enhanceSelects(animRow) // 自绘下拉

    const stepRow = el('div', 'set-row')
    const stepInput = document.createElement('input')
    stepInput.type = 'number'; stepInput.min = 1; stepInput.max = 50
    stepInput.value = p.step ?? 10
    stepRow.append(el('span', 'unit', '步长'), stepInput, el('span', 'unit', '%'))

    const btnRow = el('div', 'set-row')
    const cancel = el('button', 'btn btn-ghost', '取消')
    cancel.addEventListener('click', () => {
      /* 取消：恢复原色 */
      if (original) setProgress(id, { color: original })
      else setProgress(id, { color: null })
      unregProgress()
      onChanged?.()
      closeModal()
    })
    const ok = el('button', 'btn', '保存')
    ok.style.flex = '1'
    ok.addEventListener('click', () => {
      unregProgress()
      setProgress(id, {
        name: nameInput.value.trim(),
        /* 圆环形态已删除，进度条固定横条，不再写 shape */
        color: pickedColor,
        anim: animSel.value,
        step: Math.min(50, Math.max(1, parseFloat(stepInput.value) || 10)),
      })
      closeModal()
      onChanged?.()
    })
    btnRow.append(cancel, ok)

    /* 单列布局（调色盘已是独立窗口） */
    const body = el('div', 'modal-body')
    body.append(nameRow, colorRow, animRow, stepRow, btnRow)
    card.append(title, body)
    modal.appendChild(card)
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal() })
    document.body.appendChild(modal)
    nameInput.focus()
  }

  /* ---------- 独立调色盘窗口：共享处理器（preview 实时预览不写盘 / commit 保存 / cancel 恢复） ----------
     关系（见知识库 03 §23）：store 是颜色真理源；设置弹窗 pickedColor、色盘窗口 wheel、卡片 CSS 变量都是投影。
     色盘 commit 必须回写给「当前打开中的设置弹窗」的 pickedColor，否则弹窗保存会用旧值覆盖 → 「保存不下来」。 */
  let colorPickerBound = false
  /* 临时预览色地图（key: kind:id）：preview 时记录 → 卡片渲染优先用它（悬浮窗重建卡片也保持预览色）；commit/cancel 清掉 */
  const previewColors = new Map()
  /* 当前打开中的设置弹窗回调（openTimerSettings/openProgressSettings 注册，closeModal 注销）：
     色盘窗口 commit 后同步更新弹窗的 pickedColor；preview/cancel 时更新按钮选中态 */
  const colorPickerModalCbs = new Map() // kind -> { onPicked(hex|null), onResolved() }
  function registerColorPickerModal(kind, cbs) { colorPickerModalCbs.set(kind, cbs) }
  function unregisterColorPickerModal(kind) { colorPickerModalCbs.delete(kind) }
  function currentThemeHex() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent-strong').trim()
    return v || '#e2a24b'
  }
  function ensureColorPickerHandlers() {
    if (colorPickerBound || !window.cunjin?.colorPicker) return
    colorPickerBound = true
    window.cunjin.colorPicker.onPreview(({ target, hex }) => {
      if (!target) return
      /* 实时预览：临时改卡片颜色（不写盘），所有窗口立即能看到变化 */
      previewCardColor(target, hex)
      colorPickerModalCbs.get(target.kind)?.onPicked?.(hex)
    })
    window.cunjin.colorPicker.onCommit(({ target, hex }) => {
      if (!target) return
      if (target.kind === 'timer') setTimer(target.id, { color: hex })
      else if (target.kind === 'progress') setProgress(target.id, { color: hex })
      /* 同步设置弹窗 pickedColor（关键：否则弹窗「保存」用旧值覆盖回） */
      colorPickerModalCbs.get(target.kind)?.onPicked?.(hex)
      restoreCardColor(target) // 去掉临时预览，让 store 值生效
    })
    window.cunjin.colorPicker.onCancel(({ target }) => {
      if (!target) return
      restoreCardColor(target) // 恢复原色（store 未动过）
      colorPickerModalCbs.get(target.kind)?.onResolved?.()
    })
  }
  /* 页面加载即绑定：任一窗口（主界面/悬浮窗）打开调色盘，所有窗口都能实时预览 */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureColorPickerHandlers)
  else ensureColorPickerHandlers()
  /* 预览/恢复：只动卡片 DOM 的 --time-color / --pg-color，不碰 store；
     previewColors 让「卡片重建后仍保持预览色」（悬浮窗 render 重建时） */
  function previewCardColor(target, hex) {
    previewColors.set(target.kind + ':' + target.id, hex)
    const sel = target.kind === 'timer' ? '.timer-card[data-id="' + target.id + '"] .t-display' : '.progress-card[data-id="' + target.id + '"]'
    const elx = document.querySelector(sel)
    if (!elx) return
    elx.style.setProperty(target.kind === 'timer' ? '--time-color' : '--pg-color', hex)
  }
  function restoreCardColor(target) {
    previewColors.delete(target.kind + ':' + target.id)
    const sel = target.kind === 'timer' ? '.timer-card[data-id="' + target.id + '"] .t-display' : '.progress-card[data-id="' + target.id + '"]'
    const elx = document.querySelector(sel)
    if (elx) elx.style.removeProperty(target.kind === 'timer' ? '--time-color' : '--pg-color')
    /* 关闭调色盘窗口时，移除设置弹窗的 color-compare 半透明 */
    $$('.modal').forEach((m) => m.classList.remove('color-compare'))
  }
  /* 渲染时查询当前色：previewColors 优先，其次 store 值/主题色 */
  function effectiveColor(kind, id, storeColor, fallback) {
    return previewColors.get(kind + ':' + id) || storeColor || fallback
  }

  /* ---------- 拖拽排序：pointer + FLIP 动画版（HTML5 DnD 弃用）
     动画：其他卡片腾位/归位均平滑过渡（FLIP：记录旧位置→DOM 变化→反向 transform→清零）；
     被拖卡片跟手，松手后从当前位置滑回槽位；主界面和悬浮窗共用同一套逻辑。 ---------- */
  function bindReorder(container, kind, getArr, saveArr, onChanged) {
    if (!container || container.__reorder) return
    container.__reorder = true
    container.__reorderCtx = {
      commit(arrIds) {
        const cur = getArr()
        const map = new Map(cur.map((x) => [x.id, x]))
        const reordered = arrIds.map((i) => map.get(i)).filter(Boolean)
        const missing = cur.filter((x) => !arrIds.includes(x.id))
        saveArr(reordered.concat(missing))
        onChanged?.()
      },
    }
    attachDrag(container)
  }
  /* 通用拖拽（含占位符方案）：widget 悬浮窗也调用；只需预置 __reorderCtx.commit */
  function attachDrag(container) {
    if (!container || container.__drag) return
    container.__drag = true
    readyPointerDrag(container)
  }
  /* 主界面/悬浮窗共通：绑定卡片手柄的 pointerdown/move/up 逻辑。
     —— 占位符方案（稳定）——
     被拖卡 absolute 跟手（脱离文档流），原槽位插入占位元素（保持格子不塌）；判定=占位与其他卡片的
     布局坐标比较（无 FLIP 动画污染 → 不再来回移动）；松手：卡放回占位、占位移除、FLIP 落位。 */
  function readyPointerDrag(container) {
    container.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.t-drag, .p-drag')
      if (!handle) return
      e.preventDefault()
      const card = handle.closest('.card')
      if (!card) return
      card.classList.add('moving')
      const rr = card.getBoundingClientRect()
      /* 占位：与原卡同尺寸，保持文档流槽位（grid/flex 都生效） */
      const ph = el('div', 'card reorder-ph')
      ph.style.width = rr.width + 'px'
      ph.style.height = rr.height + 'px'
      container.insertBefore(ph, card)
      /* 幽灵卡移到 body（脱离滚动容器）：absolute 定位用**视口坐标**（rr.left/top），
         滚动容器（悬浮窗 .wg-stack）内的 absolute 元素不随内容滚动 → 会整体上移 scrollTop（问题：按住偏移）。
         放 body 后与滚动/容器完全无关；松手时 ph.replaceWith(card) 把它移回容器内。 */
      document.body.appendChild(card)
      card.classList.add('drag-ghost')
      card.style.position = 'absolute'
      card.style.left = rr.left + 'px'
      card.style.top = rr.top + 'px'
      card.style.width = rr.width + 'px'
      card.style.zIndex = '2000'
      let startX = e.clientX, startY = e.clientY
      /* 其他卡布局坐标（不含 FLIP/ghost）：用于占位重排判定 */
      const layoutCard = (c) => {
        const r = c.getBoundingClientRect()
        return { c, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
      }
      const moveGhost = (ev) => {
        card.style.left = (rr.left + (ev.clientX - startX)) + 'px'
        card.style.top = (rr.top + (ev.clientY - startY)) + 'px'
        reposition(ev)
      }
      /* 占位插入位判定：ghost 在 body（视口坐标），其他卡 getBoundingClientRect 也是视口坐标 → 直接比 */
      const reposOnContainer = () => {
        const cards = [...container.querySelectorAll(':scope > .card')].filter((c) => c !== card)
        const py = parseFloat(card.style.top) + rr.height / 2
        const px = parseFloat(card.style.left) + rr.width / 2
        const sorted = cards.map(layoutCard).sort((a, b) => Math.round(a.cy / 90) - Math.round(b.cy / 90) || a.cx - b.cx)
        const SAME_ROW = 45
        let idx = sorted.length
        for (let i = 0; i < sorted.length; i++) {
          const o = sorted[i]
          const sameRow = Math.abs(o.cy - py) < SAME_ROW
          if (sameRow ? o.cx > px : o.cy > py) { idx = i; break }
        }
        /* 判断占位当前 DOM 位是否已在 idx：
           ph 后面第一个 .card（nextElementSibling）就是"占位之后的首卡"；
           cards 里它的下标 = 占位当前视觉索引（幽灵在 body，不在容器中，无污染） */
        const phNextCard = ph.nextElementSibling && ph.nextElementSibling.classList && ph.nextElementSibling.classList.contains('card') ? ph.nextElementSibling : null
        const curPhIdx = phNextCard && phNextCard !== card ? cards.indexOf(phNextCard) : cards.length - 1
        /* 幽灵卡已在 body，cards 即全部卡 */
        if (curPhIdx === idx) return
        /* 把占位移到正确位置（其他卡自然让位） */
        if (idx === cards.length) container.appendChild(ph)
        else container.insertBefore(ph, sorted[idx].c)
      }
      const reposition = (ev) => {
        /* 滚动容器：自身可滚用自身（悬浮窗 .wg-stack）；否则找外层（主界面 #panels）。
           主界面 timer-list 是 grid 不滚，落在 #panels 滚 → 之前从未触发（两个方向都失效） */
        const scroller = getScrollContainer()
        const srect = scroller.getBoundingClientRect()
        const scrollable = scroller.scrollHeight > scroller.clientHeight
        if (scrollable) {
          const margin = 48
          const atTopEdge = ev.clientY < srect.top + margin
          const atBottomEdge = ev.clientY > srect.bottom - margin
          if (atTopEdge && !autoScrollRunning) startAutoScroll(scroller, -1)
          else if (atBottomEdge && !autoScrollRunning) startAutoScroll(scroller, 1)
          else if (!atTopEdge && !atBottomEdge && autoScrollRunning) stopAutoScroll()
        }
        reposOnContainer()
      }
      const getScrollContainer = () => {
        /* 只认真正 overflow-y:auto/scroll 的容器（#panels / .wg-stack），
           不靠 scrollHeight 猜——面板 section 可能 sh>ch 但 overflow visible（滚不动） */
        const isScrollable = (el) => {
          const oy = getComputedStyle(el).overflowY
          return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 4
        }
        if (isScrollable(container)) return container
        let el = container.parentElement
        while (el && el !== document.body) {
          if (isScrollable(el)) return el
          el = el.parentElement
        }
        return container
      }
      /* 自动滚动（拖近边缘）：滚动中也持续重排占位 */
      let autoScrollTimer = null
      let autoScrollRunning = false
      const stopAutoScroll = () => {
        autoScrollRunning = false
        if (autoScrollTimer) { clearInterval(autoScrollTimer); autoScrollTimer = null }
      }
      const startAutoScroll = (scroller, dir) => {
        if (autoScrollRunning) return
        autoScrollRunning = true
        autoScrollTimer = setInterval(() => {
          scroller.scrollTop += dir * 18
          reposOnContainer()
        }, 16)
      }
      const onMove = (ev) => {
        if (!card.classList.contains('moving')) return
        moveGhost(ev)
      }
      const onUp = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        stopAutoScroll()
        /* 卡放回占位处：占位移除，卡恢复 flow；FLIP 从当前跟手位置滑到槽位 */
        card.classList.remove('moving')
        card.classList.remove('drag-ghost')
        card.style.position = ''
        card.style.width = ''
        card.style.left = ''
        card.style.top = ''
        card.style.zIndex = ''
        ph.replaceWith(card)
        card.style.transition = 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)'
        card.style.transform = ''
        const arr = Array.from(container.querySelectorAll(':scope > .card[data-id]')).map((c) => c.dataset.id)
        const ctx = container.__reorderCtx
        if (ctx) {
          setTimeout(() => {
            card.style.transition = ''
            ctx.commit(arr)
          }, 260)
        }
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    })
  }

  /* ---------- 确认对话框（自绘，替代原生 confirm；悬浮窗删除卡片用） ---------- */
  function confirmDialog(message, okText = '删除', onOk) {
    const modal = el('div', 'modal')
    modal.style.zIndex = '95'
    const card = el('div', 'card modal-card')
    card.classList.add('confirm-card')
    card.appendChild(el('h3', null, '确认操作'))
    card.appendChild(el('p', 'confirm-msg', message))
    const row = el('div', 'set-row')
    const no = el('button', 'btn btn-ghost', '取消')
    no.addEventListener('click', () => modal.remove())
    const yes = el('button', 'btn', okText)
    yes.style.flex = '1'
    yes.addEventListener('click', () => { modal.remove(); onOk?.() })
    row.append(no, yes)
    card.appendChild(row)
    modal.appendChild(card)
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove() })
    document.body.appendChild(modal)
  }

  /* ---------- 弹窗管理 ---------- */
  function closeModal() {
    /* 只删除临时弹窗；绝不能删常驻弹窗（settings-modal / lib-browser-modal / wg-settings），
       否则「设」从此失灵 */
    const KEEP = new Set(['settings-modal', 'lib-browser-modal', 'lib-preview-modal', 'wg-settings'])
    $$('.modal').forEach((m) => {
      if (!KEEP.has(m.id)) m.remove()
    })
  }

  return {
    timerCard, progressCard,
    startTicking,
    openTimerSettings, openProgressSettings, closeModal,
    allTimers, saveTimers, getTimer,
    allProgress, saveProgress, getProgress,
    bindReorder, attachDrag,
    nextTimerDefaultName, nextProgressDefaultName, ensureDefaultNames,
    currentThemeHex, registerColorPickerModal, unregisterColorPickerModal,
    PG_COLORS,
  }
})()
