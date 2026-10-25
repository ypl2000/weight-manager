<template>
  <div v-if="!locked" class="app">
    <router-view v-if="S.ready" />
    <div v-else class="loading">加载中…</div>

    <nav class="tabbar">
      <router-link to="/"><span class="ico">🏠</span><span>今日</span></router-link>
      <router-link to="/data"><span class="ico">📋</span><span>数据</span></router-link>
      <router-link to="/stage"><span class="ico">🧭</span><span>阶段</span></router-link>
      <router-link to="/training"><span class="ico">🏋️</span><span>训练</span></router-link>
      <router-link to="/settings"><span class="ico">⚙️</span><span>设置</span></router-link>
    </nav>

    <div v-if="toastMsg" id="toast">{{ toastMsg }}</div>
  </div>

  <div v-else class="unlock-page">
    <div class="unlock-box">
      <h2>🔒 输入访问码</h2>
      <p class="muted">服务端设置了访问码,输入后可使用本设备。</p>
      <input v-model="code" type="password" placeholder="访问码" @keyup.enter="unlock" />
      <p v-if="err" class="muted" style="color: var(--red)">{{ err }}</p>
      <button style="width: 100%; margin-top: 8px" @click="unlock">解锁</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { S, refreshAll, toast as noop } from './store'
import { initSync, syncNow, api, pin } from './sync'

const locked = ref(false)
const code = ref('')
const err = ref('')
const toastMsg = ref('')
let toastTimer = null
let refreshTimer = null

function scheduleRefresh() {
  if (refreshTimer) return
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    refreshAll()
  }, 250)
}

function showToast(e) {
  toastMsg.value = e.detail
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toastMsg.value = ''), 2200)
}

async function unlock() {
  err.value = ''
  try {
    const res = await fetch('/api/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.value }),
    })
    if (!res.ok) {
      err.value = '访问码不对,再试试'
      return
    }
    localStorage.setItem('wmPin', code.value)
    locked.value = false
    syncNow()
  } catch {
    err.value = '连不上服务端'
  }
}

onMounted(async () => {
  initSync()
  window.addEventListener('wm-synced', scheduleRefresh)
  window.addEventListener('wm-local', scheduleRefresh)
  window.addEventListener('wm-toast', showToast)
  window.addEventListener('wm-locked', () => (locked.value = true))
  window.addEventListener('online', () => (S.online = true))
  window.addEventListener('offline', () => (S.online = false))
  try {
    const probe = await fetch('/api/tables/metrics', {
      headers: pin() ? { 'X-Access-Code': pin() } : {},
    })
    if (probe.status === 401) locked.value = true
  } catch { /* 服务端未启动时也让页面渲染,便于看离线效果 */ }
})

onUnmounted(() => {
  window.removeEventListener('wm-toast', showToast)
})
</script>
