# Extração de notas com OpenRouter

## Compatibilidade verificada em 06/09/2026

A extração valida seus próprios esforços (`none`, `minimal`, `low`, `medium`,
`high`, `xhigh`, `max`), sem reutilizar a restrição `high/max/xhigh` da auditoria.
Configurações de extração, auditoria e verificador são verificadas antes de
adquirir a nota e iniciar chamadas pagas. Falha de configuração encerra o job;
uma recuperação legada `PIPELINE_FAILED` só pode ser retomada pelo job proprietário.

O esquema completo de extração reproduziu HTTP 400 no Gemini em teste online.
As rotas Gemini recebem agora tipos, campos obrigatórios, enums e nulabilidade,
sem compilar limites de cardinalidade, tamanho e números profundamente aninhados.
O contrato Zod local permanece intacto e aplica todos esses limites antes da
persistência. Não existe relaxamento de evidência ou de classificação para
fazer um documento ser aprovado.

A qualidade da cobertura é verificada em PDF, JPG e PNG. Um único identificador
de grupo em uma nota simples não a transforma em documento composto e não
dispara uma segunda leitura desnecessária.

O enum legado `AiRun.reasoningEffort` ainda só representa `HIGH/MAX/XHIGH`.
Por compatibilidade sem migração no banco compartilhado, o esforço exato da
extração fica em `structuredResponse.extractionReasoningEffort`; os leitores
administrativos usam `effectiveRunReasoning`. A coluna legada nunca configura
uma chamada ao provedor. Uma futura migração pode remover essa compatibilidade.

Teste integrado offline: `tests/harness/extraction-pipeline.test.cjs` conecta o
job, a extração, a configuração e o cliente HTTP reais, simulando somente
armazenamento, banco e provedor. O smoke opt-in
`node scripts/smoke-public-upload.mjs --online` usa localhost, obra DEMO e
documentos públicos em `tmp/public-invoice-smoke`; cria notas de teste reais e
consome IA. `--extended` inclui o guia público de 12 páginas. Não deve ser
executado em produção nem confundido com avaliação humana de precisão.

A WIN-20 implementa um pipeline server-only para PDF, JPG e PNG armazenados no
bucket privado. O serviço `processNoteExtraction` cria uma URL assinada curta,
envia o documento ao OpenRouter e valida a resposta estruturada com Zod antes de
persistir qualquer dado extraído.

## Estados

1. A nota elegível muda de `RECEIVED` para `PROCESSING/EXTRACTING` e recebe o
   evento `EXTRACTION_STARTED`.
2. Uma resposta válida persiste campos, Markdown e itens de forma transacional,
   avança para `PROCESSING/ANALYZING` e registra `EXTRACTION_COMPLETED`.
3. No modo `adaptive`, Gemini 3.1 Flash Lite faz a leitura rápida. Gemini 3.7
   Flash só é chamado quando há rejeição compatível, timeout, resposta inválida
   ou cobertura documental não comprovada. Uma segunda leitura ainda parcial é
   persistida com limitação explícita e segue de forma segura para
   `INFORMATION_INSUFFICIENT`, em vez de inventar um achado. Na persistência
   pública essa saída usa `READ_FAILED`, para nunca aparecer como `OK`.
4. Quando houver `file_annotations`, o OCR retornado pelo OpenRouter é
   reutilizado sem reler o PDF. PDF nativo é usado no caminho normal; Mistral
   OCR entra apenas na recuperação configurada.
5. Se os provedores não devolverem uma estrutura utilizável, a nota termina em
   `FAILED/FAILED` com categoria técnica segura e reprocessamento administrativo.
   O job externo não repete automaticamente as chamadas já executadas pelo cliente.
6. Arquivo vazio, corrompido, criptografado, protegido por senha, realmente
   ilegível ou sem cobertura suficiente para uma conclusão termina em
   `READ_FAILED/COMPLETED`. Internamente o motor preserva a distinção
   `INFORMATION_INSUFFICIENT`, mas a interface nunca a converte em aprovação.

O corpo bruto do provedor, prompts, URLs assinadas, segredos e raciocínio nunca
são persistidos ou enviados ao cliente.

Notas com falha de extração podem ser reprocessadas. Atualização otimista por
`version` impede dois pipelines de sobrescreverem o mesmo documento.

## Configuração

- `OPENROUTER_API_KEY`: segredo usado somente no servidor.
- `OPENROUTER_EXTRACTION_PIPELINE`: `legacy` por padrão seguro no código ou
  `adaptive` para a arquitetura rápida. O ambiente de teste usa `adaptive`.
- `OPENROUTER_EXTRACTION_QUALITY_GATE`: faz a segunda leitura somente quando a
  primeira não comprova cobertura.
- `OPENROUTER_EXTRACTION_MODEL`: no modo adaptativo, Gemini 3.1 Flash Lite.
- `OPENROUTER_EXTRACTION_FALLBACK_MODEL`: no modo adaptativo, Gemini 3.7 Flash.
- `OPENROUTER_PDF_MODEL`: modelo principal para PDFs.
- `OPENROUTER_PDF_FALLBACK_MODEL`: revisor visual seletivo para PDFs.
- `OPENROUTER_TIMEOUT_MS`: timeout por tentativa, padrão de 120 segundos para acomodar PDFs longos e escaneados sem prender o fluxo público.
- `OPENROUTER_MAX_ATTEMPTS`: de 1 a 5 na configuração, com teto efetivo de duas
  chamadas por etapa.
- `OPENROUTER_EXTRACTION_REASONING_EFFORT`: `low` no caminho rápido; reduz latência e custo da estruturação mecânica.
- `OPENROUTER_EXTRACTION_FALLBACK_REASONING_EFFORT`: `high` somente na revisão visual acionada por ambiguidade ou falha estrutural.
- `OPENROUTER_PDF_REASONING_EFFORT`: `low` na primeira leitura de PDF.
- `OPENROUTER_EXTRACTION_MAX_TOKENS`: teto de saída da extração, padrão `16384`.
- `OPENROUTER_AUDIT_MAX_TOKENS`: teto de saída da auditoria, padrão `8192`.
- `OPENROUTER_EXTRACTION_TIMEOUT_MS`: timeout por leitura; 60 segundos no modo
  adaptativo antes de acionar a recuperação elegível.
- `OPENROUTER_PDF_ENGINE`: `native` no caminho rápido; também aceita
  `cloudflare-ai` ou `mistral-ocr`.
- `OPENROUTER_PDF_FALLBACK_ENGINE`: `native` no modo adaptativo. O fallback
  mantém leitura nativa, sem contratar automaticamente um segundo parser de OCR.

O fallback técnico ocorre apenas para rejeição de configuração HTTP 400, ausência
estrutural de endpoint elegível HTTP 404, timeout ou resposta estrutural
inválida. No modo adaptativo, a mesma segunda chamada também pode ocorrer por
cobertura não comprovada; nunca ocorre em toda nota. O 404 só é elegível quando a mensagem/código identifica a rota ou
endpoint ausente; um 404 arbitrário, saldo insuficiente, 429, 503 e outros
erros de API não criam uma cadeia automática de chamadas. Ficam registrados
para tentativa administrativa. Envelopes HTTP 200 com `error` seguem a mesma
classificação: códigos explícitos de saldo, limite ou indisponibilidade não
abrem nova chamada, e uma imagem/PDF realmente ilegível termina como
`document-unreadable`. `X-OpenRouter-Metadata` habilita request ID,
provedor e rota sanitizados no `AiRun`. O contrato local usa fixtures
versionadas e o aceite final exige um smoke test real autorizado, sem persistir
resposta bruta ou segredo do provedor.
