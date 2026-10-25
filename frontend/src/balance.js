// 宽屏(≥1024px)双列高度均衡工具(今日页 / AI 教练页共用)
// 背景:grid 1fr 1fr 两列独立排布,内容长度差直接变成高度差(1280 宽下左列悬空约 433px);
// CSS 多列在 Chrome 对无约束高度不做均衡,实测同样退化为顺序填充,故改 JS 感知分配。
//
// 算法(balanceColumns):
//   1. 对账:登记表里剪掉已离开文档的卡(v-if 收起),把新出现的卡(v-if 展开)按
//      "前方最近的已登记卡之后"插回登记表,保持模板相对顺序
//   2. 还原:把所有卡片按登记顺序放回各自的"家列"(模板原始归属)——<1024px 到此为止,
//      手机端 DOM 顺序与从未分配过完全一致
//   3. 测量:卡片在家列中、列宽即最终列宽,offsetHeight 真实可信;高度一次读完再移动,
//      避免读写交替造成多次回流(不在 container 里平铺测量——全宽下的卡高与列内不符)
//   4. 贪心:按原始顺序遍历,放入"当前累计高度较小的列"(高度=卡高+margin-bottom)。
//      每次放入后 |两列差| ≤ 该卡高度,故最终底部差 ≤ 一张卡的高度
//
// DOM 安全:只 appendChild 卡片元素本身,不碰列内 Vue 的 v-if 注释锚点(禁用 innerHTML 清空),
// 同屏先算后动(目标与现状一致时一个节点都不动),避免窄屏滚动条抖动与无谓重排。

import { onMounted, onUnmounted } from 'vue'

export const WIDE_QUERY = '(min-width: 1024px)'

const RESIZE_DEBOUNCE_MS = 150
// 挂载后的补量时点:字体就绪,外加两个兜底定时器(智能提示/训练要点等 v-if 卡片晚于挂载出现)
const LATE_MEASURE_MS = [500, 1500]

// 登记表按 container 元素存(WeakMap:路由切走、组件销毁后自动可回收;重挂载即重新快照)
// items 顺序 = 模板原始顺序(先 col0 后 col1),home = 卡片在模板中所属的列下标
const registries = new WeakMap()

function isCard(el) {
  return !!(el && el.classList && el.classList.contains('card'))
}

function reconcile(reg, cols) {
  reg.items = reg.items.filter((it) => it.el.isConnected)
  const known = new Set(reg.items.map((it) => it.el))
  const findIdx = (el) => reg.items.findIndex((it) => it.el === el)
  for (let ci = 0; ci < cols.length; ci++) {
    for (const el of Array.from(cols[ci].children)) {
      if (known.has(el) || !isCard(el)) continue
      const item = { el, home: ci }
      // 前方最近的已登记卡之后
      let at = -1
      let sib = el.previousElementSibling
      while (sib) {
        const idx = findIdx(sib)
        if (idx !== -1) { at = idx + 1; break }
        sib = sib.previousElementSibling
      }
      // 前方没有,则后方最近的已登记卡之前
      if (at === -1) {
        sib = el.nextElementSibling
        while (sib) {
          const idx = findIdx(sib)
          if (idx !== -1) { at = idx; break }
          sib = sib.nextElementSibling
        }
      }
      // 都没有,则归位到该列登记段的末尾
      if (at === -1) {
        at = reg.items.findIndex((it) => it.home > ci)
        if (at === -1) at = reg.items.length
      }
      reg.items.splice(at, 0, item)
      known.add(el)
    }
  }
}

// 把目标列表落到 DOM:与现状一致则跳过(零 DOM 变更)
function apply(cols, target) {
  for (let ci = 0; ci < cols.length; ci++) {
    const want = target[ci]
    const cur = Array.from(cols[ci].children).filter(isCard)
    if (cur.length === want.length && cur.every((el, i) => el === want[i])) continue
    for (const el of want) cols[ci].appendChild(el) // 依序 append,列内相对顺序 = 目标顺序
  }
}

// 入口:container = .cols 元素,cols = 两个 .col 元素
export function balanceColumns(container, cols) {
  if (!container || !cols || cols.length < 2) return
  let reg = registries.get(container)
  if (!reg) {
    reg = { items: [] }
    registries.set(container, reg)
  }
  reconcile(reg, cols)

  // 还原到模板原始布局(<1024px 的最终状态)
  const live = reg.items.filter((it) => it.el.isConnected)
  const home = cols.map(() => [])
  for (const it of live) home[it.home].push(it.el)
  apply(cols, home)

  // 仅宽屏分配
  if (!window.matchMedia(WIDE_QUERY).matches) return

  // 测量:家列列宽 = 最终列宽,高度真实;先读全量再移动
  const heights = live.map((it) => {
    const m = parseInt(getComputedStyle(it.el).marginBottom, 10)
    return it.el.offsetHeight + (Number.isNaN(m) ? 0 : m)
  })

  // 贪心:原始顺序遍历,放入累计较矮的列
  let ha = 0
  let hb = 0
  const target = cols.map(() => [])
  for (let i = 0; i < live.length; i++) {
    const t = ha <= hb ? 0 : 1
    target[t].push(live[i].el)
    if (t === 0) ha += heights[i]
    else hb += heights[i]
  }
  apply(cols, target)
}

// 组合式封装:接管触发时机(挂载 / 字体就绪 / 兜底补量 / resize 去抖 / 越过断点 / wm-synced)
// 与清理;返回 refresh() 供页面在内容明显变高后(如 AI 解读流式结束)手动补平衡
export function useBalancedCols(containerRef, colRefs) {
  let raf = 0
  let resizeTimer = null
  const lateTimers = []
  const mq = window.matchMedia(WIDE_QUERY)

  function run() {
    raf = 0
    const container = containerRef.value
    const cols = (colRefs || []).map((r) => r.value).filter(Boolean)
    if (!container || cols.length < 2) return
    balanceColumns(container, cols)
  }
  function schedule() {
    if (raf) return
    raf = requestAnimationFrame(run) // rAF 晚于 Vue 的微任务 flush,量到的是最新 DOM
  }
  function onResize() {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(schedule, RESIZE_DEBOUNCE_MS)
  }
  function onMqChange() { schedule() }
  function onSynced() { schedule() }

  onMounted(() => {
    schedule() // 首帧
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule)
    for (const ms of LATE_MEASURE_MS) lateTimers.push(setTimeout(schedule, ms))
    window.addEventListener('resize', onResize)
    window.addEventListener('wm-synced', onSynced)
    if (mq.addEventListener) mq.addEventListener('change', onMqChange)
    else if (mq.addListener) mq.addListener(onMqChange) // 旧 Safari
  })

  onUnmounted(() => {
    if (raf) cancelAnimationFrame(raf)
    clearTimeout(resizeTimer)
    for (const t of lateTimers) clearTimeout(t)
    window.removeEventListener('resize', onResize)
    window.removeEventListener('wm-synced', onSynced)
    if (mq.removeEventListener) mq.removeEventListener('change', onMqChange)
    else if (mq.removeListener) mq.removeListener(onMqChange)
  })

  return { refresh: schedule }
}
