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
3. Timeout, indisponibilidade ou resposta inválida mudam a nota para
   `FAILED/FAILED`, com código seguro e evento `EXTRACTION_FAILED`. O corpo bruto
   do provedor e a chave nunca são persistidos ou enviados ao cliente.

Notas com falha de extração podem ser reprocessadas. Atualização otimista por
`version` impede dois pipelines de sobrescreverem o mesmo documento.

## Configuração

- `OPENROUTER_API_KEY`: segredo usado somente no servidor.
- `OPENROUTER_MODEL`: modelo multimodal compatível com JSON Schema.
- `OPENROUTER_TIMEOUT_MS`: timeout por tentativa, padrão de 60 segundos.
- `OPENROUTER_MAX_ATTEMPTS`: de 1 a 5, padrão 3.
- `OPENROUTER_PDF_ENGINE`: `cloudflare-ai` por padrão; pode ser
  `mistral-ocr` para PDFs escaneados ou `native` para modelo compatível.

Retries ocorrem apenas para timeout, falhas de rede, resposta estruturada
inválida e HTTP 408/409/429/5xx selecionados. `Retry-After` é respeitado até
cinco segundos. O teste real com OpenRouter permanece pendente até a chave e o
modelo serem configurados; o contrato local usa a fixture versionada em
`src/lib/integrations/openrouter/__fixtures__/valid-invoice-extraction.json`.
