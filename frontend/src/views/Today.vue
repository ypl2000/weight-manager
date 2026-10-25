<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>今日</h1>
        <p class="sub">{{ dateLabel }}</p>
      </div>
      <span class="sync-dot" :class="syncClass" @click="manualSync">{{ syncText }}</span>
    </header>

    <!-- 测量提醒:有到期未测的指标时,横幅列表显示在页面最顶部(阶段卡片之上),全部完成后消失 -->
    <template v-if="dueReminders.length">
      <div v-for="r in dueReminders" :key="r.code" class="banner warn">
        <span>{{ remindText(r) }}</span>
      </div>
    </template>

    <!-- 双列容器:仅宽屏(≥1024px)两列并排,列间高度均衡由 balance.js 感知分配;
         手机端是普通 div 且卡片会被恢复原始顺序,单列顺序与原来完全一致
         左列:阶段卡 / 快捷记录 / 智能提示   右列:今日打卡 / 本阶段训练要点 / AI 教练入口 -->
    <div class="cols" ref="colsEl">
      <div class="col" ref="colA">
        <section class="card stage-card" :style="cur ? { borderLeftColor: cur.color } : {}">
          <div class="row">
            <span class="chip">当前阶段</span>
            <b>{{ cur ? cur.name : '未设置' }}</b>
          </div>
          <p class="muted" v-if="cur">{{ cur.summary }}</p>
          <div v-if="sug && cur && sug.suggested && sug.suggested !== cur._id" class="banner">
            <span>系统建议进入「{{ stageName(sug.suggested) }}」</span>
            <button class="small" @click="applyStage(sug.suggested, 'auto')">应用</button>
          </div>
          <router-link to="/stage" class="link">查看判定依据与规则 →</router-link>
        </section>

        <section class="card">
          <h2>快捷记录</h2>
          <div class="quick">
            <input type="number" step="0.1" v-model="w" placeholder="体重 kg" inputmode="decimal" />
            <button @click="saveWeight" :disabled="!w">保存</button>
          </div>
          <p class="muted" style="margin-top: 8px">
            <template v-if="lastWeight">上次:{{ lastWeight.value }} kg · {{ fmtLocal(lastWeight.at) }}</template>
            <template v-else>还没有体重记录</template>
          </p>
          <p v-if="bmiVal !== null" class="muted">BMI {{ bmiVal }}{{ bmiLabel }}</p>
          <p v-if="whrVal !== null" class="muted">腰臀比 {{ whrVal }}{{ whrLabel }}</p>
          <div class="row" style="margin-top: 8px">
            <router-link to="/data" class="link">全部指标录入 →</router-link>
            <router-link to="/data?tab=camera" class="link">📷 拍照识别 →</router-link>
          </div>
        </section>

        <!-- 智能提示 -->
        <section class="card" v-if="hasInsight">
          <h2>智能提示</h2>
          <div v-if="insights.rate_alert" class="banner warn">
            <span>⚠️ {{ insights.rate_alert.message }}</span>
          </div>
          <div
            v-if="insights.plateau"
            class="banner"
            :class="insights.plateau.type === 'true_plateau' ? 'warn' : 'info'"
          >
            <div class="banner-body">
              <div>{{ insights.plateau.message }}</div>
              <div class="muted" style="font-size: 12px; margin-top: 2px">真假平台期判读依据见 AI 教练</div>
            </div>
          </div>
          <template v-if="insights.protein">
            <h3>今日蛋白质目标</h3>
            <div class="protein-line">
              <span><b class="protein-num">{{ insights.protein.target_g }}</b> g/天</span>
              <span v-if="insights.protein.food_hint" class="pill">{{ insights.protein.food_hint }}</span>
            </div>
            <p v-if="insights.protein.note" class="muted" style="margin: 2px 0 0">{{ insights.protein.note }}</p>
          </template>
        </section>
      </div>

      <div class="col" ref="colB">
        <section class="card">
          <div class="row">
            <h2 style="margin: 0">今日打卡</h2>
            <span class="muted">7天坚持率 {{ habitRate }}%</span>
          </div>
          <div v-for="g in grouped" :key="g.name" style="margin-top: 6px">
            <h3>{{ g.name }}</h3>
            <label v-for="h in g.items" :key="h._id" class="check">
              <input type="checkbox" :checked="!!doneMap[h._id]" @change="(e) => toggleHabit(h, e.target.checked)" />
              <span>
                {{ h.name }}
                <span class="note" v-if="h.note">· {{ h.note }}</span>
              </span>
            </label>
          </div>
          <router-link to="/settings" class="link">管理清单 →</router-link>
        </section>

        <section class="card" v-if="cur">
          <h2>本阶段训练要点</h2>
          <ul class="plain">
            <li v-for="(l, i) in cur.template || []" :key="i">{{ l }}</li>
          </ul>
          <router-link to="/training" class="link">去训练打卡 →</router-link>
        </section>

        <!-- AI 教练入口 -->
        <section class="card">
          <div class="row">
            <div>
              <b>🤖 AI 教练解读</b>
              <p class="muted" style="margin: 2px 0 0">基于近期体重与打卡数据,生成 AI 阶段报告</p>
            </div>
            <router-link to="/coach" class="link" style="margin-top: 0; white-space: nowrap">进入 →</router-link>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import {
  S, profile, metrics, stages, currentStage, latestRecord, bmi, whr,
  habits, rows, today, fmtLocal, toast,
} from '../store'
import { api, queueWrite, syncNow } from '../sync'
import { useBalancedCols } from '../balance'

const route = useRoute()
const w = ref('')
const sug = ref(null)

const cur = computed(() => currentStage())
const lastWeight = computed(() => latestRecord('weight'))
const bmiVal = computed(() => bmi())
const whrVal = computed(() => whr())

const dateLabel = new Date().toLocaleDateString('zh-CN', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
})

const syncText = computed(() => {
  if (!S.online) return '离线'
  return S.lastSync ? '已同步' : '待同步'
})
const syncClass = computed(() => (!S.online ? 'off' : ''))

function stageName(id) {
  const st = stages().find((s) => s._id === id)
  return st ? st.name : id
}

const bmiLabel = computed(() => {
  if (bmiVal.value === null) return ''
  const v = bmiVal.value
  if (v < 18.5) return '(偏瘦)'
  if (v < 24) return '(正常)'
  if (v < 28) return '(超重)'
  return '(肥胖)'
})

const whrLabel = computed(() => {
  if (whrVal.value === null) return ''
  const g = profile().gender || 'all'
  const lim = g === 'male' ? 0.9 : 0.85
  return whrVal.value >= lim ? ' (超标)' : ' (正常)'
})

async function saveWeight() {
  if (!w.value) return
  const m = metrics().find((x) => x.code === 'weight')
  await queueWrite('records', crypto.randomUUID(), {
    metric_code: 'weight', value: +w.value, unit: (m && m.unit) || 'kg',
    at: new Date().toISOString(), note: '', source: 'manual',
  })
  w.value = ''
  toast('已记录,将自动同步')
}

const doneMap = computed(() => {
  const map = {}
  for (const l of rows('habit_logs')) {
    if (l.data && l.data.date === today() && l.data.done && !l.deleted) map[l.data.habit_id] = true
  }
  return map
})

const CATS = { diet: '饮食·控糖抗炎', sleep: '睡眠·减压', motion: '运动' }
const grouped = computed(() => {
  const hs = habits()
  return Object.keys(CATS)
    .map((c) => ({ name: CATS[c], items: hs.filter((h) => h.category === c) }))
    .filter((g) => g.items.length)
})

async function toggleHabit(h, checked) {
  const id = `${h._id}_${today()}`
  if (checked) {
    await queueWrite('habit_logs', id, { date: today(), habit_id: h._id, done: 1 })
  } else {
    await queueWrite('habit_logs', id, {}, { deleted: true })
  }
}

const habitRate = computed(() => {
  const hs = habits()
  if (!hs.length) return 0
  let done = 0
  for (let i = 0; i < 7; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    for (const h of hs) {
      const log = rows('habit_logs').find(
        (l) => l.data && l.data.date === ds && l.data.habit_id === h._id && l.data.done)
      if (log) done++
    }
  }
  return Math.round((done / (hs.length * 7)) * 100)
})

// ---- 宽屏双列高度均衡:≥1024px 由 balance.js 感知分配;<1024px 自动恢复原始顺序 ----
const colsEl = ref(null)
const colA = ref(null)
const colB = ref(null)
const { refresh: rebalanceCols } = useBalancedCols(colsEl, [colA, colB])

async function loadSug() {
  try {
    const res = await fetch('/api/stage-suggestion')
    if (res.ok) {
      sug.value = await res.json()
      rebalanceCols() // 建议横幅出现/消失会改变阶段卡高度,补一次平衡
    }
  } catch { /* 离线时忽略 */ }
}

// ---- 测量提醒(/api/reminders:体重每天 1 次、腰围每周 1 次,到期未测的项 due=true) ----
const REMIND_ICONS = { weight: '⚖️', waist: '📏' }
const reminders = ref([])
const dueReminders = computed(() => reminders.value.filter((r) => r && r.due))

function remindText(r) {
  let t = `${REMIND_ICONS[r.code] || '📏'} 该测${r.name}了`
  if (r.reason) t += ` · ${r.reason}`
  if (r.rule) t += `（${r.rule}）`
  return t
}

async function loadReminders() {
  try {
    const res = await api('/api/reminders')
    reminders.value = res.ok ? ((await res.json()).items || []) : []
  } catch {
    reminders.value = [] // 离线/未解锁/服务端异常:静默,不显示横幅
  }
}

// ---- 智能提示(/api/insights:减重速率预警 / 平台期 / 蛋白质目标) ----
const insights = ref(null)
const hasInsight = computed(() => {
  const i = insights.value
  return !!(i && (i.rate_alert || i.plateau || i.protein))
})

async function loadInsights() {
  try {
    const res = await api('/api/insights')
    insights.value = res.ok ? await res.json() : null
  } catch {
    insights.value = null // 离线/未解锁/服务端异常:静默,整卡不显示
  } finally {
    rebalanceCols() // 智能提示卡出现/消失会改变左列高度,补一次平衡
  }
}

async function applyStage(toId, mode) {
  const p = profile()
  await queueWrite('profile', 'me', { ...p, current_stage_id: toId })
  await queueWrite('stage_history', crypto.randomUUID(), {
    at: new Date().toISOString(),
    from_stage_id: p.current_stage_id,
    to_stage_id: toId,
    reason: mode === 'auto' ? '采纳系统建议' : '手动切换',
    mode,
  })
  toast('已切换阶段')
}

function manualSync() {
  syncNow().then((r) => toast(r.ok ? '同步完成' : '暂时同步不了(离线或服务端未开)'))
}

let timer = null
onMounted(() => {
  loadSug()
  loadInsights()
  loadReminders()
  timer = setInterval(loadSug, 60000)
  window.addEventListener('wm-synced', loadInsights)
  window.addEventListener('wm-synced', loadReminders)
  if (route.query.weight) w.value = route.query.weight
})
onUnmounted(() => {
  clearInterval(timer)
  window.removeEventListener('wm-synced', loadInsights)
  window.removeEventListener('wm-synced', loadReminders)
})
</script>

<style scoped>
.banner-body { min-width: 0; }
.protein-line { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
.protein-num { font-size: 26px; color: var(--teal); }
</style>
