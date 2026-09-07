// Ground truth for public educational samples only; never used by audit rules.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = async name => JSON.parse(await readFile(`tmp/public-invoice-smoke/${name}`, 'utf8'));
const http = await read('http-results.json');
const db = await read('db-results.json');
const locate = (file, transport = http, records = db) => {
  const upload = transport.find(r => r.file === file);
  assert.equal(upload?.terminal, 'COMPLETED', `${file}: complete the real HTTP flow`);
  const note = records.find(r => r.id === upload.noteId);
  assert.ok(note?.extractedData, `${file}: extraction persisted`);
  assert.equal(note.failureCode, null);
  assert.ok(note.processingJobs.every(j => j.status === 'SUCCEEDED'));
  return note;
};
const fiscal = locate('egestor-nfce.pdf');
assert.equal(fiscal.extractedData.totalAmount, '15.00');
assert.equal(fiscal.extractedData.issuedAt, '2001-01-01');
assert.equal(fiscal.extractedData.items.length, 1);
assert.equal(Number(fiscal.extractedData.items[0].quantity), 1);
assert.equal(Number(fiscal.extractedData.items[0].unitPrice), 15);
assert.ok(fiscal.findings.every(f => ['INVALID_CNPJ', 'POSSIBLE_DUPLICATE'].includes(f.code)),
  'No unverified monetary finding may be published after verifier timeout');
assert.equal(fiscal.aiRuns.find(r => r.kind === 'EXTRACTION').diagnostics.attemptTrace.length, 1,
  'A simple invoice with one documentGroup must not pay a second extraction');

const composite = locate('ifbaiano-fiscais.png');
assert.equal(composite.extractedData.documentKind, 'COMPOSITE');
assert.deepEqual(composite.extractedData.items.map(i => Number(i.totalAmount)).sort((a,b) => a-b), [50,100,180]);
assert.deepEqual(composite.extractedData.items.map(i => Number(i.unitPrice)).sort((a,b) => a-b), [10,45,100]);
assert.equal(composite.findings.length, 0, 'Do not publish hallucinated image arithmetic');
assert.ok(composite.aiRuns.some(r => r.kind === 'VERIFICATION' && r.status === 'SUCCEEDED'));

const guide = locate('ifbaiano-exemplos.pdf');
assert.equal(guide.extractedData.documentKind, 'OTHER');
assert.equal(guide.extractedData.totalAmount, null, 'Do not invent a total for an educational guide');
assert.equal(guide.findings.length, 0);
assert.ok(guide.aiRuns.some(r => r.kind === 'VERIFICATION' && r.status === 'SUCCEEDED'));

const oldHttp = await read('http-results-first-success.json');
const oldDb = await read('db-results-first-success.json');
const jpg = locate('ifbaiano-nao-fiscais.jpg', oldHttp, oldDb);
assert.equal(jpg.extractedData.totalAmount, '984.43');
assert.equal(jpg.extractedData.issuedAt, '2014-06-19');
assert.equal(jpg.extractedData.items.length, 6);
assert.equal(jpg.findings.length, 0);
console.log('4 fontes/formatos conferidos: PDF simples, PNG composto, JPG com 6 itens e guia PDF de 12 páginas. Campos e decisões de segurança conferidos.');
