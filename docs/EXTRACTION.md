# Extração de notas com OpenRouter

A WIN-20 implementa um pipeline server-only para PDF, JPG e PNG armazenados no
bucket privado. O serviço `processNoteExtraction` cria uma URL assinada curta,
envia o documento ao OpenRouter e valida a resposta estruturada com Zod antes de
persistir qualquer dado extraído.

## Estados

1. A nota elegível muda de `RECEIVED` para `PROCESSING/EXTRACTING` e recebe o
   evento `EXTRACTION_STARTED`.
2. Uma resposta válida persiste campos, Markdown e itens de forma transacional,
   avança para `PROCESSING/ANALYZING` e registra `EXTRACTION_COMPLETED`.
3. Timeout, indisponibilidade ou resposta inválida mantêm a nota em
   `PROCESSING` enquanto houver tentativas disponíveis e reagendam o job com
   backoff. Somente depois de esgotar `maxAttempts` a nota muda para
   `FAILED/FAILED`, com código seguro e evento `EXTRACTION_FAILED`. O corpo bruto
   do provedor e a chave nunca são persistidos ou enviados ao cliente.

Notas com falha de extração podem ser reprocessadas. Atualização otimista por
`version` impede dois pipelines de sobrescreverem o mesmo documento.

## Configuração

- `OPENROUTER_API_KEY`: segredo usado somente no servidor.
- `OPENROUTER_MODEL`: modelo multimodal compatível com JSON Schema.
- `OPENROUTER_TIMEOUT_MS`: timeout por tentativa, padrão de 120 segundos para acomodar PDFs longos e escaneados sem prender o fluxo público.
- `OPENROUTER_MAX_ATTEMPTS`: de 1 a 5, padrão 3.
- `OPENROUTER_EXTRACTION_REASONING_EFFORT`: `high` para a etapa mecânica de OCR e estruturação.
- `OPENROUTER_EXTRACTION_MAX_TOKENS`: teto de saída da extração, padrão `8192`.
- `OPENROUTER_AUDIT_MAX_TOKENS`: teto de saída da auditoria, padrão `8192`.
- `OPENROUTER_PDF_ENGINE`: `mistral-ocr` por padrão para PDFs escaneados;
  também aceita `cloudflare-ai` ou `native`.

Retries ocorrem apenas para timeout, falhas de rede, resposta estruturada
inválida e HTTP 408/409/429/5xx selecionados. `Retry-After` é respeitado até
cinco segundos. O contrato local usa fixtures versionadas e o aceite final
exige um teste real com PDF escaneado, sem persistir resposta bruta ou segredo
do provedor.
