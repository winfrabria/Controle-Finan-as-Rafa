/* eslint-disable @typescript-eslint/no-require-imports -- Module cache stubs isolate the real orchestrator from network and database. */
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { evaluateHarness } = require('../../src/lib/audit-harness/engine.ts');
const { selectVerification } = require('../../src/lib/audit-harness/verification.ts');
const { invoiceExtractionSchema } = require('../../src/lib/integrations/openrouter/extraction-contract.ts');

// Permanent regression suite: real rule/orchestrator code, in-memory persistence,
// no credentials, no real attachments, no provider or database connection.
global.fetch = async () => { throw new Error('NETWORK_FORBIDDEN_IN_OFFLINE_QA'); };
process.env.HARNESS_VERIFIER_MODE = 'enforce';
process.env.HARNESS_VERIFIER_GATE_APPROVED = 'true';
process.env.HARNESS_WORK_RULES_ENABLED = 'false';

function invoice(overrides = {}) {
  return {
    documentKind: 'FISCAL_INVOICE', documentNumber: 'SYNTHETIC-QA',
    supplierName: 'Fornecedor sintetico', supplierTaxId: null, issuedAt: null,
    totalAmount: '60000.00', readConfidence: 0.99, warnings: [],
    markdown: 'Documento sintetico legivel com um item e total integralmente extraidos.',
    itemCoverage: {status:'COMPLETE',declaredItemCount:1,extractedItemCount:1,firstLineNumber:1,lastLineNumber:1,missingLineNumbers:[],evidence:'Tabela completa'},
    items: [{lineNumber:1,description:'Material de teste',documentGroup:'qa',documentRole:'LINE_ITEM',countsTowardDocumentTotal:true,quantity:'1',unitPrice:'60000.00',totalAmount:'60000.00'}],
    ...overrides,
  };
}

function composite(status) {
  return invoice({documentKind:'COMPOSITE',totalAmount:'20.00',
    itemCoverage:{status:'COMPLETE',declaredItemCount:1,extractedItemCount:1,firstLineNumber:2,lastLineNumber:2,missingLineNumbers:[],evidence:'Linha do documento presente completa'},
    supportCoverage:{status,referencedDocuments:[],presentDocuments:['A'],missingDocuments:[],basis:'NONE',evidence:null},
    items:[
      {lineNumber:1,description:'Cobranca agregada',documentGroup:'qa',documentRole:'AGGREGATE_PAYMENT',countsTowardDocumentTotal:false,quantity:null,unitPrice:null,totalAmount:'100.00'},
      {lineNumber:2,description:'Documento de suporte',documentGroup:'qa',documentRole:'SUPPORTING_DOCUMENT',countsTowardDocumentTotal:true,quantity:'1',unitPrice:'20.00',totalAmount:'20.00'},
    ],
  });
}

for (const status of ['UNKNOWN', 'PARTIAL']) {
  test(`cobertura ${status} sem lista de ausentes nao deve concluir OK`, () => {
    const doc = invoiceExtractionSchema.parse(composite(status));
    const result = evaluateHarness({invoice:doc});
    const selection = selectVerification({invoice:doc,aiCoverage:true,baseClassification:result.classification,baseFindings:result.findings,pageCount:8});
    console.log(JSON.stringify({scenario:`coverage-${status}`,classification:result.classification,selection}));
    assert.notEqual(result.classification,'OK');
  });
}

test('data impossivel do OCR nao deve ser aceita como evidencia factual', () => {
  const doc=invoice({documentKind:'REIMBURSEMENT',totalAmount:'20.00'});
  doc.items=[{...doc.items[0],unitPrice:'20.00',totalAmount:'20.00',evidenceObservations:[
    {kind:'SHEET',documentGroup:'qa',label:'Ficha',amount:'20.00',date:'2026-02-31',page:1,text:'Ficha com data extraida 31/02/2026'},
    {kind:'PAYMENT',documentGroup:'qa',label:'Pagamento',amount:'20.00',date:'2026-03-03',page:2,text:'Pagamento em 03/03/2026'},
  ]}];
  const parsed=invoiceExtractionSchema.safeParse(doc);
  const result=parsed.success?evaluateHarness({invoice:parsed.data}):null;
  console.log(JSON.stringify({scenario:'impossible-date',schemaAccepted:parsed.success,classification:result?.classification,findings:result?.findings.map(f=>f.code)}));
  assert.equal(parsed.success,false);
});

let currentNote, persisted, runMetadata, verificationCalls, verifierBehavior, paidAuditCalls;
const db={
  note:{findUnique:async()=>currentNote,findMany:async()=>[],updateMany:async({data})=>{persisted={...persisted,...data};return {count:1};},findUniqueOrThrow:async()=>({id:currentNote.id,...persisted})},
  noteContextQuestion:{findFirst:async()=>null,createMany:async()=>({count:0})},
  auditRule:{findMany:async()=>[]},
  aiRun:{upsert:async()=>({id:'qa-audit'}),update:async({data})=>{runMetadata=data.structuredResponse;return {id:'qa-audit'};}},
  noteItem:{findMany:async()=>[{id:'qa-item',lineNumber:1}]},
  finding:{updateMany:async()=>({count:0}),createMany:async()=>({count:1})},
  noteRead:{deleteMany:async()=>({count:0})},
  profile:{findMany:async()=>[]},
  noteEvent:{create:async()=>({id:'qa-event'})},
};
db.$transaction=async(callback)=>callback(db);
function stub(relative,exports) {
  const id=path.resolve(__dirname,'../..',relative);
  require.cache[id]={id,filename:id,loaded:true,exports};
}
stub('src/server/db/prisma.ts',{prisma:db});
stub('src/server/notes/run-selective-verification.ts',{runSelectiveVerification:async()=>{
  verificationCalls++;
  if(['PASS','LIMITED','INCOMPLETE'].includes(verifierBehavior)) return {
    coverage:{complete:verifierBehavior!=='INCOMPLETE'},
    data:{status:verifierBehavior==='LIMITED'?'LIMITED':'PASS',findings:[]},
    reused:false,runId:'qa-verifier',
  };
  const e=new Error(verifierBehavior);e.code=verifierBehavior;throw e;
}});
stub('src/server/push/delivery-service.ts',{createNotificationWithPushDeliveries:async()=>{},dispatchPendingPushDeliveries:async()=>{}});
const {processNoteAudit}=require('../../src/server/notes/process-note-audit.ts');

async function runAudit(doc,behavior,noteOverrides={}) {
  persisted={};runMetadata=null;verificationCalls=0;verifierBehavior=behavior;paidAuditCalls=0;
  currentNote={id:'qa-note',contextRound:0,documentNumber:'SYNTHETIC-QA',extractedData:doc,issuedAt:null,originalFileName:'synthetic.pdf',originalFilePath:'qa/synthetic.pdf',originalFileSha256:'a'.repeat(64),originalMimeType:'application/pdf',originalPageCount:1,processingStage:'ANALYZING',supplierTaxId:null,totalAmount:doc.totalAmount,version:1,workId:'qa-work',aiRuns:[{attempts:1}]};
  Object.assign(currentNote,noteOverrides);
  const result=await processNoteAudit('qa-note',{client:{discover:async()=>{paidAuditCalls++;return {data:{findings:[],needsContext:false,contextQuestions:[],coverage:{sufficientEvidence:true,checkedAreas:['amounts'],limitations:[]},summary:'Sintetico sem achados de IA'},attempts:1,latencyMs:1,model:'synthetic',provider:'in-memory'};}}});
  console.log(JSON.stringify({scenario:behavior,auditResult:result.auditResult,verificationCalls,verification:runMetadata?.verification,assurance:persisted.assuranceBand}));
  return result;
}

for(const failure of ['VERIFICATION_TIMEOUT','VERIFICATION_TRACE_INVALID','LIMITED','INCOMPLETE']) {
  test(`verificador obrigatorio falhou (${failure}): deve concluir informacao insuficiente`,async()=>{
    const result=await runAudit(invoice(),failure);
    assert.equal(verificationCalls,1);
    assert.equal(runMetadata.auditResult,'INFORMATION_INSUFFICIENT');
    assert.equal(result.classification,'NO_PARAMETER');
    assert.equal(result.processingStage,'COMPLETED');
    assert.equal(result.auditResult,'NEEDS_CONTEXT');
  });
}

test('controle: verificacao completa de documento consistente permite OK',async()=>{
  const result=await runAudit(invoice(),'PASS');
  assert.equal(result.auditResult,'OK');
});

test('controle: falha do verificador preserva divergencia deterministica comprovada',async()=>{
  const result=await runAudit(invoice({totalAmount:'61000.00'}),'VERIFICATION_TIMEOUT');
  assert.equal(result.auditResult,'SUSPICIOUS');
});

for(const mode of ['off','shadow']) {
  test(`controle: trava de verificador obrigatorio nao altera o modo ${mode}`,async()=>{
    process.env.HARNESS_VERIFIER_MODE=mode;
    try {
      const result=await runAudit(invoice(),'VERIFICATION_TIMEOUT');
      assert.equal(result.auditResult,'OK');
      assert.equal(verificationCalls,mode==='off'?0:1);
    } finally {
      process.env.HARNESS_VERIFIER_MODE='enforce';
    }
  });
}

test('reanalisar data legada impossivel conclui sem falha tecnica e sem divergencia inventada',async()=>{
  const doc=invoice({issuedAt:'2026-02-31'});
  const result=await runAudit(doc,'PASS');
  assert.equal(runMetadata.auditResult,'INFORMATION_INSUFFICIENT');
  assert.equal(result.classification,'NO_PARAMETER');
  assert.equal(result.processingStage,'COMPLETED');
  assert.equal(doc.issuedAt,'2026-02-31');
});

test('cobertura declarada completa sem inventário multipágina não compra auditoria nem verificação',async()=>{
  const result=await runAudit(invoice(),'PASS',{originalPageCount:9});
  assert.equal(paidAuditCalls,0);assert.equal(verificationCalls,0);
  assert.equal(result.processingStage,'COMPLETED');assert.equal(result.classification,'NO_PARAMETER');
  assert.equal(runMetadata.executionMode,'DETERMINISTIC_ONLY');
  assert.deepEqual(runMetadata.skippedPaidStages,['AUDIT','VERIFICATION']);
  assert.equal(persisted.assuranceBand,'LIMITED');
});

test('recuperação parcial preservada conclui sem total inventado ou novos gastos',async()=>{
  const doc=invoice();doc.itemCoverage.status='UNKNOWN';doc.totalAmount='61000.00';
  const result=await runAudit(doc,'PASS',{aiRuns:[{attempts:2,structuredResponse:{qualityLimitation:{diagnostic:'pdf-recovery-incomplete'}}}]});
  assert.equal(paidAuditCalls,0);assert.equal(verificationCalls,0);
  assert.equal(result.processingStage,'COMPLETED');
  assert.equal(runMetadata.findingCodes.includes('TOTAL_MISMATCH'),false);
  assert.equal(runMetadata.auditResult,'INFORMATION_INSUFFICIENT');
});

test('limitação de extração não apaga achado determinístico sustentado',async()=>{
  const result=await runAudit(invoice({totalAmount:'61000.00'}),'PASS',{originalPageCount:3});
  assert.equal(result.auditResult,'SUSPICIOUS');assert.equal(paidAuditCalls,0);assert.equal(verificationCalls,0);
  assert.equal(persisted.assuranceBand,'LIMITED');
});

test('inventário fiscal completo mantém o fluxo normal de auditoria',async()=>{
  const doc=invoice();doc.items[0].sourcePage=1;
  doc.pageCoverage=[1,2].map(page=>({page,complete:true,sources:[],fieldsReviewed:true,requirementScope:'NONE',requirementEvidence:null}));
  const result=await runAudit(doc,'PASS',{originalPageCount:2});
  assert.equal(paidAuditCalls,1);assert.equal(verificationCalls,1);assert.equal(result.auditResult,'OK');
  assert.equal(runMetadata.executionMode,'AI_AUDIT');
});
