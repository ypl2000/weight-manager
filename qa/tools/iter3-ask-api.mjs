// 迭代3-2:POST /api/coach/ask SSE 验证
// 知识库内问题(引用知识库+用户数据) / 知识库外问题(标注"知识库之外的补充") /
// 空与非法入参(error 事件且零模型调用) / coach_qa 存档 / 测后清理
const B = 'http://127.0.0.1:8000';

async function qaList() {
  return (await (await fetch(B + '/api/tables/coach_qa')).json()).filter((d) => !d.deleted);
}
async function delQa(id) {
  const r = await fetch(`${B}/api/tables/coach_qa/${id}`, { method: 'DELETE' });
  return r.status;
}
// 读完整 SSE 流,解析事件
async function sse(body, raw = false) {
  const t0 = Date.now();
  const r = await fetch(B + '/api/coach/ask', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: raw ? body : JSON.stringify(body),
  });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
  }
  const events = [];
  for (const chunk of text.split('\n\n')) {
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data:')) continue;
      try { events.push(JSON.parse(line.slice(5).trim())); } catch {}
    }
  }
  return { status: r.status, ctype: r.headers.get('content-type'), totalMs: Date.now() - t0, events };
}
const answer = (evs) => evs.filter((e) => 'delta' in e).map((e) => e.delta).join('');
const fmt = (x) => JSON.stringify(x, null, 1);

const before = await qaList();
const baseQa = before.length;
console.log('QA_BEFORE visible=' + baseQa, 'ids=' + before.map((d) => d.id).join(','));

const out = {};

// ---- 1) 错误路径:空/非法入参 → error 事件、零模型调用(响应秒回、无 delta/done、不留档) ----
out.errors = {};
const cases = [
  ['no-body', null, true],
  ['bad-json', 'not-json{{', true],
  ['question-number', { question: 123 }],
  ['question-empty', { question: '   ' }],
  ['question-over-500', { question: '问'.repeat(501) }],
];
for (const [name, body, raw] of cases) {
  const r = await sse(body, raw);
  out.errors[name] = {
    status: r.status, totalMs: r.totalMs, eventCount: r.events.length,
    error: r.events[0]?.error || null,
    hasDelta: r.events.some((e) => 'delta' in e),
    hasDone: r.events.some((e) => e.done),
    zeroModelCall: r.totalMs < 3000 && r.events.length === 1 && 'error' in (r.events[0] || {}),
  };
}
const qaAfterErrors = await qaList();
out.errorsNoArchive = qaAfterErrors.length === baseQa;

// ---- 2) 知识库内问题:减脂期蛋白质 ----
const q1 = await sse({ question: '减脂期蛋白质吃多少' });
const a1 = answer(q1.events);
const done1 = q1.events.find((e) => e.done);
out.kbIn = {
  status: q1.status, ctype: q1.ctype, totalMs: q1.totalMs,
  deltaEvents: q1.events.filter((e) => 'delta' in e).length,
  answerLen: a1.length, done: done1 || null, errorEv: q1.events.find((e) => e.error) || null,
  answerHead: a1.slice(0, 160),
  citesKB: a1.includes('知识库') && !a1.includes('知识库之外的补充'),
  mentionsRange: a1.includes('1.2') && a1.includes('1.6'),
  mentionsUserData: a1.includes('88') || a1.includes('124'),
};
const list1 = await qaList();
const arch1 = done1 && list1.find((d) => d.id === done1.qa_id);
out.kbInArchive = arch1 && {
  found: !!arch1, device: arch1.device, model: arch1.data.model,
  question: arch1.data.question, answerLen: (arch1.data.answer || '').length,
  answerMatchesStream: arch1.data.answer === a1,
};

// ---- 3) 知识库外问题:熬夜对减脂的影响 ----
const q2 = await sse({ question: '熬夜对减脂的影响' });
const a2 = answer(q2.events);
const done2 = q2.events.find((e) => e.done);
out.kbOut = {
  status: q2.status, totalMs: q2.totalMs,
  deltaEvents: q2.events.filter((e) => 'delta' in e).length,
  answerLen: a2.length, done: done2 || null, errorEv: q2.events.find((e) => e.error) || null,
  answerHead: a2.slice(0, 160),
  markedSupplement: a2.includes('知识库之外的补充'),
  citesKB: a2.includes('知识库'),
};

// ---- 4) 清理:删除本轮两条问答,回到基线 1 条 ----
let delStatuses = [];
if (arch1) delStatuses.push(await delQa(arch1.id));
if (done2) delStatuses.push(await delQa(done2.qa_id));
const after = await qaList();
out.cleanup = {
  delStatuses, visibleAfter: after.length,
  onlyBaselineLeft: after.length === baseQa && after.every((d) => d.id === 'a0170c32-adae-4483-980b-6031c4050ed8'),
};

console.log('ERROR_PATHS ' + fmt(out.errors));
console.log('ERRORS_NO_ARCHIVE ' + out.errorsNoArchive);
console.log('KB_IN ' + fmt({ checks: { status200: out.kbIn.status === 200, sse: (out.kbIn.ctype || '').includes('event-stream'), streamed: out.kbIn.deltaEvents > 1, citesKB: out.kbIn.citesKB, mentionsRange: out.kbIn.mentionsRange, mentionsUserData: out.kbIn.mentionsUserData, doneWithQaId: !!(out.kbIn.done && out.kbIn.done.qa_id), noError: !out.kbIn.errorEv }, timing: { totalMs: out.kbIn.totalMs, deltas: out.kbIn.deltaEvents, answerLen: out.kbIn.answerLen }, head: out.kbIn.answerHead }));
console.log('KB_IN_ARCHIVE ' + fmt(out.kbInArchive));
console.log('KB_OUT ' + fmt({ checks: { status200: out.kbOut.status === 200, streamed: out.kbOut.deltaEvents > 1, markedSupplement: out.kbOut.markedSupplement, doneWithQaId: !!(out.kbOut.done && out.kbOut.done.qa_id), noError: !out.kbOut.errorEv }, timing: { totalMs: out.kbOut.totalMs, deltas: out.kbOut.deltaEvents, answerLen: out.kbOut.answerLen }, head: out.kbOut.answerHead }));
console.log('CLEANUP ' + fmt(out.cleanup));
process.exit(0);
