/* eslint-disable @typescript-eslint/no-require-imports -- Isolate storage and database; execute real jobs, extraction, configuration and HTTP client. */
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const notes = new Map(), jobs = new Map(), runs = new Map(), items = new Map();
let calls = [], runFailure = false, persistFailure = false, providerStatus = 200, rejectFirst = false;
const extraction = {
  documentKind:'FISCAL_INVOICE',documentNumber:'PUBLIC-SYNTHETIC',supplierName:'Empresa de teste',supplierTaxId:null,
  issuedAt:'2026-01-15',totalAmount:'15.00',currency:'BRL',readConfidence:0.99,warnings:[],markdown:'Nota sintética legível com tabela completa: um produto, total 15,00.',
  itemCoverage:{status:'COMPLETE',declaredItemCount:1,extractedItemCount:1,firstLineNumber:1,lastLineNumber:1,missingLineNumbers:[],evidence:'Tabela completa'},
  items:[{lineNumber:1,description:'Produto de teste',countsTowardDocumentTotal:true,documentRole:'LINE_ITEM',quantity:'2',unitPrice:'7.50',totalAmount:'15.00',arithmeticVerified:true}],
};
function matches(row, where) {
  return Object.entries(where ?? {}).every(([key,value]) => {
    if (value && typeof value==='object' && !Array.isArray(value)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return row[key]!==value.not;
    }
    return row[key]===value;
  });
}
function table(map) {
  return {
    findUnique:async({where})=>map.get(where.id) ? {...map.get(where.id)} : null,
    findUniqueOrThrow:async({where})=>({...map.get(where.id)}),
    findFirst:async({where,orderBy})=>(orderBy?.createdAt === 'desc' ? [...map.values()].reverse() : [...map.values()]).find(row=>matches(row,where)) ?? null,
    updateMany:async({where,data})=>{
      let count=0;
      for (const row of map.values()) if (matches(row,where)) {
        for (const [key,value] of Object.entries(data)) row[key]=value && typeof value==='object' && 'increment' in value ? (row[key]??0)+value.increment : value;
        count++;
      }
      return {count};
    },
    update:async({where,data})=>{Object.assign(map.get(where.id),data);return {...map.get(where.id)};},
  };
}
const db={note:table(notes),processingJob:table(jobs),noteEvent:{create:async()=>({id:'event'})},
  aiRun:{...table(runs),create:async({data})=>{if(runFailure) throw new Error('Synthetic persistence failure');const id=`run-${runs.size}`;runs.set(id,{id,...data});return {id};}},
  noteItem:{deleteMany:async({where})=>{items.delete(where.noteId);return {count:0};},createMany:async({data})=>{
    if(persistFailure) {const error=new Error('Synthetic failure postgresql://secret.invalid');error.code='P2028';throw error;}
    for(const item of data) items.set(item.noteId,[...(items.get(item.noteId)??[]),item]);return {count:data.length};}},
};
db.$transaction=async(fn)=>{
  const maps=[notes,jobs,runs,items], snapshots=maps.map(map=>structuredClone([...map]));
  try { return await fn(db); } catch(error) {
    maps.forEach((map,index)=>{map.clear();for(const [key,value] of snapshots[index]) map.set(key,value);});
    throw error;
  }
};
function stub(relative,exports) {const id=path.resolve(__dirname,'../..',relative);require.cache[id]={id,filename:id,loaded:true,exports};}
stub('src/server/db/prisma.ts',{prisma:db});
stub('src/server/storage/index.ts',{createInvoiceSignedUrl:async()=>({signedUrl:'https://storage.invalid/synthetic-file'})});
global.fetch=async(url,init)=>{
  assert.equal(String(url),'https://openrouter.ai/api/v1/chat/completions');
  const body=JSON.parse(init.body);calls.push(body);
  if (body.model.startsWith('google/gemini-')) {
    assert.equal(JSON.stringify(body.response_format.json_schema.schema).includes('"maxItems":'), false);
  }
  if (rejectFirst && calls.length === 1) return new Response(JSON.stringify({error:{code:400,message:'Provider returned error',metadata:{provider_name:'Google',raw:'{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}'}}}),{status:400});
  return new Response(JSON.stringify(providerStatus===200 ? {model:body.model,usage:{cost:0.02,prompt_tokens:100,completion_tokens:50,total_tokens:150},choices:[{finish_reason:'stop',message:{content:JSON.stringify(extraction)}}]} : {error:{code:providerStatus,message:providerStatus===429?'Temporarily rate-limited upstream.':'Insufficient credits'}}),{status:providerStatus});
};
const {processProcessingJob}=require('../../src/server/notes/processing-jobs.ts');
const {processNoteExtraction}=require('../../src/server/notes/process-note-extraction.ts');
function setup(mime='application/pdf', id='note-1') {
  Object.assign(process.env,{OPENROUTER_API_KEY:'offline-key',OPENROUTER_EXTRACTION_PIPELINE:'adaptive',OPENROUTER_EXTRACTION_REASONING_EFFORT:'low',OPENROUTER_PDF_REASONING_EFFORT:'low',OPENROUTER_AUDIT_REASONING_EFFORT:'high',HARNESS_VERIFIER_MODE:'off'});
  notes.set(id,{id,status:'RECEIVED',processingStage:'RECEIVED',version:1,failureCode:null,extractedData:null,originalFileName:'synthetic',originalMimeType:mime,originalFilePath:'synthetic/path',originalFileSha256:'a'.repeat(64),originalPageCount:1});
  jobs.set(`job-${id}`,{id:`job-${id}`,idempotencyKey:`initial:${id}`,noteId:id,type:'FULL_AUDIT',contextSubmissionId:null,status:'PENDING',attempt:0,maxAttempts:2,availableAt:new Date(0)});
  return id;
}
const audit=async(id)=>{
  const note=notes.get(id);
  assert.equal(note.processingStage,'ANALYZING');
  assert.equal(note.extractedData.totalAmount,'15.00');
  assert.equal(items.get(id).length,1);
  Object.assign(note,{processingStage:'COMPLETED',status:'OK'});
  return {...note};
};
test.beforeEach(()=>{notes.clear();jobs.clear();runs.clear();items.clear();calls=[];runFailure=false;persistFailure=false;providerStatus=200;rejectFirst=false;});
for(const mime of ['application/pdf','image/jpeg','image/png']) test(`job real + extração real aceita low em ${mime}`,async()=>{
  const id=setup(mime);
  await processProcessingJob(`job-${id}`,{processAudit:audit});
  assert.equal(calls.length,1);
  assert.equal(calls[0].reasoning.effort,'low');
  assert.equal(calls[0].provider.zdr,true);
  assert.equal(calls[0].reasoning.exclude,true);
  assert.equal(notes.get(id).status,'OK');
  assert.equal(jobs.get(`job-${id}`).status,'SUCCEEDED');
  assert.equal([...runs.values()][0].structuredResponse.extractionReasoningEffort,'low');
});
test('três uploads concorrentes atravessam a extração real e persistem separadamente',async()=>{
  const ids=['a','b','c'].map(id=>setup('application/pdf',id));
  await Promise.all(ids.map(id=>processProcessingJob(`job-${id}`,{processAudit:audit})));
  assert.equal(calls.length,3);
  for(const id of ids) {assert.equal(notes.get(id).status,'OK');assert.equal(items.get(id)[0].noteId,id);}
});
for(const key of ['OPENROUTER_PDF_REASONING_EFFORT','OPENROUTER_EXTRACTION_REASONING_EFFORT','OPENROUTER_AUDIT_REASONING_EFFORT','HARNESS_VERIFIER_MODE']) test(`configuração inválida ${key} não paga nem agenda recuperação`,async()=>{
  const id=setup();process.env[key]='broken';
  await assert.rejects(processProcessingJob(`job-${id}`,{processAudit:audit}),{code:'EXTRACTION_CONFIGURATION_INVALID'});
  assert.equal(calls.length,0);assert.equal(runs.size,0);
  assert.equal(notes.get(id).status,'FAILED');assert.equal(jobs.get(`job-${id}`).status,'CANCELLED');
});
test('falha ao criar registro de execução não abandona nota em processamento',async()=>{
  const id=setup();runFailure=true;
  await assert.rejects(processProcessingJob(`job-${id}`,{processAudit:audit}),{code:'EXTRACTION_PERSISTENCE_FAILED'});
  assert.equal(calls.length,0);assert.equal(notes.get(id).processingStage,'FAILED');assert.equal(jobs.get(`job-${id}`).status,'CANCELLED');
});
test('erro de saldo é terminal sem segunda chamada ou recuperação pelo polling',async()=>{
  const id=setup();providerStatus=402;
  await assert.rejects(processProcessingJob(`job-${id}`,{processAudit:audit}),{code:'EXTRACTION_CREDIT_EXHAUSTED'});
  assert.equal(calls.length,1);assert.equal(jobs.get(`job-${id}`).status,'CANCELLED');assert.equal(notes.get(id).status,'FAILED');
});

test('limite temporário do provedor não é erro de configuração nem abre novas chamadas pagas',async()=>{
  const id=setup();providerStatus=429;
  await assert.rejects(processProcessingJob(`job-${id}`,{processAudit:audit}),{code:'EXTRACTION_RATE_LIMITED'});
  assert.equal(calls.length,1);assert.equal(jobs.get(`job-${id}`).status,'CANCELLED');
  assert.equal(notes.get(id).status,'FAILED');
  assert.match(notes.get(id).failureMessage,/temporariamente limitado/);
  const run=[...runs.values()][0];
  assert.equal(run.structuredResponse.category,'PROVIDER');
  assert.equal(run.structuredResponse.costStatus,'UNKNOWN');
});
test('recuperação genérica anterior só pode ser retomada pelo job proprietário',async()=>{
  const id=setup();Object.assign(notes.get(id),{status:'PROCESSING',processingStage:'EXTRACTING',failureCode:'PIPELINE_FAILED'});
  await assert.rejects(processNoteExtraction(id),{code:'EXTRACTION_CONFLICT'});
  await processProcessingJob(`job-${id}`,{processAudit:audit});
  assert.equal(calls.length,1);assert.equal(notes.get(id).status,'OK');
});

test('HTTP 400 real reproduzido aciona modelo distinto e registra esforço do fallback',async()=>{
  const id=setup();rejectFirst=true;
  await processProcessingJob(`job-${id}`,{processAudit:audit});
  assert.equal(calls.length,2);assert.notEqual(calls[0].model,calls[1].model);
  assert.equal(calls[1].reasoning.effort,'high');
  assert.equal([...runs.values()][0].structuredResponse.extractionReasoningEffort,'high');
  assert.equal(jobs.get(`job-${id}`).status,'SUCCEEDED');
});

test('rollback da persistência preserva resposta e custo; retomada não repete a chamada paga',async()=>{
  const id=setup();persistFailure=true;
  await assert.rejects(processNoteExtraction(id),{code:'EXTRACTION_PERSISTENCE_FAILED'});
  assert.equal(calls.length,1);
  const failed=[...runs.values()][0];
  assert.equal(failed.status,'FAILED');assert.equal(failed.costUsd,0.02);
  assert.equal(failed.structuredResponse.details.code,'P2028');
  assert.equal(JSON.stringify(failed.structuredResponse).includes('secret.invalid'),false);
  assert.equal(failed.structuredResponse.checkpoint.data.totalAmount,'15.00');
  assert.equal(notes.get(id).extractedData,null);
  persistFailure=false;
  await processNoteExtraction(id);
  const resumed=[...runs.values()][1];
  assert.equal(calls.length,1);assert.equal(items.get(id).length,1);
  assert.equal(resumed.status,'SUCCEEDED');assert.equal(resumed.attempts,0);assert.equal(resumed.costUsd,0);
  assert.equal(resumed.structuredResponse.reusedFromRunId,failed.id);
});

test('arquivo alterado ou checkpoint inválido nunca reutiliza leitura anterior',async()=>{
  for(const mutate of [
    id=>{notes.get(id).originalFileSha256='b'.repeat(64);},
    ()=>{[...runs.values()].at(-1).structuredResponse.checkpoint.data={broken:true};},
  ]) {
    const id=setup('application/pdf',`source-${notes.size}`);persistFailure=true;
    await assert.rejects(processNoteExtraction(id),{code:'EXTRACTION_PERSISTENCE_FAILED'});
    const count=calls.length;mutate(id);persistFailure=false;
    await processNoteExtraction(id);assert.equal(calls.length,count+1);
  }
});

test('conflito posterior à leitura preserva custo e finaliza execução sem sobrescrever a nota nova',async()=>{
  const id=setup();
  await assert.rejects(processNoteExtraction(id,{client:{extractInvoice:async()=>{
    Object.assign(notes.get(id),{version:99,status:'OK',processingStage:'COMPLETED'});
    return {data:extraction,model:'google/gemini-3.1-flash-lite',attempts:1,latencyMs:20,usage:{costUsd:0.02}};
  }}}),{code:'EXTRACTION_CONFLICT'});
  const run=[...runs.values()][0];
  assert.equal(notes.get(id).version,99);assert.equal(notes.get(id).status,'OK');
  assert.equal(run.status,'FAILED');assert.equal(run.errorCode,'EXTRACTION_CONFLICT');assert.equal(run.costUsd,0.02);
});
