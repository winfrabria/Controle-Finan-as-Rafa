# Harness de IA

O Harness transforma uma extração validada em uma decisão auditável. A ordem é:

1. regras universais determinísticas;
2. regras e parâmetros ativos da obra;
3. descoberta livre estruturada pela IA;
4. matriz de decisão;
5. persistência de achados, métricas e decisão humana.

Versão ativa: `2026-07-12.1`. Os artefatos versionados ficam nas pastas
`policy`, `prompts`, `schemas` e `decision-matrix`. Alterações de comportamento
devem criar uma nova versão, casos dourados e regressões antes de substituir a
versão ativa.

## Garantias

- `openai/gpt-5.6-luna`, `max` por padrão para a avaliação; os gatilhos permanecem registrados para auditoria;
- `reasoning.exclude=true`; chain-of-thought nunca é solicitado ou persistido;
- resposta de IA validada com Zod e JSON Schema estrito;
- URL assinada, chave, autorização e reasoning são removidos de dados persistidos;
- falha de leitura termina em `READ_FAILED`, sem achado e sem notificação ao Rafael;
- toda nota `SUSPICIOUS` termina em `PENDING_VALIDATION` e aparece no diagnóstico unificado do Rafael;
- no MVP, cada `Note` representa um anexo recebido e o Rafael apenas marca o diagnóstico como lido;
- upload agenda `ProcessingJob`; claim otimista impede dois workers de executar o mesmo job;
- reprocessamento preserva execuções e validações anteriores, encerra achados abertos e cria novo job.

## Operação

- `GET /api/admin/system/health`: banco, storage, OpenRouter, fila, última execução e métricas de 24 horas;
- `GET /api/admin/ai-runs` e `GET /api/admin/ai-runs/:id`: runs, tokens, custo, latência e resposta sanitizada;
- `GET /api/admin/logs`: trilha administrativa, execuções da IA e decisões humanas;
- `POST /api/internal/ai/jobs/:id/run`: execução autenticada de um job;
- `POST /api/admin/notas/:id/reprocess`: agenda reprocessamento autenticado.
- `POST /api/validacoes`: endpoint legado de decisão, mantido para histórico; o workspace do REVIEWER não expõe aprovação, rejeição ou perguntas no MVP.

O alias legado `OpenRouter_API_Key` é aceito em memória e normalizado para o
contrato canônico `OPENROUTER_API_KEY`. O valor nunca é registrado.
