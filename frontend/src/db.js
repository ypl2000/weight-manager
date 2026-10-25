// IndexedDB 本地库:docs(全部业务数据) + outbox(待同步变更) + kv(游标/配置)
// 页面长时间挂后台后浏览器可能回收旧连接,这里对事务做超时兜底并自动重连重试
const DB_NAME = 'wm'
const DB_VER = 1
let _p = null

function freshOpen() {
  const p = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER)
    r.onupgradeneeded = () => {
      const d = r.result
      if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: ['table', 'id'] })
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'oid' })
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'key' })
    }
    r.onsuccess = () => {
      r.result.onclose = () => { if (_p === p) _p = null }
      res(r.result)
    }
    r.onerror = () => { if (_p === p) _p = null; rej(r.error) }
  })
  _p = p
  return p
}

function open() {
  if (!_p) _p = freshOpen()
  return _p
}

function runOnce(name, mode, fn) {
  return open().then((db) => new Promise((res, rej) => {
    let done = false
    const t = db.transaction(name, mode)
    let out
    try {
      out = fn(t.objectStore(name))
    } catch (e) { rej(e); return }
    t.oncomplete = () => { done = true; res(out && out.result !== undefined ? out.result : out) }
    t.onerror = t.onabort = () => { done = true; rej(t.error) }
    setTimeout(() => { if (!done) rej('idb-hang') }, 5000)
  }))
}

async function run(name, mode, fn) {
  try {
    return await runOnce(name, mode, fn)
  } catch (e) {
    if (e === 'idb-hang') {
      try { (await _p).close() } catch { /* ignore */ }
      _p = null
      return runOnce(name, mode, fn)
    }
    throw e
  }
}

export const docsAll = () => run('docs', 'readonly', (s) => s.getAll())
export const docsByTable = async (table) =>
  ((await docsAll()) || []).filter((d) => d.table === table)
export const docGet = (table, id) => run('docs', 'readonly', (s) => s.get([table, id]))
export const docPut = (v) => run('docs', 'readwrite', (s) => s.put(v))

export const kvGet = async (key) => {
  const v = await run('kv', 'readonly', (s) => s.get(key))
  return v ? v.value : undefined
}
export const kvSet = (key, value) => run('kv', 'readwrite', (s) => s.put({ key, value }))

export const outboxAll = () => run('outbox', 'readonly', (s) => s.getAll())
export const outboxAdd = (v) => run('outbox', 'readwrite', (s) => s.put(v))
export const outboxDel = (oid) => run('outbox', 'readwrite', (s) => s.delete(oid))
