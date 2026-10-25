// 响应式数据缓存:从 IndexedDB 装载,同步事件后刷新
import { reactive } from 'vue'
import { docsByTable, outboxAll } from './db'

export const S = reactive({
  ready: false,
  tables: {},
  online: navigator.onLine,
  lastSync: localStorage.getItem('wmLastSync') || '',
})

const TABLES = ['profile', 'metrics', 'records', 'stages', 'exercises',
  'habits', 'workouts', 'habit_logs', 'stage_history']

export async function refreshAll() {
  for (const t of TABLES) S.tables[t] = (await docsByTable(t)) || []
  S.ready = true
}

export async function outboxCount() {
  return ((await outboxAll()) || []).length
}

export const rows = (t) => (S.tables[t] || []).filter((d) => !d.deleted)
export const dataOf = (t) =>
  rows(t).map((d) => ({ ...d.data, _id: d.id, _updated: d.updated_at }))

export function profile() {
  const me = rows('profile').find((d) => d.id === 'me')
  return me ? me.data : {}
}

export function metrics() {
  return dataOf('metrics')
    .filter((m) => m.active !== false)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
}
export function allMetrics() {
  return dataOf('metrics').sort((a, b) => (a.sort || 0) - (b.sort || 0))
}

export function stages() {
  return dataOf('stages')
    .filter((s) => s.active !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
}
export function allStages() {
  return dataOf('stages').sort((a, b) => (a.order || 0) - (b.order || 0))
}
export function currentStage() {
  const p = profile()
  return stages().find((s) => s._id === p.current_stage_id) || stages()[0] || null
}

export function recordsOf(code) {
  return dataOf('records')
    .filter((r) => r.metric_code === code)
    .sort((a, b) => (a.at < b.at ? -1 : 1))
}
export function latestRecord(code) {
  const r = recordsOf(code)
  return r[r.length - 1] || null
}

export function habits() {
  return dataOf('habits')
    .filter((h) => h.active !== false)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
}
export function exercises(type) {
  return dataOf('exercises')
    .filter((e) => e.active !== false && (!type || e.type === type))
}

export function stageHistory() {
  return dataOf('stage_history').sort((a, b) => (a.at < b.at ? 1 : -1))
}

export function whr() {
  const w = latestRecord('waist')
  const h = latestRecord('hip')
  if (!w || !h || !h.value) return null
  return +(w.value / h.value).toFixed(2)
}

export function bmi() {
  const p = profile()
  const w = latestRecord('weight')
  if (!p.height_cm || !w) return null
  return +(w.value / Math.pow(p.height_cm / 100, 2)).toFixed(1)
}

export function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fmtLocal(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('zh-CN')
}

export function toast(msg) {
  window.dispatchEvent(new CustomEvent('wm-toast', { detail: msg }))
}
