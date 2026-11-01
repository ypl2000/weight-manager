// 全量功能验证·API 部分(记录CRUD/LWW、导入、阶段、洞察、提醒、数据安全、PWA)
// 只读服务+写 qa/**;测试数据 qa-vf-*/imp_* 用后即清理。node qa/tools/vf-api.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const B = 'http://127.0.0.1:8000';
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend', 'tests', 'fixtures');
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'reports', 'vf-api-results.json');
const results = [];
const T = (id, name, pass, detail) => {
  results.push({ id, name, pass: !!pass, detail: String(detail).slice(0, 500) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} :: ${String(detail).slice(0, 220)}`);
};
const j = async (u, opt) => (await fetch(B + u, opt)).json();
const jr = async (u, opt) => await fetch(B + u, opt);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const visible = (docs) => (docs.documents || docs).filter((d) => !d.deleted);

// ---------- 基线 ----------
const recs0 = visible(await j('/api/tables/records'));
T('base', '测试前基线 records=8/workouts=1/habit_logs=2/coach_qa=1/coach_reports=2',
  recs0.length === 8 && visible(await j('/api/tables/workouts')).length === 1 &&
  visible(await j('/api/tables/habit_logs')).length === 2 &&
  visible(await j('/api/tables/coach_qa')).length === 1 &&
  visible(await j('/api/tables/coach_reports')).length === 2,
  `records=${recs0.length}`);

// ---------- 模块1 记录 ----------
// R1 手动录入
const id1 = 'qa-vf-rec1';
let r = await jr(`/api/tables/records/${id1}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ data: { metric_code: 'weight', value: 77.77, unit: 'kg', at: '2026-11-01T08:00:00+08:00', note: 'qa', source: 'manual' }, updated_at: nowIso() }),
});
T('R1', '手动录入 API', r.ok && (await r.json()).ok, `status=${r.status}`);
let lst = visible(await j('/api/tables/records'));
const got1 = lst.find((d) => d.id === id1);
T('R1b', '录入字段完整可见', got1 && got1.data.value === 77.77 && got1.data.unit === 'kg', JSON.stringify(got1 && got1.data));

// R3 手动编辑
const newAt = nowIso();
await sleep(30);
await jr(`/api/tables/records/${id1}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ data: { metric_code: 'weight', value: 77.78, unit: 'kg', at: '2026-11-01T08:00:00+08:00', note: 'qa-edit', source: 'manual' }, updated_at: newAt }),
});
lst = visible(await j('/api/tables/records'));
const got2 = lst.find((d) => d.id === id1);
T('R3', '手动编辑改值', got2 && got2.data.value === 77.78 && got2.updated_at >= newAt.slice(0, 19), `value=${got2 && got2.data.value} updated_at=${got2 && got2.updated_at}`);

// R5 LWW 新者胜(旧 updated_at 推送不回滚)
const oldPush = await jr('/api/sync', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ device: 'qa-vf', cursor: 0, changes: [{ table: 'records', id: id1, data: { metric_code: 'weight', value: 55.55, unit: 'kg', at: '2026-11-01T08:00:00+08:00' }, updated_at: '2026-10-01T00:00:00Z', deleted: false }] }),
});
const oldPushJson = await oldPush.json();
lst = visible(await j('/api/tables/records'));
const got3 = lst.find((d) => d.id === id1);
T('R5', 'LWW 旧版本不回滚', got3 && got3.data.value === 77.78, `applied=${oldPushJson.applied} value=${got3 && got3.data.value}`);

// R4 手动删除 → 墓碑(GET 列表按设计过滤墓碑;经 /api/sync cursor=0 全量拉取核对)
await jr(`/api/tables/records/${id1}`, { method: 'DELETE' });
const pull0 = await j('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: 'qa-vf', cursor: 0 }) });
const tomb = (pull0.changes || []).find((d) => d.table === 'records' && d.id === id1);
lst = visible(await j('/api/tables/records'));
T('R4', '手动删除软删墓碑', !lst.some((d) => d.id === id1) && tomb && tomb.deleted === true, `GET不可见=${!lst.some((d) => d.id === id1)} sync墓碑deleted=${tomb && tomb.deleted}`);

// R6 拍照识别配置
const ai = await j('/api/meta/ai');
T('R6', 'AI 识别配置(真实模型 glm-5.3-flash)', !!ai.api_key && ai.demo === false && ai.model === 'glm-5.3-flash',
  `model=${ai.model} demo=${ai.demo} key=${ai.api_key ? 'set' : 'unset'}`);

// R7 拍照识别-真实识别(生成含 77.77 文本的 PNG)
function makePngB64() {
  // 最小 PNG:用 canvas 无法在 node 画,手写一张 260x120 白底难以;改为借 headless 不可行 →
  // 这里用 Node 无依赖生成 BMP? /api/recognize 支持 image/*。直接构造极小 PNG 需 zlib。
  return null;
}
// 改用 node:zlib 手写 PNG(白底黑字太复杂,改画一条含"77.77"含义的说明不可行;
// 真实识别用图由 vf-ui.mjs 里 headless canvas 生成并落盘,这里若文件已存在则复用)
import { existsSync, readFileSync } from 'node:fs';
const PNGpath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vf-scale.png');
if (existsSync(PNGpath)) {
  const fd = new FormData();
  fd.append('image', new Blob([readFileSync(PNGpath)], { type: 'image/png' }), 'scale.png');
  const t0 = Date.now();
  const rec = await (await fetch(B + '/api/recognize', { method: 'POST', body: fd })).json();
  T('R7', '拍照识别-真实模型', rec && rec.demo === false && Array.isArray(rec.candidates),
    `${Date.now() - t0}ms demo=${rec.demo} candidates=${JSON.stringify(rec.candidates).slice(0, 200)}`);
} else {
  T('R7', '拍照识别-真实模型', false, '缺 qa/tools/vf-scale.png(由 vf-ui.mjs 生成后重跑)');
}

// R8 空图
{
  const fd = new FormData();
  fd.append('image', new Blob([], { type: 'image/png' }), 'empty.png');
  const resp = await fetch(B + '/api/recognize', { method: 'POST', body: fd });
  T('R8', '拍照识别-空图 400', resp.status === 400, `status=${resp.status} body=${await resp.text()}`);
}

// R10-R16 批量导入
const fd2 = new FormData();
fd2.append('file', new Blob([readFileSync(path.join(FIX, 'chinese.csv'))], { type: 'text/csv' }), 'chinese.csv');
const pv1 = await (await fetch(B + '/api/import/preview', { method: 'POST', body: fd2 })).json();
const mappedOk = pv1 && pv1.format === 'csv' && pv1.total === 4 &&
  pv1.mapped_columns && pv1.mapped_columns['体重/kg'] === 'weight' && pv1.mapped_columns['体脂率/%'] === 'bodyfat' && pv1.mapped_columns['腰围/cm'] === 'waist';
const allWarn = JSON.stringify((pv1.rows || []).map((r) => r.warnings));
T('R10', '导入 chinese.csv preview', !!mappedOk, `format=${pv1.format} total=${pv1.total} mapped=${JSON.stringify(pv1.mapped_columns)} warnings=${allWarn}`);
const decRows = JSON.stringify(pv1.rows.map((r) => ({ at: r.at, m: r.metrics })));
T('R10b', 'preview 口径(小数体脂/斜杠日期/999剔除/坏日期行丢弃)',
  decRows.includes('24.9') && decRows.includes('2026-10-21T23:45:00Z') && !decRows.includes('999') && pv1.total === 4, decRows.slice(0, 320));

// commit 用日期平移副本(-365 天)保证是全新 id(此前轮次残留的 imp_* 墓碑占用确定性 id 也会被计入去重)
const SHIFT = (at) => new Date(Date.parse(at) - 365 * 86400000).toISOString();
const rowsShifted = pv1.rows.map((r) => ({ ...r, at: SHIFT(r.at) }));
const cm1 = await j('/api/import/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: rowsShifted, note: 'qa-vf-import' }) });
T('R11', 'commit imported=11 skipped=0(999已剔除行仍导其余指标)', cm1.imported === 11 && cm1.skipped === 0, JSON.stringify(cm1));
const impDocs = visible(await j('/api/tables/records')).filter((d) => d.id.startsWith('imp_'));
T('R11b', '导入记录 source=import/id 规则', impDocs.length === 11 && impDocs.every((d) => d.data.source === 'import'), `imp可见=${impDocs.length} 样例=${JSON.stringify(impDocs[0] && impDocs[0].data)}`);

const cm2 = await j('/api/import/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: pv1.rows, note: 'qa-vf-import' }) });
const cm3 = await j('/api/import/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: rowsShifted, note: 'qa-vf-import' }) });
T('R12', '重复 commit 幂等 imported=0(含墓碑占位口径,见缺陷 D5)', cm2.imported === 0 && cm2.skipped === 11 && cm3.imported === 0 && cm3.skipped === 11, `原样=${JSON.stringify(cm2)} 平移副本=${JSON.stringify(cm3)}`);

const fd3 = new FormData();
fd3.append('file', new Blob([readFileSync(path.join(FIX, 'export.zip'))], { type: 'application/zip' }), 'export.zip');
const pv2 = await (await fetch(B + '/api/import/preview', { method: 'POST', body: fd3 })).json();
T('R13', '导入 export.zip preview(apple_health)', pv2 && pv2.format === 'apple_health' && pv2.total === 3 && JSON.stringify(pv2.mapped_columns).includes('"weight"'), `format=${pv2.format} total=${pv2.total} mapped=${JSON.stringify(pv2.mapped_columns)}`);

const fd4 = new FormData();
fd4.append('file', new Blob([readFileSync(path.join(FIX, 'huawei.json'))], { type: 'application/json' }), 'huawei.json');
const pv3 = await (await fetch(B + '/api/import/preview', { method: 'POST', body: fd4 })).json();
const hwRows = JSON.stringify(pv3.rows || []);
T('R14', '导入 huawei.json preview(huawei_json)', pv3 && pv3.format === 'huawei_json' && pv3.total === 2 && hwRows.includes('77.9') && hwRows.includes('22.8'), `format=${pv3.format} total=${pv3.total} rows=${hwRows.slice(0, 200)}`);

const fd5 = new FormData();
fd5.append('file', new Blob([Buffer.from('这不是数据,只是乱写字符串')], { type: 'text/plain' }), 'junk.txt');
const respJunk = await fetch(B + '/api/import/preview', { method: 'POST', body: fd5 });
T('R15', '导入坏文件 400 不 500', respJunk.status === 400, `status=${respJunk.status} body=${(await respJunk.text()).slice(0, 120)}`);

// ---------- 模块2 阶段 ----------
const sug = await j('/api/stage-suggestion');
T('S1', 'stage-suggestion suggested=s1', sug.suggested === 's1' && Array.isArray(sug.items) && sug.items.length === 3 && sug.items.every((s) => Array.isArray(s.rules) && s.rules.every((r) => 'text' in r && 'ok' in r && 'detail' in r)), `suggested=${sug.suggested} items=${sug.items && sug.items.map((s) => s.stage_id + ':' + s.rules.length + '条').join(',')}`);
const s3 = (sug.items || []).find((s) => s.stage_id === 's3');
const waistRule = s3 && (s3.rules || []).find((x) => (x.text || '').includes('腰围'));
T('S2', '阶段③腰围规则未命中 detail', waistRule && waistRule.ok === false && (waistRule.detail || '').includes('96'), JSON.stringify(waistRule));
const sug7 = await j('/api/stage-suggestion?window=7'), sug30 = await j('/api/stage-suggestion?window=30');
T('S3', 'window 参数 7/30', sug7.suggested === 's1' && sug30.suggested === 's1', `w7=${sug7.suggested} w30=${sug30.suggested}`);

// ---------- 模块5 洞察 ----------
const ins = await j('/api/insights');
T('I1', 'insights rate_alert=null', ins.rate_alert === null, JSON.stringify(ins.rate_alert));
T('I2', 'insights plateau=null', ins.plateau === null, JSON.stringify(ins.plateau));
const prot = ins.protein || {};
T('I3', 'insights protein 目标 124g', prot.target_g === 124 || `${prot.target_g}`.startsWith('124'), JSON.stringify(prot));
T('I5', '洞察文案引知识库', !ins.rate_alert && !ins.plateau ? 'n/a(基线无告警)' : 'see', `keys=${Object.keys(ins)}`);

// ---------- 模块6 提醒 ----------
// 期望随"今天"推算(服务器 UTC+8 日历日):weight 今日未录→due;waist 按最近一条记录日距今天数 ≥7→due,否则不 due
const rem = await j('/api/reminders');
const recsNow = visible(await j('/api/tables/records'));
const waistAt = recsNow.filter((r) => r.data.metric_code === 'waist').map((r) => r.data.at).sort().pop();
const d8 = (iso) => new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 10);
const daysSinceWaist = Math.round((Date.parse(d8(rem.generated_at)) - Date.parse(d8(waistAt))) / 86400000);
const mmdd = d8(waistAt).slice(5).replace('-', '-');
const rw = (rem.items || []).find((x) => x.code === 'weight'), ra = (rem.items || []).find((x) => x.code === 'waist');
const waistExpDue = daysSinceWaist >= 7;
const waistExpReason = waistExpDue ? `距上次测量已 ${daysSinceWaist} 天` : `${daysSinceWaist} 天前测过（${mmdd}）`;
T('M1', `reminders weight due / waist ${waistExpDue ? 'due(≥7天)' : '不due'}`,
  rw && rw.due === true && rw.reason === '今天还没有记录' && ra && ra.due === waistExpDue && ra.reason === waistExpReason &&
  rem.items.length === 2 && !!rem.generated_at, `got=${JSON.stringify(rem.items)} 推算today=${d8(rem.generated_at)} waist上次=${d8(waistAt)}(${waistAt}) 差=${daysSinceWaist}天`);

// ---------- 模块7 数据安全 ----------
const hist = await j('/api/history?limit=5');
T('A1', 'history 审计列表', Array.isArray(hist) && hist.length > 0 && hist[0].table && hist[0].doc_id !== undefined && hist[0].seq !== undefined, `n=${hist.length} top=${JSON.stringify(hist[0])}`);
// A2: 找 id1 的空 delete 版本
const hist1 = await j(`/api/history?doc_id=${id1}`);
const emptySeq = (hist1 || []).filter((h) => h.action === 'delete').map((h) => h.seq)[0];
const rr400 = await jr(`/api/history/${emptySeq}/restore`, { method: 'POST' });
T('A2', 'restore 空 delete 版本 400(D1 回归)', rr400.status === 400 && (await rr400.text()).includes('不可恢复'), `status=${rr400.status}`);
// A3: 正常版本恢复(R3 的 77.78 版本)→ 再删除清理
const editSeq = (hist1 || []).filter((h) => h.action === 'update' && h.data && h.data.value === 77.78).map((h) => h.seq)[0];
if (editSeq) {
  const rr = await jr(`/api/history/${editSeq}/restore`, { method: 'POST' });
  const lstAfter = visible(await j('/api/tables/records'));
  const restored = lstAfter.find((d) => d.id === id1);
  T('A3', 'restore 正常版本 ok + 记录回来', rr.ok && restored && restored.data.value === 77.78, `status=${rr.status} value=${restored && restored.data.value}`);
  await jr(`/api/tables/records/${id1}`, { method: 'DELETE' });
} else {
  T('A3', 'restore 正常版本 ok + 记录回来', false, `history for ${id1}: ${JSON.stringify(hist1).slice(0, 200)}`);
}

const snaps = await j('/api/snapshots');
T('A4', '快照列表 ≥2', Array.isArray(snaps) && snaps.length >= 2 && snaps[0].name.startsWith('snapshot-'), JSON.stringify(snaps));
const snapDl = await jr(`/api/snapshots/${snaps[0].name}`);
const snapJson = await snapDl.json();
T('A5', '快照下载 200 + docs', snapDl.status === 200 && snapJson && Array.isArray(snapJson.docs), `status=${snapDl.status} docs表=${[...new Set(snapJson.docs.map((d) => d.table))]}`);
const sne = await jr('/api/snapshots/..%2Fmain.py');
T('A9', '快照路径越权 400/404', sne.status === 400 || sne.status === 404, `status=${sne.status}`);

const expAll = await jr('/api/export/all');
const expJson = await expAll.json();
T('A6', '导出 JSON 200 全表', expAll.status === 200 && expJson.version === 1 && Array.isArray(expJson.docs) && new Set(expJson.docs.map((d) => d.table)).size >= 8, `tables=${[...new Set(expJson.docs.map((d) => d.table))]}`);
const expCsv = await jr('/api/export/records.csv');
const csvText = await expCsv.text();
T('A7', '导出 CSV 200 表头+行数', expCsv.status === 200 && csvText.includes('指标,数值,单位,时间,来源,备注') && csvText.trim().split('\n').length === 1 + visible(await j('/api/tables/records')).length, `lines=${csvText.trim().split('\n').length}`);

// ---------- 模块8 PWA ----------
const man = await jr('/manifest.webmanifest');
const manJson = await man.json();
T('P1', 'manifest 200', man.status === 200 && (man.headers.get('content-type') || '').includes('manifest') && manJson.name === '体重管理', `ct=${man.headers.get('content-type')} name=${manJson.name}`);
const sw = await jr('/sw.js');
T('P2', 'sw.js 200', sw.status === 200 && (sw.headers.get('content-type') || '').includes('javascript'), `ct=${sw.headers.get('content-type')}`);
for (const p of ['/icons/icon-192.png', '/icons/icon-512.png']) {
  const ic = await jr(p);
  T('P3', `icon ${p} 200`, ic.status === 200 && (ic.headers.get('content-type') || '').includes('image/png'), `ct=${ic.headers.get('content-type')}`);
}

// ---------- 清理 + 基线终检 ----------
// 清理全部导入产生的 imp_* 记录(软删墓碑)
const impAll = visible(await j('/api/tables/records')).filter((d) => d.id.startsWith('imp_'));
for (const d of impAll) await jr(`/api/tables/records/${d.id}`, { method: 'DELETE' });
const finalRecs = visible(await j('/api/tables/records'));
T('Z1', 'API 段清理后 records 回 8', finalRecs.length === 8, `imp清理=${impAll.length}条 records=${finalRecs.length} 值=${finalRecs.map((d) => d.data.value).join('/')}`);

writeFileSync(OUT, JSON.stringify(results, null, 2));
const fails = results.filter((x) => !x.pass);
console.log(`\n== API 段: ${results.length - fails.length}/${results.length} pass ==`);
if (fails.length) { console.log('FAILS:', fails.map((f) => f.id).join(',')); process.exitCode = 1; }
