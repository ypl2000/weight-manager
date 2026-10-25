// 同步引擎:本地写 → outbox 队列;联网后推/拉合并(按 updated_at 后写者胜),游标续传
import { docGet, docPut, outboxAll, outboxAdd, outboxDel, kvGet, kvSet } from './db'
import { S } from './store'

export function deviceId() {
  let d = localStorage.getItem('wmDevice')
  if (!d) {
    d = crypto.randomUUID()
    localStorage.setItem('wmDevice', d)
  }
  return d
}

export function pin() {
  return localStorage.getItem('wmPin') || ''
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const h = {}
  if (pin()) h['X-Access-Code'] = pin()
  let b = body
  if (body && !form) {
    h['Content-Type'] = 'application/json'
    b = JSON.stringify(body)
  }
  if (form) Object.assign(h, form.headers || {})
  const res = await fetch(path, { method, headers: h, body: form ? form.body : b })
  if (res.status === 401) {
    window.dispatchEvent(new Event('wm-locked'))
    throw new Error('需要访问码')
  }
  return res
}

// 本地写入口:界面所有增删改都走这里(先写本地,再进待同步队列)
// 注意:调用方传入的 data 可能含 Vue 响应式对象(Proxy),IDB 无法结构化克隆,
// 这里统一 JSON 深拷贝成纯对象再入库
let quickTimer = null
export async function queueWrite(table, id, data, { deleted = false } = {}) {
  const plain = JSON.parse(JSON.stringify(data ?? {}))
  const updated_at = new Date().toISOString()
  await docPut({ table, id, data: plain, updated_at, deleted: deleted ? 1 : 0 })
  await outboxAdd({ oid: crypto.randomUUID(), table, id, data: plain, updated_at, deleted: deleted ? 1 : 0 })
  window.dispatchEvent(new CustomEvent('wm-local'))
  // 写完 1.5 秒内快速推一次,不必等 30 秒周期
  if (!quickTimer) {
    quickTimer = setTimeout(() => { quickTimer = null; syncNow() }, 1500)
  }
}

let syncing = false
let lastError = ''

export async function syncNow() {
  if (syncing || !navigator.onLine) return { ok: false }
  syncing = true
  lastError = ''
  try {
    let cursor = (await kvGet('cursor')) || 0
    let pulled = 0
    let pushed = 0
    for (let i = 0; i < 10; i++) {
      const box = await outboxAll()
      const res = await api('/api/sync', {
        method: 'POST',
        body: {
          device: deviceId(),
          cursor,
          changes: box.map((b) => ({
            table: b.table, id: b.id, data: b.data,
            updated_at: b.updated_at, deleted: !!b.deleted,
          })),
        },
      })
      if (!res.ok) {
        lastError = '服务端错误 ' + res.status
        return { ok: false }
      }
      const data = await res.json()
      for (const b of box) await outboxDel(b.oid)
      pushed += box.length

      for (const ch of data.changes || []) {
        const local = await docGet(ch.table, ch.id)
        if (local && local.updated_at > ch.updated_at) continue
        await docPut({
          table: ch.table, id: ch.id, data: ch.data,
          updated_at: ch.updated_at, deleted: ch.deleted ? 1 : 0,
        })
      }
      pulled += (data.changes || []).length
      cursor = data.cursor
      await kvSet('cursor', cursor)
      if (!(data.changes || []).length) break
    }
    localStorage.setItem('wmLastSync', new Date().toISOString())
    S.lastSync = localStorage.getItem('wmLastSync')
    window.dispatchEvent(new CustomEvent('wm-synced', { detail: { pulled, pushed } }))
    return { ok: true, pulled, pushed }
  } catch (e) {
    lastError = String(e && e.message || e)
    return { ok: false }
  } finally {
    syncing = false
  }
}

export function syncState() {
  return { lastError }
}

export function initSync() {
  window.addEventListener('online', () => syncNow())
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow() })
  setInterval(() => syncNow(), 30000)
  setTimeout(() => syncNow(), 800)
}
