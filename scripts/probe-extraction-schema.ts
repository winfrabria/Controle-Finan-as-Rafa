// No invoices, credentials, or original responses are persisted by this probe.
import { loadEnvConfig } from '@next/env';
import { INVOICE_EXTRACTION_JSON_SCHEMA } from '../src/lib/integrations/openrouter/extraction-contract';
loadEnvConfig(process.cwd(), true);
async function main() {
  if (!process.argv.includes('--online')) throw new Error('Requires --online');
  const simple = process.argv.includes('--simple');
  const noReasoning = process.argv.includes('--no-reasoning');
  const structural = process.argv.includes('--structural');
  const providerSchema = structural ? JSON.parse(JSON.stringify(INVOICE_EXTRACTION_JSON_SCHEMA,
    (key, value) => ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems', 'minLength', 'maxLength'].includes(key) ? undefined : value)) : INVOICE_EXTRACTION_JSON_SCHEMA;
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ model: 'google/gemini-3.1-flash-lite',
      messages: [{ role: 'user', content: 'Documento sintético de teste, sem dados suficientes. Retorne campos desconhecidos como null e arrays vazios.' }],
      max_tokens: 1024, ...(!noReasoning ? { reasoning: { effort: 'low', exclude: true } } : {}),
      provider: { zdr: true, require_parameters: true },
      response_format: { type: 'json_schema', json_schema: { name: 'invoice_extraction', strict: true, schema: simple ? { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } : providerSchema } },
    }),
  });
  const data = await response.json();
  console.log(JSON.stringify({ simple, noReasoning, structural, status: response.status,
    provider: data.error?.metadata?.provider_name,
    providerCode: data.error?.code,
    structuredSuccess: !!data.choices?.[0]?.message?.content }, null, 2));
}
main().catch(e => { console.error(e instanceof Error ? e.message : 'Probe failed'); process.exitCode = 1; });
