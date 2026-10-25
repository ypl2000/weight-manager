<template>
  <div class="page">
    <header class="page-head">
      <div><h1>训练</h1><p class="sub">{{ cur ? cur.name : '' }}</p></div>
    </header>

    <section class="card" v-if="cur">
      <h2>本阶段计划</h2>
      <ul class="plain">
        <li v-for="(l, i) in cur.template || []" :key="i">{{ l }}</li>
      </ul>
      <div class="row" style="margin-top: 8px">
        <span class="pill">有氧 本周 {{ weekCardio }}/{{ cur.targets?.cardio_per_week || 0 }} 次</span>
        <span class="pill">力量 本周 {{ weekStrength }}/{{ cur.targets?.strength_per_week || 0 }} 次</span>
      </div>
      <div v-if="feelTip" class="banner warn">💡 {{ feelTip }}</div>
    </section>

    <section class="card">
      <h2>训练打卡</h2>
      <div class="grid2">
        <label class="field">日期<input v-model="f.date" type="date" /></label>
        <label class="field">类型
          <select v-model="f.type">
            <option value="cardio">有氧</option>
            <option value="strength">力量</option>
          </select>
        </label>
      </div>

      <div class="cand" v-for="(it, i) in f.items" :key="i">
        <div class="head">
          <span>{{ f.type === 'cardio' ? '有氧项目' : '力量动作' }} {{ i + 1 }}</span>
          <button class="small danger" @click="f.items.splice(i, 1)">删</button>
        </div>
        <div class="grid2">
          <label class="field">项目
            <select v-model="it.name">
              <option v-for="e in exercises(f.type === 'cardio' ? 'cardio' : 'strength')" :key="e._id" :value="e.name">
                {{ e.name }}
              </option>
            </select>
          </label>
          <label class="field" v-if="f.type === 'cardio'">时长(分钟)
            <input v-model.number="it.minutes" type="number" min="0" />
          </label>
          <label class="field" v-else>组×次×重量
            <input v-model="it.sets" placeholder="如 3×10×20kg 或自重" />
          </label>
        </div>
        <label class="field" v-if="f.type === 'cardio'">心率(选填)
          <input v-model.number="it.hr" type="number" min="0" placeholder="如 120(60-70%区间)" />
        </label>
      </div>
      <button class="small ghost" @click="addItem">＋ 加项目</button>

      <div class="grid2" style="margin-top: 8px">
        <label class="field">运动感受
          <select v-model="f.feel">
            <option value="">选填</option>
            <option value="easy">轻松</option>
            <option value="ok">刚好</option>
            <option value="hard">累</option>
          </select>
        </label>
        <label class="field">备注<input v-model="f.note" placeholder="选填" /></label>
      </div>
      <button @click="save" style="width: 100%" :disabled="!f.items.length">保存打卡</button>
    </section>

    <section class="card">
      <h2>最近训练</h2>
      <table class="list" v-if="recent.length">
        <tbody>
          <tr v-for="wk in recent" :key="wk._id">
            <td class="muted">{{ wk.date }}</td>
            <td>
              <span class="pill">{{ wk.type === 'cardio' ? '有氧' : '力量' }}</span>
              {{ summary(wk) }}
            </td>
            <td><button class="small danger" @click="del(wk)">删</button></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">还没有打卡记录</p>
    </section>

    <details class="sec">
      <summary>动作库管理</summary>
      <div class="body">
        <div class="row" style="margin-bottom: 6px">
          <input v-model="newEx.name" placeholder="新动作名称" style="flex: 1" />
          <select v-model="newEx.type" style="width: 90px">
            <option value="cardio">有氧</option>
            <option value="strength">力量</option>
          </select>
          <button class="small" @click="addEx" :disabled="!newEx.name">添加</button>
        </div>
        <table class="list">
          <tbody>
            <tr v-for="e in allEx" :key="e._id">
              <td>{{ e.name }}</td>
              <td><span class="pill">{{ e.type === 'cardio' ? '有氧' : '力量' }}</span></td>
              <td><button class="small danger" @click="delEx(e)">删</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  currentStage, exercises, rows, today, refreshAll, toast,
} from '../store'
import { queueWrite } from '../sync'

const cur = computed(() => currentStage())

function monday() {
  const d = new Date()
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const weekCardio = computed(() =>
  rows('workouts').filter((w) => w.data && w.data.date >= monday() && w.data.type === 'cardio' && !w.deleted).length)
const weekStrength = computed(() =>
  rows('workouts').filter((w) => w.data && w.data.date >= monday() && w.data.type === 'strength' && !w.deleted).length)

const feelTip = computed(() => {
  const hard = rows('workouts').filter((w) => w.data && w.data.feel === 'hard' && !w.deleted)
    .sort((a, b) => (a.data.date < b.data.date ? 1 : -1))[0]
  if (!hard) return ''
  return '上次打卡感受是「累」→ 听反馈:休息或降强度。'
})

const f = ref({
  date: today(),
  type: 'cardio',
  items: [],
  feel: '',
  note: '',
})

function addItem() {
  const list = exercises(f.value.type === 'cardio' ? 'cardio' : 'strength')
  const first = list.length ? list[0].name : ''
  f.value.items.push(f.value.type === 'cardio' ? { name: first, minutes: 30, hr: null } : { name: first, sets: '' })
}

async function save() {
  const minutes = f.value.items.reduce((a, b) => a + (b.minutes || 0), 0)
  await queueWrite('workouts', crypto.randomUUID(), {
    date: f.value.date,
    type: f.value.type,
    items: f.value.items,
    feel: f.value.feel,
    duration_min: minutes,
    note: f.value.note || '',
  })
  f.value.items = []
  f.value.feel = ''
  f.value.note = ''
  toast('打卡成功,坚持就是胜利')
}

const recent = computed(() =>
  [...rows('workouts')]
    .sort((a, b) => ((a.data && a.data.date) < (b.data && b.data.date) ? 1 : -1))
    .slice(0, 14)
    .map((d) => ({ _id: d.id, ...d.data })))

function summary(wk) {
  return (wk.items || []).map((it) => {
    if (wk.type === 'cardio') return `${it.name}${it.minutes ? ' ' + it.minutes + '分钟' : ''}${it.hr ? '·心率' + it.hr : ''}`
    return `${it.name} ${it.sets || ''}`
  }).join(' / ') + (wk.feel === 'hard' ? '(累)' : wk.feel === 'easy' ? '(轻松)' : '')
}

async function del(wk) {
  await queueWrite('workouts', wk._id, {}, { deleted: true })
  toast('已删除')
}

const newEx = ref({ name: '', type: 'strength' })
const allEx = computed(() => exercises())
async function addEx() {
  await queueWrite('exercises', crypto.randomUUID(), { name: newEx.value.name, type: newEx.value.type, active: true })
  newEx.value.name = ''
  toast('已添加')
}
async function delEx(e) {
  await queueWrite('exercises', e._id, {}, { deleted: true })
}

onMounted(refreshAll)
</script>
