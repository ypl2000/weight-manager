<template>
  <div class="page">
    <header class="page-head">
      <div><h1>阶段</h1><p class="sub">体重管理阶段的判定与规则</p></div>
    </header>

    <section class="card">
      <div class="row">
        <span class="chip">当前阶段</span>
        <b :style="{ color: cur && cur.color }">{{ cur ? cur.name : '未设置' }}</b>
      </div>
      <p class="muted" v-if="cur">{{ cur.summary }}</p>
      <div class="row" style="margin-top: 6px">
        <label class="field" style="flex: 1; margin: 0">手动切换
          <select v-model="manualTo">
            <option v-for="s in stageList" :key="s._id" :value="s._id">{{ s.name }}</option>
          </select>
        </label>
        <button style="align-self: flex-end" :disabled="!manualTo || manualTo === (cur && cur._id)"
                @click="applyStage(manualTo, 'manual')">切换</button>
      </div>
    </section>

    <section class="card">
      <div class="row">
        <h2 style="margin: 0">自动判定</h2>
        <span class="muted">最近 {{ sug ? sug.window_days : 14 }} 天 · {{ genderLabel }}</span>
      </div>
      <p class="muted">满足全部条件的、顺序最高的阶段即为建议阶段。</p>
      <div v-for="it in sugItems" :key="it.stage_id" style="margin-top: 10px">
        <div class="row">
          <b :style="{ color: it.color }">{{ it.name }}</b>
          <span class="pill" v-if="it.stage_id === sug.suggested">✅ 建议</span>
        </div>
        <div v-if="!it.rules.length" class="muted" style="padding: 4px 0">基础阶段(无条件,兜底)</div>
        <div class="rule" v-for="(r, i) in it.rules" :key="i">
          <span :class="r.ok ? 'ok' : 'no'">{{ r.ok ? '✓' : '✗' }}</span>
          <span>{{ r.text }}<br /><span class="detail">{{ r.detail }}</span></span>
        </div>
      </div>
      <button class="ghost" style="margin-top: 10px" @click="reload">重新评估</button>
    </section>

    <section class="card">
      <h2>阶段切换历史</h2>
      <table class="list" v-if="hist.length">
        <tbody>
          <tr v-for="h in hist" :key="h._id">
            <td class="muted">{{ fmtLocal(h.at) }}</td>
            <td>{{ stageName(h.from_stage_id) }} → <b>{{ stageName(h.to_stage_id) }}</b></td>
            <td class="muted">{{ h.reason }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">还没有切换记录</p>
    </section>

    <section class="card">
      <div class="row">
        <h2 style="margin: 0">阶段与规则编辑</h2>
        <button class="small" @click="addStage">＋ 新增阶段</button>
      </div>
      <p class="muted">每个阶段的进入条件 = 一组规则;规则、训练模板、达标标准都能改,支持增加新的管理方式。</p>

      <details class="sec" v-for="s in editList" :key="s._id" :open="editList.length <= 3">
        <summary :style="{ color: s.color }">{{ s.name || '(未命名)' }}{{ s.active === false ? '(已停用)' : '' }}</summary>
        <div class="body">
          <div class="grid2">
            <label class="field">名称<input v-model="s.name" /></label>
            <label class="field">顺序(大=先进)<input v-model.number="s.order" type="number" /></label>
          </div>
          <label class="field">一句话说明<input v-model="s.summary" /></label>
          <label class="field">达标标准(每行一条)
            <textarea v-model="s._standards"></textarea>
          </label>
          <label class="field">训练模板(每行一条,显示在今日/训练页)
            <textarea v-model="s._template"></textarea>
          </label>
          <div class="grid2">
            <label class="field">有氧目标(次/周)<input v-model.number="s._cardio" type="number" min="0" /></label>
            <label class="field">力量目标(次/周)<input v-model.number="s._strength" type="number" min="0" /></label>
          </div>
          <div class="grid3">
            <label class="field">颜色<input v-model="s.color" type="color" style="height: 38px; padding: 2px" /></label>
            <label class="field" style="display: flex; align-items: center; gap: 6px; margin-top: 22px">
              <input type="checkbox" v-model="s.active" style="width: 18px; height: 18px" /> 启用
            </label>
          </div>

          <h3>进入条件规则</h3>
          <div class="cand" v-for="(r, i) in s._rules" :key="i">
            <div class="grid3">
              <label class="field">指标
                <select v-model="r.metric">
                  <option value="workouts">运动打卡频率</option>
                  <option v-for="m in metrics" :key="m._id" :value="m.code">{{ m.name }}</option>
                </select>
              </label>
              <template v-if="r.metric === 'workouts'">
                <label class="field">≥(次/周)<input v-model.number="r.value" type="number" min="0" /></label>
                <label class="field">窗口(天)<input v-model.number="r.window_days" type="number" min="1" /></label>
              </template>
              <template v-else>
                <label class="field">比较
                  <select v-model="r.op">
                    <option value="lte">≤</option><option value="gte">≥</option>
                    <option value="lt">&lt;</option><option value="gt">&gt;</option>
                  </select>
                </label>
                <label class="field">取值
                  <select v-model="r.agg">
                    <option value="latest">最新值</option>
                    <option value="avg">平均值</option>
                    <option value="trend_down">下降趋势</option>
                  </select>
                </label>
              </template>
            </div>
            <div class="grid3" v-if="r.metric !== 'workouts' && r.agg !== 'trend_down'">
              <label class="field">阈值(通用)<input v-model.number="r.vAll" type="number" step="0.01" /></label>
              <label class="field">阈值(男,可选)<input v-model.number="r.vMale" type="number" step="0.01" /></label>
              <label class="field">窗口(天)<input v-model.number="r.window_days" type="number" min="1" /></label>
            </div>
            <button class="small danger" @click="s._rules.splice(i, 1)">删除规则</button>
          </div>
          <button class="small ghost" @click="addRule(s)">＋ 加规则</button>

          <div class="row" style="margin-top: 10px">
            <button @click="saveStage(s)">保存</button>
            <button class="danger" @click="delStage(s)" :disabled="editList.length <= 1">删除阶段</button>
          </div>
        </div>
      </details>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  S, metrics, stages, allStages, currentStage, stageHistory, profile, fmtLocal, toast, refreshAll,
} from '../store'
import { queueWrite, api } from '../sync'

const sug = ref(null)
const manualTo = ref('')

const cur = computed(() => currentStage())
const stageList = computed(() => stages())
const editList = ref([])
const hist = computed(() => stageHistory())

const genderLabel = computed(() => {
  const g = (sug.value && sug.value.gender) || 'all'
  return g === 'male' ? '男' : g === 'female' ? '女' : '未设置性别'
})

const sugItems = computed(() => (sug.value && sug.value.items) || [])

function stageName(id) {
  const st = stages().find((s) => s._id === id)
  return st ? st.name : id
}

function toEdit(s) {
  return {
    ...s,
    _standards: (s.standards || []).join('\n'),
    _template: (s.template || []).join('\n'),
    _cardio: (s.targets && s.targets.cardio_per_week) || 0,
    _strength: (s.targets && s.targets.strength_per_week) || 0,
    _rules: (s.rules || []).map((r) => ({
      metric: r.metric || 'weight',
      op: r.op || 'lte',
      agg: r.agg || 'latest',
      window_days: r.window_days || 14,
      value: r.metric === 'workouts' ? (r.value || 3) : 0,
      vAll: typeof r.value === 'object' ? (r.value.all ?? '') : (r.value ?? ''),
      vMale: typeof r.value === 'object' ? (r.value.male ?? '') : '',
    })),
  }
}

function fromEdit(s) {
  const rules = s._rules.map((r) => {
    const base = { metric: r.metric, window_days: r.window_days || 14 }
    if (r.metric === 'workouts') return { ...base, op: 'freq_gte', value: r.value || 0 }
    const out = { ...base, op: r.op, agg: r.agg }
    if (r.agg !== 'trend_down') {
      if (r.vMale === '' || r.vMale == null) out.value = r.vAll ?? 0
      else out.value = { all: r.vAll ?? 0, male: r.vMale }
    }
    return out
  })
  return {
    name: s.name, order: s.order || 1, color: s.color || '#0f766e',
    active: s.active !== false, summary: s.summary || '',
    standards: s._standards.split('\n').map((x) => x.trim()).filter(Boolean),
    template: s._template.split('\n').map((x) => x.trim()).filter(Boolean),
    targets: { cardio_per_week: s._cardio || 0, strength_per_week: s._strength || 0 },
    rules,
  }
}

async function saveStage(s) {
  await queueWrite('stages', s._id, fromEdit(s))
  toast('已保存')
}

async function delStage(s) {
  await queueWrite('stages', s._id, {}, { deleted: true })
  editList.value = editList.value.filter((x) => x._id !== s._id)
  toast('已删除')
}

function addStage() {
  const id = crypto.randomUUID()
  editList.value.push(toEdit({
    _id: id, name: '新阶段', order: editList.value.length + 1,
    color: '#0f766e', summary: '', standards: [], template: [],
    targets: { cardio_per_week: 0, strength_per_week: 0 }, rules: [],
  }))
}

function addRule(s) {
  s._rules.push({ metric: 'weight', op: 'lte', agg: 'latest', window_days: 14, value: 0, vAll: '', vMale: '' })
}

async function reload() {
  try {
    const res = await api('/api/stage-suggestion')
    if (res.ok) sug.value = await res.json()
  } catch { /* 忽略 */ }
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
  toast('已切换')
  reload()
}

onMounted(async () => {
  await refreshAll()
  editList.value = allStages().map(toEdit)
  reload()
})
</script>
