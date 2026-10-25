// z1/z2 收尾审计: 当前全量 pull 与基线快照逐文档比对
import { apiGet, apiSync } from './cdp.mjs';
import { readFileSync } from 'node:fs';

const baseline = JSON.parse(
  readFileSync('C:/Users/11645/Desktop/体重管理/qa/reports/baseline-sync-pull.json', 'utf8'),
);
const pull = await apiSync({ device: 'qa-final-audit', cursor: 0, changes: [] });
const now = new Map(pull.changes.map((d) => [`${d.table}/${d.id}`, d]));

const diffs = [];
// 1) 基线里的每个文档，可见性必须一致
for (const b of baseline.changes) {
  const key = `${b.table}/${b.id}`;
  const cur = now.get(key);
  if (!cur) diffs.push({ key, issue: 'missing-now', baselineDeleted: b.deleted });
  else if (cur.deleted !== b.deleted) diffs.push({ key, issue: 'visibility-changed', baselineDeleted: b.deleted, nowDeleted: cur.deleted });
}
// 2) 新增文档必须全部是墓碑
const newDocs = [];
for (const c of pull.changes) {
  const key = `${c.table}/${c.id}`;
  if (!baseline.changes.some((b) => `${b.table}/${b.id}` === key)) {
    newDocs.push({ key, deleted: c.deleted, updated_at: c.updated_at });
    if (!c.deleted) diffs.push({ key, issue: 'new-doc-visible' });
  }
}

// 3) 可见数据内容核对
const recs = (await apiGet('records')).map((d) => `${d.data.metric_code}:${d.data.value}${d.data.unit || ''}`).sort();
const wks = (await apiGet('workouts')).map((d) => JSON.stringify(d.data));
const logs = (await apiGet('habit_logs')).filter((d) => !d.deleted).map((d) => `${d.id}:done=${d.data.done}`).sort();
const profile = (await apiGet('profile')).find((d) => d.id === 'me');
const stageHist = await apiGet('stage_history');

console.log(JSON.stringify({
  z1: {
    recordsVisible: recs,
    workoutsVisible: wks,
    habitLogsVisible: logs,
    profile: { current_stage_id: profile && profile.data.current_stage_id },
    stageHistoryCount: (stageHist || []).length,
  },
  z2: {
    baselineDocCount: baseline.changes.length,
    nowDocCount: pull.changes.length,
    newDocsSinceBaseline: newDocs,
    visibilityDiffs: diffs,
    probeDocStillThere: pull.changes.some((d) => d.table === 'probe' && d.id === 'x'),
  },
}, null, 2));
process.exit(0);
