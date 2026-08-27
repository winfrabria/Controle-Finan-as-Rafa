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
3. Rejeição de configuração, timeout ou resposta estrutural inválida permitem
   uma única recuperação no Sol high. Quando houver `file_annotations`, o OCR
   retornado pelo OpenRouter é reutilizado sem reler o PDF.
4. Se Terra e Sol não concluírem, a nota termina em `FAILED/FAILED` com categoria
   técnica segura e reprocessamento administrativo. O job externo não repete
   automaticamente as chamadas já executadas pelo cliente.
5. Arquivo vazio, corrompido, criptografado, protegido por senha ou realmente
   ilegível termina em `READ_FAILED/COMPLETED`. Documento legível sem base
   auditável continua para `INFORMATION_INSUFFICIENT`, não para falha de leitura.

O corpo bruto do provedor, prompts, URLs assinadas, segredos e raciocínio nunca
são persistidos ou enviados ao cliente.

Notas com falha de extração podem ser reprocessadas. Atualização otimista por
`version` impede dois pipelines de sobrescreverem o mesmo documento.

## Configuração

- `OPENROUTER_API_KEY`: segredo usado somente no servidor.
- `OPENROUTER_EXTRACTION_MODEL`: modelo principal; o padrão é Terra.
- `OPENROUTER_EXTRACTION_FALLBACK_MODEL`: recuperação fixa no Sol.
- `OPENROUTER_PDF_MODEL`: modelo principal para PDFs; o padrão é Terra.
- `OPENROUTER_PDF_FALLBACK_MODEL`: recuperação fixa no Sol.
- `OPENROUTER_TIMEOUT_MS`: timeout por tentativa, padrão de 120 segundos para acomodar PDFs longos e escaneados sem prender o fluxo público.
- `OPENROUTER_MAX_ATTEMPTS`: de 1 a 5 na configuração, com teto efetivo de duas
  chamadas por etapa.
- `OPENROUTER_EXTRACTION_REASONING_EFFORT`: `high` para a etapa mecânica de OCR e estruturação.
- `OPENROUTER_EXTRACTION_MAX_TOKENS`: teto de saída da extração, padrão `16384`.
- `OPENROUTER_AUDIT_MAX_TOKENS`: teto de saída da auditoria, padrão `8192`.
- `OPENROUTER_PDF_ENGINE`: `mistral-ocr` por padrão para PDFs escaneados;
  também aceita `cloudflare-ai` ou `native`.

O fallback ocorre apenas para rejeição de configuração HTTP 400, timeout ou
resposta estrutural inválida. Indisponibilidade, saldo insuficiente e outros
erros de API não criam uma cadeia automática de chamadas; ficam registrados
para tentativa administrativa. `X-OpenRouter-Metadata` habilita request ID,
provedor e rota sanitizados no `AiRun`. O contrato local usa fixtures
versionadas e o aceite final exige um smoke test real autorizado, sem persistir
resposta bruta ou segredo do provedor.
