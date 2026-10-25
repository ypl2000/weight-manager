<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>🤖 AI 教练</h1>
        <p class="sub">读你的体重与打卡数据,生成阶段解读</p>
      </div>
      <router-link to="/" class="link" style="margin-top: 0; white-space: nowrap">← 返回今日</router-link>
    </header>

    <p v-if="!S.online" class="banner warn">当前离线:AI 解读需要联网,请联网后再试。</p>

    <!-- 生成 -->
    <section class="card">
      <h2>生成解读</h2>
      <div class="seg">
        <button
          v-for="d in DAY_OPTIONS" :key="d"
          :class="{ on: days === d }"
          :disabled="generating"
          @click="days = d"
        >近{{ d }}天</button>
      </div>
      <button style="width: 100%" :disabled="generating || !S.online" @click="generate">
        {{ generating ? '生成中…(含思考约需 30-60 秒)' : '生成 AI 解读' }}
      </button>

      <p v-if="errMsg" class="banner warn">{{ errMsg }}</p>
      <p v-else-if="partial" class="banner">生成中断:以下内容可能不完整。</p>

      <div v-if="content || generating" ref="reportBox" class="report">{{ content }}<span v-if="generating" class="caret">▍</span></div>
    </section>

    <!-- 历史 -->
    <section class="card">
      <div class="row">
        <h2 style="margin: 0">历史解读</h2>
        <button class="small ghost" :disabled="histLoading" @click="loadHistory">
          {{ histLoading ? '刷新中…' : '刷新' }}
        </button>
      </div>
      <p v-if="!history.length && !histLoading" class="muted" style="margin-top: 10px">
        还没有生成过解读。记录体重和打卡几天后,让 AI 教练帮你读数据。
      </p>
      <div v-for="h in history" :key="h.id" class="hist-item">
        <div class="row hist-head" @click="toggle(h.id)">
          <span class="hist-meta">
            <span v-if="h.data.days" class="pill">近{{ h.data.days }}天</span>
            <span class="muted">{{ fmtLocal(h.data.at) }}<template v-if="h.data.model"> · {{ h.data.model }}</template></span>
          </span>
          <span class="hist-ops">
            <span class="muted" style="font-size: 12px">{{ expanded[h.id] ? '收起 ▴' : '展开 ▾' }}</span>
            <button class="small danger" @click.stop="delReport(h)">删</button>
          </span>
        </div>
        <div v-if="expanded[h.id]" class="report">{{ h.data.content }}</div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { S, fmtLocal, toast } from '../store'
import { api, pin, queueWrite } from '../sync'

const DAY_OPTIONS = [7, 30, 90]

// ---- 生成状态 ----
const days = ref(30)
const generating = ref(false)
const content = ref('')
const errMsg = ref('')
const partial = ref(false)
const reportBox = ref(null)

// SSE 流最长静默时间:大模型"思考"阶段可能 60 秒以上才出首字节,
// 超过该时长没收到任何字节就主动断开,避免按钮永远卡在"生成中"
const IDLE_MS = 120000

let abortCtrl = null
let watchdog = null
let timedOut = false
let cancelled = false

function resetWatchdog() {
  clearTimeout(watchdog)
  watchdog = setTimeout(() => {
    timedOut = true
    if (abortCtrl) abortCtrl.abort()
  }, IDLE_MS)
}

async function generate() {
  if (generating.value || !S.online) return // 防重复提交
  generating.value = true
  content.value = ''
  errMsg.value = ''
  partial.value = false
  timedOut = false
  cancelled = false
  abortCtrl = new AbortController()
  resetWatchdog()
  try {
    // 流式响应用原生 fetch + reader,手动带访问码头(与 sync.js api() 的 pin 头一致)
    const res = await fetch('/api/coach/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(pin() ? { 'X-Access-Code': pin() } : {}),
      },
      body: JSON.stringify({ days: days.value }),
      signal: abortCtrl.signal,
    })
    if (res.status === 401) {
      window.dispatchEvent(new Event('wm-locked'))
      return
    }
    if (!res.ok || !res.body) {
      let detail = ''
      try {
        const j = await res.json()
        detail = j.detail || j.error || ''
      } catch { /* 非 JSON 错误体 */ }
      throw new Error(detail || `服务端返回错误(错误码 ${res.status})`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let gotDone = false

    // 解析一行 "data: {...}"
    const onLine = (line) => {
      const t = line.trim()
      if (!t.startsWith('data:')) return
      let evt
      try { evt = JSON.parse(t.slice(5).trim()) } catch { return } // 忽略无法解析的帧
      if (typeof evt.delta === 'string' && evt.delta) content.value += evt.delta
      else if (evt.error) errMsg.value = evt.error
      else if (evt.done) gotDone = true
    }
    // SSE 以空行(\n\n)分帧,最后一段可能不完整,留在缓冲区等下一个包;
    // 兼容用 \r\n 换行的实现(如 sse-starlette),先统一归一成 \n
    const feed = (chunk) => {
      buf = (buf + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n')
      const frames = buf.split('\n\n')
      buf = frames.pop() || ''
      for (const f of frames) for (const l of f.split('\n')) onLine(l)
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      resetWatchdog()
      feed(value)
    }
    // 流正常关闭,把缓冲区里未以空行结尾的残余也解析掉
    buf += decoder.decode()
    for (const l of buf.split('\n')) onLine(l)

    if (gotDone) loadHistory()
    if (errMsg.value) {
      // 收到 error 事件,横幅已显示原因
    } else if (gotDone) {
      toast('解读完成')
    } else if (content.value) {
      partial.value = true // 断流:有正文但没等到 done
    } else {
      errMsg.value = '连接中断,没有收到任何内容,请重试'
    }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      if (cancelled) { /* 离开页面触发的取消,静默 */ }
      else if (timedOut) errMsg.value = '等待超时:服务端长时间没有响应,请稍后重试'
      else errMsg.value = '已取消生成'
    } else if (!errMsg.value) {
      errMsg.value = '网络异常:' + String((e && e.message) || e)
    }
  } finally {
    clearTimeout(watchdog)
    watchdog = null
    abortCtrl = null
    generating.value = false
  }
}

// 生成中让内容区跟随滚动到底部
watch(content, async () => {
  if (!generating.value) return
  await nextTick()
  const box = reportBox.value
  if (box) box.scrollTop = box.scrollHeight
})

// ---- 历史报告 ----
const history = ref([])
const histLoading = ref(false)
const expanded = ref({})

async function loadHistory() {
  histLoading.value = true
  try {
    const res = await api('/api/tables/coach_reports')
    if (res.ok) {
      const list = await res.json()
      history.value = (Array.isArray(list) ? list : [])
        .filter((d) => d && !d.deleted && d.data)
        .sort((a, b) => ((a.data.at || '') < (b.data.at || '') ? 1 : -1))
    }
  } catch { /* 离线或未解锁时保留当前列表 */ }
  finally { histLoading.value = false }
}

function toggle(id) {
  expanded.value[id] = !expanded.value[id]
}

async function delReport(h) {
  if (!confirm('确定删除这条解读?')) return
  await queueWrite('coach_reports', h.id, {}, { deleted: true }) // 软删除,进同步队列
  history.value = history.value.filter((x) => x.id !== h.id)
  toast('已删除')
}

onMounted(loadHistory)
onUnmounted(() => {
  cancelled = true
  if (abortCtrl) abortCtrl.abort()
  clearTimeout(watchdog)
})
</script>

<style scoped>
.report {
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px;
  font-size: 14px;
  line-height: 1.7;
  margin-top: 10px;
  max-height: 65vh;
  overflow-y: auto;
}
.caret {
  color: var(--teal);
  animation: caret-blink 1s step-start infinite;
}
@keyframes caret-blink { 50% { opacity: 0; } }

.hist-item { border-top: 1px dashed var(--line); padding: 9px 0 2px; }
.hist-item:first-of-type { border-top: none; }
.hist-head { cursor: pointer; }
.hist-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.hist-ops { display: flex; align-items: center; gap: 8px; flex: none; }
</style>
