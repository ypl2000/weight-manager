<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>🤖 AI 教练</h1>
        <p class="sub">读你的体重与打卡数据,生成阶段解读</p>
      </div>
      <router-link to="/" class="link" style="margin-top: 0; white-space: nowrap">← 返回今日</router-link>
    </header>

    <p v-if="!S.online" class="banner warn">当前离线:AI 解读与提问都需要联网,请联网后再试。</p>

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
      <button style="width: 100%" :disabled="generating || asking || !S.online" @click="generate">
        {{ generating ? '生成中…(含思考约需 30-60 秒)' : '生成 AI 解读' }}
      </button>

      <p v-if="errMsg" class="banner warn">{{ errMsg }}</p>
      <p v-else-if="partial" class="banner">生成中断:以下内容可能不完整。</p>

      <div v-if="content || generating" ref="reportBox" class="report">{{ content }}<span v-if="generating" class="caret">▍</span></div>
    </section>

    <!-- 问教练 -->
    <section class="card">
      <h2>问教练</h2>
      <textarea
        v-model="question"
        :disabled="asking"
        placeholder="问点什么，比如：间歇性断食值得做吗？"
      ></textarea>
      <p v-if="askErr" class="banner warn">{{ askErr }}</p>
      <button style="width: 100%; margin-top: 8px" :disabled="asking || generating || !S.online" @click="askCoach">
        {{ asking ? '思考中…约需 15-40 秒' : '提问' }}
      </button>
      <div v-if="answer || asking" ref="askBox" class="report">{{ answer }}<span v-if="asking" class="caret">▍</span></div>
    </section>

    <!-- 问答历史 -->
    <section class="card">
      <div class="row">
        <h2 style="margin: 0">问答历史</h2>
        <button class="small ghost" :disabled="qaLoading" @click="loadQa">
          {{ qaLoading ? '刷新中…' : '刷新' }}
        </button>
      </div>
      <p v-if="!qaList.length && !qaLoading" class="muted" style="margin-top: 10px">
        还没有提问过。有减肥困惑,直接问教练。
      </p>
      <div v-for="qa in qaList" :key="qa.id" class="hist-item">
        <div class="row hist-head" @click="toggleQa(qa.id)">
          <span class="hist-meta">
            <b class="q-text">Q: {{ qa.data.question }}</b>
            <span class="muted">{{ fmtLocal(qa.data.at) }}<template v-if="qa.data.model"> · {{ qa.data.model }}</template></span>
          </span>
          <span class="hist-ops">
            <span class="muted" style="font-size: 12px">{{ qaExpanded[qa.id] ? '收起 ▴' : '展开 ▾' }}</span>
            <button class="small danger" @click.stop="delQa(qa)">删</button>
          </span>
        </div>
        <div v-if="qaExpanded[qa.id]" class="report">{{ qa.data.answer }}</div>
      </div>
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

// ---- 教练 SSE 流式请求(生成解读 / 问教练 共用) ----
// SSE 流最长静默时间:大模型"思考"阶段可能 60 秒以上才出首字节,
// 超过该时长没收到任何字节就主动断开,避免按钮永远卡在"生成中"
const IDLE_MS = 120000

// 进行中的请求控制器,离开页面时统一中止
const activeCtrls = new Set()

// POST 一个教练 SSE 接口,逐帧回调 handler({ delta, error })。
// 返回 { status, ok, detail, gotDone, abort, timedOut }:
// - status=401:未解锁,内部已派发 wm-locked,调用方直接返回
// - ok=false 且非 abort:HTTP/网络错误,detail 为可直接展示的说明
// - abort=true:请求被中止,timedOut 区分"等待超时"与"离开页面"
async function coachStream(path, body, handler) {
  const ctrl = new AbortController()
  activeCtrls.add(ctrl)
  let watchdog = null
  let timedOut = false
  const resetWatchdog = () => {
    clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      timedOut = true
      ctrl.abort()
    }, IDLE_MS)
  }
  resetWatchdog()
  try {
    // 流式响应用原生 fetch + reader,手动带访问码头(与 sync.js api() 的 pin 头一致)
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(pin() ? { 'X-Access-Code': pin() } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (res.status === 401) {
      window.dispatchEvent(new Event('wm-locked'))
      return { status: 401, ok: false }
    }
    if (!res.ok || !res.body) {
      let detail = ''
      try {
        const j = await res.json()
        detail = j.detail || j.error || ''
      } catch { /* 非 JSON 错误体 */ }
      return { status: res.status, ok: false, detail }
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
      if (typeof evt.delta === 'string' && evt.delta) handler.delta(evt.delta)
      else if (evt.error) handler.error(evt.error)
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

    return { status: res.status, ok: true, gotDone }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      return { status: 0, ok: false, abort: true, timedOut }
    }
    return { status: 0, ok: false, detail: '网络异常:' + String((e && e.message) || e) }
  } finally {
    clearTimeout(watchdog)
    activeCtrls.delete(ctrl)
  }
}

// ---- 生成解读 ----
const days = ref(30)
const generating = ref(false)
const content = ref('')
const errMsg = ref('')
const partial = ref(false)
const reportBox = ref(null)

async function generate() {
  if (generating.value || asking.value || !S.online) return // 防重复提交
  generating.value = true
  content.value = ''
  errMsg.value = ''
  partial.value = false
  try {
    const r = await coachStream('/api/coach/report', { days: days.value }, {
      delta: (t) => { content.value += t },
      error: (msg) => { errMsg.value = msg },
    })
    if (r.status === 401) return // 已弹解锁
    if (r.abort) {
      if (r.timedOut) errMsg.value = '等待超时:服务端长时间没有响应,请稍后重试'
      // 离开页面触发的取消:静默
    } else if (!r.ok) {
      errMsg.value = r.detail || `服务端返回错误(错误码 ${r.status})`
    } else {
      if (r.gotDone) loadHistory()
      if (errMsg.value) {
        // 收到 error 事件,横幅已显示原因
      } else if (r.gotDone) {
        toast('解读完成')
      } else if (content.value) {
        partial.value = true // 断流:有正文但没等到 done
      } else {
        errMsg.value = '连接中断,没有收到任何内容,请重试'
      }
    }
  } finally {
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

// ---- 问教练 ----
const MAX_Q = 500
const question = ref('')
const asking = ref(false)
const answer = ref('')
const askErr = ref('')
const askBox = ref(null)

async function askCoach() {
  const q = question.value.trim()
  if (asking.value || generating.value || !S.online) return // 防重复提交/离线
  if (!q) { askErr.value = '请先输入问题'; return } // 空输入前置拦截
  if (q.length > MAX_Q) { askErr.value = `问题不能超过 ${MAX_Q} 字,请精简后再问`; return } // 超长前置拦截
  asking.value = true
  answer.value = ''
  askErr.value = ''
  try {
    const r = await coachStream('/api/coach/ask', { question: q }, {
      delta: (t) => { answer.value += t },
      error: (msg) => { askErr.value = msg },
    })
    if (r.status === 401) return // 已弹解锁
    if (r.abort) {
      if (r.timedOut) askErr.value = '等待超时:服务端长时间没有响应,请稍后重试'
      // 离开页面触发的取消:静默
    } else if (!r.ok) {
      askErr.value = r.detail || `服务端返回错误(错误码 ${r.status})`
    } else if (r.gotDone) {
      loadQa() // 服务端已把这条问答存档,刷新问答历史
      toast('回答完成')
    } else if (answer.value) {
      askErr.value = '回答中断:以下内容可能不完整'
    } else {
      askErr.value = '连接中断,没有收到任何内容,请重试'
    }
  } finally {
    asking.value = false
  }
}

// 回答流式输出时让内容区跟随滚动到底部
watch(answer, async () => {
  if (!asking.value) return
  await nextTick()
  const box = askBox.value
  if (box) box.scrollTop = box.scrollHeight
})

// ---- 问答历史 ----
const qaList = ref([])
const qaLoading = ref(false)
const qaExpanded = ref({})

async function loadQa() {
  qaLoading.value = true
  try {
    const res = await api('/api/tables/coach_qa')
    if (res.ok) {
      const list = await res.json()
      qaList.value = (Array.isArray(list) ? list : [])
        .filter((d) => d && !d.deleted && d.data)
        .sort((a, b) => ((a.data.at || '') < (b.data.at || '') ? 1 : -1))
    }
  } catch { /* 离线或未解锁时保留当前列表 */ }
  finally { qaLoading.value = false }
}

function toggleQa(id) {
  qaExpanded.value[id] = !qaExpanded.value[id]
}

async function delQa(item) {
  if (!confirm('确定删除这条问答?')) return
  await queueWrite('coach_qa', item.id, {}, { deleted: true }) // 软删除,进同步队列
  qaList.value = qaList.value.filter((x) => x.id !== item.id)
  toast('已删除')
}

onMounted(() => {
  loadHistory()
  loadQa()
})
onUnmounted(() => {
  for (const c of activeCtrls) c.abort() // 离开页面中止进行中的流
  activeCtrls.clear()
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
.q-text { min-width: 0; flex: 1 1 140px; word-break: break-word; }
</style>
