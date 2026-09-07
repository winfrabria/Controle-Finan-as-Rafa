// Explicit opt-in: this exercises real storage, database and paid AI via localhost.
// Download public educational examples into tmp/public-invoice-smoke first.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (!process.argv.includes('--online')) throw new Error('Use --online to authorize real test uploads.');
const base = new URL(process.env.SMOKE_BASE_URL || 'http://localhost:3000');
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(base.hostname)) {
  throw new Error('This smoke test only permits a local application.');
}
const dir = resolve('tmp/public-invoice-smoke');
const source = 'https://ifbaiano.edu.br/portal/extensao/wp-content/uploads/sites/4/2019/09/guia-materiais-proex-2019.pdf';
const samples = [
  { file: 'egestor-nfce.pdf', mime: 'application/pdf', source: 'https://blog.egestor.com.br/wp-content/uploads/Exemplo-Nota-Fiscal-do-Consumidor-Eletronica-NFC-e.pdf' },
  { file: 'ifbaiano-fiscais.png', mime: 'image/png', source, sourcePage: 10 },
  { file: 'ifbaiano-nao-fiscais.jpg', mime: 'image/jpeg', source, sourcePage: 11 },
];
if (process.argv.includes('--extended')) {
  samples[2] = { file: 'ifbaiano-exemplos.pdf', mime: 'application/pdf', source };
}
const results = [];
let saving = Promise.resolve();
const save = () => (saving = saving.then(() => writeFile(resolve(dir, 'http-results.json'), JSON.stringify(results, null, 2))));
const works = await fetch(new URL('/api/obras', base)).then(r => r.json());
const work = works.obras?.find(w => w.nome.startsWith('[DEMO]'));
assert.ok(work, 'Use an existing DEMO work; never select a real project implicitly.');

for (const negative of ['missing-work', 'empty-file', 'unsupported-file']) {
  const form = new FormData();
  if (negative !== 'missing-work') form.set('obraId', work.id);
  form.set('arquivo', new Blob(negative === 'empty-file' ? [] : ['not an invoice'],
    { type: negative === 'unsupported-file' ? 'text/plain' : 'application/pdf' }),
    negative === 'unsupported-file' ? 'qa.txt' : 'qa.pdf');
  const response = await fetch(new URL('/api/notas', base), { method: 'POST', body: form });
  const body = await response.json();
  assert.ok(response.status >= 400 && response.status < 500, `${negative} should reject before processing`);
  console.log(JSON.stringify({ test: negative, http: response.status, code: body.erro?.codigo }));
}

const settled = await Promise.allSettled(samples.map(async sample => {
  const bytes = await readFile(resolve(dir, sample.file));
  const form = new FormData();
  form.set('obraId', work.id);
  form.set('arquivo', new Blob([bytes], { type: sample.mime }), `QA-PUBLICO-${sample.file}`);
  const started = Date.now();
  const response = await fetch(new URL('/api/notas', base), { method: 'POST', body: form });
  const body = await response.json();
  if (response.status !== 201) {
    const failed = { ...sample, terminal: 'UPLOAD_FAILED', http: response.status, code: body.erro?.codigo, totalMs: Date.now() - started };
    results.push(failed);
    console.log(JSON.stringify(failed));
    await save();
    return;
  }
  // Capabilities remain in memory only: never logged or persisted.
  const cookie = response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'Public status capability was not issued');
  const result = { ...sample, sha256: createHash('sha256').update(bytes).digest('hex'),
    noteId: body.nota.id, uploadMs: Date.now() - started, timeline: [] };
  results.push(result);
  await save();
  console.log(JSON.stringify({ uploaded: sample.file, noteId: result.noteId, uploadMs: result.uploadMs }));
  let previous;
  while (Date.now() - started < 360_000) {
    const statusResponse = await fetch(new URL(`/api/notas/${result.noteId}/status`, base), { headers: { cookie } });
    const status = await statusResponse.json();
    assert.equal(statusResponse.status, 200, `Status unavailable for ${result.noteId}`);
    const state = `${status.nota.estadoPublico}:${status.nota.etapa}`;
    if (state !== previous) {
      result.timeline.push({ state, ms: Date.now() - started });
      console.log(JSON.stringify({ file: sample.file, state, ms: Date.now() - started }));
      previous = state;
      await save();
    }
    if (['COMPLETED', 'NEEDS_CONTEXT', 'FAILED', 'READ_FAILED'].includes(status.nota.estadoPublico)) {
      result.terminal = status.nota.estadoPublico;
      result.totalMs = Date.now() - started;
      result.publicError = status.nota.erro?.codigo;
      await save();
      return;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  result.terminal = 'SMOKE_TIMEOUT';
  await save();
}));
console.log(JSON.stringify(results, null, 2));
for (const outcome of settled) if (outcome.status === 'rejected') console.error(outcome.reason instanceof Error ? outcome.reason.message : 'Smoke check failed');
if (settled.some(r => r.status === 'rejected') || results.some(r => !['COMPLETED', 'NEEDS_CONTEXT'].includes(r.terminal))) process.exitCode = 1;
