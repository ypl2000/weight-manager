<template>
  <div class="page">
    <header class="page-head">
      <div><h1>设置</h1><p class="sub">资料 · 配置管理 · 同步 · 数据安全</p></div>
    </header>

    <!-- 个人资料 -->
    <details class="sec" open>
      <summary>个人资料(影响阈值与 BMI)</summary>
      <div class="body">
        <div class="grid2">
          <label class="field">性别(决定腰围等阈值)
            <select v-model="p.gender">
              <option value="">未设置</option>
              <option value="female">女</option>
              <option value="male">男</option>
            </select>
          </label>
          <label class="field">身高(cm)<input v-model.number="p.height_cm" type="number" step="0.5" /></label>
        </div>
        <div class="grid2">
          <label class="field">目标体重(kg)<input v-model.number="p.target_weight" type="number" step="0.1" /></label>
          <label class="field">目标腰围(cm)<input v-model.number="p.target_waist" type="number" step="0.5" /></label>
        </div>
        <button @click="saveProfile">保存资料</button>
      </div>
    </details>

    <!-- 指标管理 -->
    <details class="sec">
      <summary>指标管理(可增可改)</summary>
      <div class="body">
        <div class="cand" v-for="m in mEdit" :key="m._id">
          <div class="grid3">
            <label class="field">名称<input v-model="m.name" /></label>
            <label class="field">单位<input v-model="m.unit" /></label>
            <label class="field">排序<input v-model.number="m.sort" type="number" /></label>
          </div>
          <div class="grid3">
            <label class="field">阈值(通用)<input v-model.number="m.tAll" type="number" step="0.01" /></label>
            <label class="field">阈值(男)<input v-model.number="m.tMale" type="number" step="0.01" /></label>
            <label class="field" style="display:flex;align-items:center;gap:6px;margin-top:24px">
              <input type="checkbox" v-model="m.active" style="width:18px;height:18px" />启用
              <button class="small danger" style="margin-left:auto" @click="delMetric(m)">删</button>
            </label>
          </div>
          <button class="small" @click="saveMetric(m)">保存该指标</button>
        </div>
        <div class="row">
          <input v-model="newMetric.name" placeholder="新指标名,如 尿酸" style="flex:1" />
          <input v-model="newMetric.unit" placeholder="单位" style="width:80px" />
          <button class="small" @click="addMetric" :disabled="!newMetric.name">＋ 添加指标</button>
        </div>
      </div>
    </details>

    <!-- 习惯清单管理 -->
    <details class="sec">
      <summary>饮食·习惯清单管理</summary>
      <div class="body">
        <table class="list">
          <tbody>
            <tr v-for="h in hEdit" :key="h._id">
              <td>
                <input v-model="h.name" style="margin-bottom:4px" />
                <div class="row">
                  <select v-model="h.category" style="width:110px">
                    <option value="diet">饮食</option>
                    <option value="sleep">睡眠减压</option>
                    <option value="motion">运动</option>
                  </select>
                  <label style="display:flex;align-items:center;gap:4px;font-size:12px">
                    <input type="checkbox" v-model="h.active" style="width:16px;height:16px" />启用
                  </label>
                  <button class="small" @click="saveHabit(h)">存</button>
                  <button class="small danger" @click="delHabit(h)">删</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="row" style="margin-top:8px">
          <input v-model="newHabit.name" placeholder="新习惯,如 晚餐后散步15分钟" style="flex:1" />
          <button class="small" @click="addHabit" :disabled="!newHabit.name">＋ 添加</button>
        </div>
      </div>
    </details>

    <!-- AI 识别 -->
    <details class="sec">
      <summary>AI 识别(拍照提取数据)</summary>
      <div class="body">
        <label class="field">接口地址(OpenAI vision 兼容)
          <input v-model="ai.base_url" placeholder="https://open.bigmodel.cn/api/paas/v4" />
        </label>
        <div class="grid2">
          <label class="field">模型名<input v-model="ai.model" placeholder="glm-4v-plus" /></label>
          <label class="field">API Key<input v-model="ai.api_key" type="password" placeholder="在智谱开放平台申请" /></label>
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin:6px 0">
          <input type="checkbox" v-model="ai.demo" style="width:18px;height:18px" />
          演示模式(没填 Key 时返回演示数据,方便先体验流程)
        </label>
        <button @click="saveAi">保存 AI 配置</button>
      </div>
    </details>

    <!-- 同步 -->
    <details class="sec">
      <summary>同步(手机 ↔ 电脑)</summary>
      <div class="body">
        <p class="muted">
          状态:{{ S.online ? '在线' : '离线' }} ·
          上次同步:{{ S.lastSync ? fmtLocal(S.lastSync) : '还没同步过' }} ·
          待同步变更:{{ outboxN }} 条
        </p>
        <div class="row">
          <button @click="doSync">立即同步</button>
          <button class="ghost" @click="resetCursor">重置游标(全量重拉)</button>
        </div>
        <p class="muted">原理:本地优先读写,联网后把各自变更按"更新时间新者胜"合并,删除用软删除防止误覆盖。</p>
      </div>
    </details>

    <!-- 数据安全 -->
    <details class="sec">
      <summary>数据安全:访问码 · 历史回滚 · 快照</summary>
      <div class="body">
        <h3>访问码</h3>
        <div class="row">
          <input v-model="pinCode" type="password" placeholder="设置/修改访问码,留空清除" style="flex:1" />
          <button @click="savePin">{{ pinCode ? '保存' : '清除' }}</button>
        </div>

        <h3>历史回滚(每次改动都留有版本)</h3>
        <button class="small ghost" @click="loadHistory">{{ hist.length ? '刷新历史' : '查看最近历史' }}</button>
        <table class="list" v-if="hist.length" style="margin-top:6px">
          <thead><tr><th>时间</th><th>内容</th><th></th></tr></thead>
          <tbody>
            <tr v-for="h in hist" :key="h.seq">
              <td class="muted">{{ fmtLocal(h.created_at) }}</td>
              <td>{{ tableName(h.table) }} · {{ h.action === 'delete' ? '删除' : '修改' }}
                <span class="muted">({{ h.device }})</span></td>
              <td><button class="small ghost" @click="restore(h)">恢复此版本</button></td>
            </tr>
          </tbody>
        </table>

        <h3>每日快照</h3>
        <p class="muted">服务端每天首次启动自动全量备份,保留最近30份。</p>
        <div class="row" style="flex-wrap:wrap;gap:6px">
          <a class="btn" href="/api/export/all" download>导出全部数据 JSON</a>
          <a class="btn" href="/api/export/records.csv" download>导出记录 CSV</a>
        </div>
        <button class="small ghost" style="margin-top:8px" @click="loadSnaps">{{ snaps.length ? '刷新快照' : '查看快照列表' }}</button>
        <table class="list" v-if="snaps.length" style="margin-top:6px">
          <tbody>
            <tr v-for="s in snaps" :key="s.name">
              <td class="muted">{{ s.name }}</td>
              <td><a class="link" :href="'/api/snapshots/' + s.name" download>下载</a></td>
              <td><button class="small danger" @click="restoreSnap(s)">整体恢复</button></td>
            </tr>
          </tbody>
        </table>

        <h3>导入 JSON</h3>
        <input type="file" accept=".json" @change="importJson" />
      </div>
    </details>

    <details class="sec">
      <summary>关于</summary>
      <div class="body muted">
        <p>体重管理 v1 · 本地部署,数据不出家门。</p>
        <p>手机:同一 WiFi 浏览器打开 http://电脑IP:8000 → 添加到主屏幕。</p>
        <p>初始管理方式来自白板笔记《苹果型运动》《内脏脂肪》,全部可在阶段/设置里修改。</p>
      </div>
    </details>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import {
  S, profile, allMetrics, rows, fmtLocal, refreshAll, toast,
} from '../store'
import { queueWrite, api, syncNow } from '../sync'
import { kvSet, kvGet, outboxAll } from '../db'

// ---- 资料 ----
const p = ref({ ...profile() })
async function saveProfile() {
  await queueWrite('profile', 'me', { ...p.value })
  toast('资料已保存')
}

// ---- 指标 ----
const mEdit = ref([])
const newMetric = ref({ name: '', unit: '' })

function fillMetrics() {
  mEdit.value = allMetrics().map((m) => ({
    ...m,
    tAll: m.thresholds && m.thresholds.all != null ? m.thresholds.all : '',
    tMale: m.thresholds && m.thresholds.male != null ? m.thresholds.male : '',
  }))
}
async function saveMetric(m) {
  const thresholds = {}
  if (m.tAll !== '' && m.tAll != null) thresholds.all = m.tAll
  if (m.tMale !== '' && m.tMale != null) thresholds.male = m.tMale
  await queueWrite('metrics', m._id, {
    code: m.code, name: m.name, unit: m.unit, sort: m.sort || 99,
    active: m.active !== false, thresholds, note: m.note || '',
  })
  toast('指标已保存')
}
async function delMetric(m) {
  await queueWrite('metrics', m._id, {}, { deleted: true })
  mEdit.value = mEdit.value.filter((x) => x._id !== m._id)
}
async function addMetric() {
  const id = crypto.randomUUID()
  await queueWrite('metrics', id, {
    code: 'custom_' + Date.now(), name: newMetric.value.name,
    unit: newMetric.value.unit || '', sort: 99, active: true, thresholds: {},
  })
  newMetric.value = { name: '', unit: '' }
  await refreshAll()
  fillMetrics()
  toast('指标已添加')
}

// ---- 习惯 ----
const hEdit = ref([])
const newHabit = ref({ name: '' })
function fillHabits() {
  hEdit.value = rows('habits').map((d) => ({ _id: d.id, ...d.data }))
}
async function saveHabit(h) {
  await queueWrite('habits', h._id, {
    name: h.name, category: h.category, sort: h.sort || 99,
    active: h.active !== false, note: h.note || '',
  })
  toast('已保存')
}
async function delHabit(h) {
  await queueWrite('habits', h._id, {}, { deleted: true })
  hEdit.value = hEdit.value.filter((x) => x._id !== h._id)
}
async function addHabit() {
  const id = crypto.randomUUID()
  await queueWrite('habits', id, {
    name: newHabit.value.name, category: 'diet', sort: 99, active: true, note: '',
  })
  newHabit.value = { name: '' }
  await refreshAll()
  fillHabits()
  toast('已添加')
}

// ---- AI ----
const ai = ref({ base_url: '', model: '', api_key: '', demo: true })
onMounted(async () => {
  try {
    const res = await api('/api/meta/ai')
    if (res.ok) ai.value = { demo: true, ...(await res.json()) }
  } catch { /* ignore */ }
})
async function saveAi() {
  const res = await api('/api/meta/ai', { method: 'PUT', body: { ...ai.value } })
  toast(res.ok ? 'AI 配置已保存' : '保存失败')
}

// ---- 同步 ----
const outboxN = ref(0)
async function doSync() {
  const r = await syncNow()
  outboxN.value = await outboxAll().then((a) => a.length)
  toast(r.ok ? `同步完成(推${r.pushed}/拉${r.pulled})` : '同步失败:' + (r.reason || '可能离线'))
}
async function resetCursor() {
  await kvSet('cursor', 0)
  await syncNow()
  toast('游标已重置并重新同步')
}

// ---- 访问码 ----
const pinCode = ref('')
async function savePin() {
  const code = pinCode.value.trim()
  const res = await api('/api/meta/pin', { method: 'PUT', body: { code } })
  if (res.ok) {
    if (code) localStorage.setItem('wmPin', code)
    else localStorage.removeItem('wmPin')
    pinCode.value = ''
    toast(code ? '访问码已设置' : '访问码已清除')
  }
}

// ---- 历史回滚 ----
const hist = ref([])
async function loadHistory() {
  const res = await api('/api/history?limit=50')
  hist.value = await res.json()
}
async function restore(h) {
  const res = await api(`/api/history/${h.seq}/restore`, { method: 'POST' })
  if (res.ok) {
    toast('已恢复该版本,正在同步')
    await refreshAll()
    syncNow()
  } else toast('恢复失败')
}
function tableName(t) {
  const names = {
    metrics: '指标', records: '测量记录', stages: '阶段', profile: '个人资料',
    exercises: '动作库', habits: '习惯清单', workouts: '训练打卡',
    habit_logs: '习惯打卡', stage_history: '阶段历史',
  }
  return names[t] || t
}

// ---- 快照 ----
const snaps = ref([])
async function loadSnaps() {
  const res = await api('/api/snapshots')
  snaps.value = await res.json()
}
async function restoreSnap(s) {
  if (!confirm(`确定用 ${s.name} 覆盖当前全部数据?此操作会留历史,可再回滚。`)) return
  const res = await api('/api/restore', { method: 'POST', body: { name: s.name } })
  if (res.ok) {
    toast('已恢复快照')
    await kvSet('cursor', 0)
    await refreshAll()
    syncNow()
  }
}

async function importJson(e) {
  const f = e.target.files && e.target.files[0]
  if (!f) return
  const text = await f.text()
  let docs
  try {
    docs = JSON.parse(text).docs
  } catch {
    toast('文件不是有效的备份 JSON')
    return
  }
  if (!confirm(`导入 ${docs.length} 条数据并覆盖同名内容?`)) return
  const res = await api('/api/restore', { method: 'POST', body: { docs } })
  if (res.ok) {
    toast('导入完成')
    await kvSet('cursor', 0)
    await refreshAll()
    syncNow()
  }
}

onMounted(async () => {
  await refreshAll()
  p.value = { ...profile() }
  fillMetrics()
  fillHabits()
  outboxN.value = (await outboxAll()).length
})
</script>
