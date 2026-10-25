<template>
  <div class="page">
    <header class="page-head">
      <div><h1>数据</h1><p class="sub">录入 / 趋势 / 拍照识别</p></div>
      <span class="sync-dot" :class="S.online ? '' : 'off'">{{ S.online ? '在线' : '离线' }}</span>
    </header>

    <div class="seg">
      <button :class="{ on: tab === 'entry' }" @click="tab = 'entry'">录入</button>
      <button :class="{ on: tab === 'trend' }" @click="tab = 'trend'">趋势</button>
      <button :class="{ on: tab === 'camera' }" @click="tab = 'camera'">📷 识别</button>
    </div>

    <!-- 录入 -->
    <template v-if="tab === 'entry'">
      <section class="card">
        <h2>新增记录</h2>
        <div class="grid2" style="margin-bottom: 8px">
          <label class="field">指标
            <select v-model="form.metric_code">
              <option v-if="!metrics().length" value="" disabled>数据加载中…</option>
              <option v-for="m in metrics()" :key="m._id" :value="m.code">{{ m.name }}</option>
            </select>
          </label>
          <label class="field">数值{{ unit ? ' (' + unit + ')' : '' }}
            <input v-model="form.value" type="number" step="0.01" inputmode="decimal" placeholder="如 72.5" />
          </label>
        </div>
        <div class="grid2">
          <label class="field">时间
            <input v-model="form.atLocal" type="datetime-local" />
          </label>
          <label class="field">备注
            <input v-model="form.note" type="text" placeholder="选填" />
          </label>
        </div>
        <p v-if="!metrics().length" class="muted">数据加载中…</p>
        <p v-if="metricHint" class="muted">{{ metricHint }}</p>
        <button @click="save" :disabled="!form.value || !metrics().length" style="width: 100%">保存记录</button>
      </section>

      <section class="card">
        <h2>最近记录</h2>
        <table class="list" v-if="recent.length">
          <thead><tr><th>指标</th><th>数值</th><th>时间</th><th></th></tr></thead>
          <tbody>
            <tr v-for="r in recent" :key="r._id">
              <td>{{ metricName(r.metric_code) }}</td>
              <td><b>{{ r.value }}</b> {{ r.unit }}</td>
              <td class="muted">{{ fmtLocal(r.at) }}<span v-if="r.source === 'ai'" class="pill">识别</span></td>
              <td><button class="small danger" @click="del(r)">删</button></td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">还没有记录,先录一条吧</p>
      </section>
    </template>

    <!-- 趋势 -->
    <template v-if="tab === 'trend'">
      <section class="card">
        <div class="row" style="margin-bottom: 8px">
          <select v-model="trendCode" style="flex: 1">
            <option v-for="m in metrics()" :key="m._id" :value="m.code">{{ m.name }}</option>
          </select>
          <select v-model="rangeDays" style="width: 110px">
            <option :value="30">近30天</option>
            <option :value="90">近90天</option>
            <option :value="0">全部</option>
          </select>
        </div>
        <div ref="chartEl" style="width: 100%; height: 300px"></div>
        <p class="muted">背景色带 = 所处阶段;虚线 = 周平均值。{{ thresholdLine }}</p>
      </section>
      <section class="card">
        <h2>阶段切换历史</h2>
        <table class="list" v-if="stageHist.length">
          <tbody>
            <tr v-for="h in stageHist" :key="h._id">
              <td>{{ fmtLocal(h.at) }}</td>
              <td>{{ stageName(h.from_stage_id) }} → <b>{{ stageName(h.to_stage_id) }}</b></td>
              <td class="muted">{{ h.reason }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">还没有切换记录</p>
      </section>
    </template>

    <!-- 拍照识别 -->
    <template v-if="tab === 'camera'">
      <section class="card">
        <h2>拍照 / 传图识别</h2>
        <p class="muted">拍体重秤读数、体脂秤APP截图或体检报告,AI 自动提取数值;识别结果需确认后才入库。</p>
        <input type="file" accept="image/*" capture="environment" @change="onPick" />
        <img v-if="previewUrl" :src="previewUrl" class="img-prev" alt="预览" />
        <div class="row" style="margin-top: 8px">
          <button @click="recognizeNow" :disabled="!picked || busy" style="flex: 1">
            {{ busy ? '识别中…' : '开始识别' }}
          </button>
        </div>
        <p v-if="!S.online" class="banner warn" style="margin-top: 8px">
          当前离线:可先把图片存入待识别队列,联网后回来点击识别。
          <button class="small" @click="queueImage">存入队列</button>
        </p>
        <p v-if="demoMode" class="banner info" style="margin-top: 8px">
          服务端处于演示模式(未配置AI Key),返回的是演示数据。到 设置→AI识别 配置后可真实识别。
        </p>
      </section>

      <section class="card" v-if="queueCount">
        <h2>待识别队列({{ queueCount }})</h2>
        <button :disabled="!S.online || busy" @click="flushQueue">联网了,识别全部</button>
      </section>

      <section class="card" v-if="cands.length">
        <h2>识别结果(确认后入库)</h2>
        <div class="cand" v-for="(c, i) in cands" :key="i">
          <div class="head">
            <span>{{ c.metric_hint || '未匹配指标' }} · 置信 {{ Math.round((c.confidence || 0) * 100) }}%</span>
            <button class="small danger" @click="cands.splice(i, 1)">忽略</button>
          </div>
          <div class="grid3" style="margin-top: 6px">
            <select v-model="c.metric_code">
              <option v-for="m in metrics()" :key="m._id" :value="m.code">{{ m.name }}</option>
            </select>
            <input v-model="c.value" type="number" step="0.01" inputmode="decimal" />
            <input v-model="c.when" type="date" />
          </div>
          <p class="muted" v-if="c.note" style="margin: 4px 0 6px">{{ c.note }}</p>
          <button class="small" @click="saveCand(c, i)" :disabled="!c.value">✓ 确认保存为记录</button>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import * as echarts from 'echarts'
import {
  S, metrics, stages, stageHistory, recordsOf, fmtLocal, today, toast,
} from '../store'
import { queueWrite, api } from '../sync'

const route = useRoute()
const tab = ref(route.query.tab === 'camera' ? 'camera' : 'entry')
// 同一路由只变 query(如从今日页跳 #/data?tab=camera)不会重新挂载,这里手动跟随
watch(() => route.query.tab, (v) => {
  if (v === 'camera' || v === 'trend' || v === 'entry') tab.value = v
})

// ---------- 录入 ----------
const form = ref({ metric_code: 'weight', value: '', atLocal: toLocalInput(new Date()), note: '' })

const unit = computed(() => {
  const m = metrics().find((x) => x.code === form.value.metric_code)
  return m ? m.unit : ''
})
const metricHint = computed(() => {
  const m = metrics().find((x) => x.code === form.value.metric_code)
  return m && m.note ? '💡 ' + m.note : ''
})

async function save() {
  const m = metrics().find((x) => x.code === form.value.metric_code)
  await queueWrite('records', crypto.randomUUID(), {
    metric_code: form.value.metric_code,
    value: +form.value.value,
    unit: (m && m.unit) || '',
    at: new Date(form.value.atLocal).toISOString(),
    note: form.value.note || '',
    source: 'manual',
  })
  form.value.value = ''
  form.value.note = ''
  toast('已保存')
}

const recent = computed(() =>
  [...S.tables.records || []]
    .filter((d) => !d.deleted)
    .sort((a, b) => (a.data.at < b.data.at ? 1 : -1))
    .slice(0, 20)
    .map((d) => ({ _id: d.id, ...d.data })))

function metricName(code) {
  const m = metrics().find((x) => x.code === code)
  return m ? m.name : code
}

async function del(r) {
  await queueWrite('records', r._id, {}, { deleted: true })
  toast('已删除')
}

// ---------- 趋势 ----------
const trendCode = ref('weight')
const rangeDays = ref(90)
const chartEl = ref(null)
let chart = null

const stageHist = computed(() => stageHistory())

function stageName(id) {
  const st = stages().find((s) => s._id === id)
  return st ? st.name : id
}

const thresholdLine = computed(() => {
  const m = metrics().find((x) => x.code === trendCode.value)
  if (!m || !m.thresholds) return ''
  const t = m.thresholds
  const parts = []
  if (t.all != null) parts.push(`阈值 ${t.all}${t.male != null ? `(男 ${t.male})` : ''}`)
  else if (t.male != null) parts.push(`女 ${t.all ?? '—'} / 男 ${t.male}`)
  return parts.length ? `参考:${m.note || parts.join(' ')}` : ''
})

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

function renderChart() {
  if (!chartEl.value) return
  const all = recordsOf(trendCode.value)
  let data = all
  if (rangeDays.value) {
    const cut = Date.now() - rangeDays.value * 86400000
    data = all.filter((r) => new Date(r.at).getTime() >= cut)
  }
  if (!chart) chart = echarts.init(chartEl.value)
  const series = [
    {
      name: '记录',
      type: 'line',
      data: data.map((r) => [r.at, r.value]),
      symbolSize: 6,
      lineStyle: { width: 2, color: '#0f766e' },
      itemStyle: { color: '#0f766e' },
    },
  ]
  // 周平均
  const weeks = new Map()
  for (const r of data) {
    const d = new Date(r.at)
    const day = (d.getDay() + 6) % 7
    d.setDate(d.getDate() - day)
    const key = d.toISOString().slice(0, 10)
    if (!weeks.has(key)) weeks.set(key, [])
    weeks.get(key).push(r.value)
  }
  if (weeks.size > 1) {
    series.push({
      name: '周均',
      type: 'line',
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 2, type: 'dashed', color: '#94a3b8' },
      data: [...weeks.entries()].map(([k, vs]) => [k, +(vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(2)]),
    })
  }
  // 阶段色带
  const hist = [...stageHistory()].sort((a, b) => (a.at < b.at ? -1 : 1))
  const areas = []
  for (let i = 0; i < hist.length; i++) {
    const st = stages().find((s) => s._id === hist[i].to_stage_id)
    const end = i + 1 < hist.length ? hist[i + 1].at : new Date().toISOString()
    if (st) areas.push([{ xAxis: hist[i].at, itemStyle: { color: hexA(st.color || '#3b82f6', 0.08) } }, { xAxis: end }])
  }
  series[0].markArea = { silent: true, data: areas }
  const m = metrics().find((x) => x.code === trendCode.value)
  const yAxis = { type: 'value', scale: true }
  if (m && m.thresholds && m.thresholds.all != null) {
    series[0].markLine = {
      silent: true, symbol: 'none',
      data: [{ yAxis: m.thresholds.all, lineStyle: { color: '#ef4444', type: 'dotted' },
               label: { formatter: `阈值 ${m.thresholds.all}`, position: 'insideEndTop', fontSize: 11 } }],
    }
  }
  chart.setOption({
    animation: false,
    grid: { left: 44, right: 14, top: 18, bottom: 28 },
    tooltip: { trigger: 'axis' },
    legend: { show: series.length > 1, top: 0, textStyle: { fontSize: 11 } },
    xAxis: { type: 'time' },
    yAxis,
    series,
  }, { notMerge: true })
}

watch([tab, trendCode, rangeDays], async () => {
  if (tab.value === 'trend') {
    await nextTick()
    renderChart()
  }
})
watch(() => S.tables.records && S.tables.records.length, async () => {
  if (tab.value === 'trend') {
    await nextTick()
    renderChart()
  }
})
let onSync = async () => {
  if (tab.value === 'trend') {
    await nextTick()
    renderChart()
  }
}

// ---------- 拍照识别 ----------
const picked = ref(null)
const previewUrl = ref('')
const busy = ref(false)
const demoMode = ref(false)
const cands = ref([])
const queueCount = ref(0)
let imgQueue = []

async function loadQueue() {
  imgQueue = (await (await import('../db')).kvGet('imgq')) || []
  queueCount.value = imgQueue.length
}

function onPick(e) {
  const f = e.target.files && e.target.files[0]
  if (!f) return
  picked.value = f
  previewUrl.value = URL.createObjectURL(f)
}

async function doRecognize(blobOrFile, name) {
  const fd = new FormData()
  fd.append('image', blobOrFile, name || 'photo.jpg')
  const res = await api('/api/recognize', { method: 'POST', form: { body: fd } })
  if (!res.ok) {
    const t = await res.json().catch(() => ({}))
    throw new Error(t.detail || '识别失败')
  }
  const data = await res.json()
  demoMode.value = !!data.demo
  for (const c of data.candidates || []) {
    cands.value.push({
      ...c,
      metric_code: c.metric_code || 'weight',
      value: c.value != null ? String(c.value) : '',
      when: c.when || today(),
    })
  }
}

async function recognizeNow() {
  if (!picked.value) return
  busy.value = true
  try {
    await doRecognize(picked.value, picked.value.name || 'photo.jpg')
    toast('识别完成,请确认结果')
    picked.value = null
    previewUrl.value = ''
  } catch (e) {
    toast(String(e.message || e))
  } finally {
    busy.value = false
  }
}

async function queueImage() {
  if (!picked.value) return
  imgQueue = (await (await import('../db')).kvGet('imgq')) || []
  imgQueue.push({ blob: picked.value, name: picked.value.name || 'photo.jpg', at: Date.now() })
  await (await import('../db')).kvSet('imgq', imgQueue)
  queueCount.value = imgQueue.length
  picked.value = null
  previewUrl.value = ''
  toast('已存入待识别队列')
}

async function flushQueue() {
  busy.value = true
  try {
    const db = await import('../db')
    imgQueue = (await db.kvGet('imgq')) || []
    const rest = []
    for (const it of imgQueue) {
      try {
        await doRecognize(it.blob, it.name)
      } catch {
        rest.push(it)
      }
    }
    await db.kvSet('imgq', rest)
    queueCount.value = rest.length
    toast(rest.length ? `识别完成,${rest.length}张失败留在队列` : '队列全部识别完成')
  } finally {
    busy.value = false
  }
}

async function saveCand(c, i) {
  const m = metrics().find((x) => x.code === c.metric_code)
  await queueWrite('records', crypto.randomUUID(), {
    metric_code: c.metric_code,
    value: +c.value,
    unit: (m && m.unit) || c.unit || '',
    at: c.when ? new Date(c.when + 'T12:00:00').toISOString() : new Date().toISOString(),
    note: 'AI识别' + (c.note ? ':' + c.note : ''),
    source: 'ai',
  })
  cands.value.splice(i, 1)
  toast('已保存')
}

function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

onMounted(async () => {
  window.addEventListener('wm-synced', onSync)
  await loadQueue()
  if (tab.value === 'trend') {
    await nextTick()
    renderChart()
  }
})
onUnmounted(() => {
  window.removeEventListener('wm-synced', onSync)
  if (chart) chart.dispose()
})
</script>
