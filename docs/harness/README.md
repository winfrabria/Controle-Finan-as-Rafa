# Harness de IA

O Harness transforma uma extração validada em uma decisão auditável. A ordem é:

1. regras universais determinísticas;
2. regras e parâmetros ativos da obra;
3. descoberta livre estruturada pela Luna max;
4. matriz de decisão;
5. persistência de achados, métricas e diagnóstico.

Versão ativa: `2026-08-01.1`. Os artefatos versionados ficam nas pastas
`policy`, `prompts`, `schemas` e `decision-matrix`. Alterações de comportamento
devem criar uma nova versão, casos dourados e regressões antes de substituir a
versão ativa.

## Garantias

- `openai/gpt-5.6-luna`, `max` por padrão para a avaliação; os gatilhos permanecem registrados para auditoria;
- `reasoning.exclude=true`; chain-of-thought nunca é solicitado ou persistido;
- resposta de IA validada com Zod e JSON Schema estrito;
- URL assinada, chave, autorização e reasoning são removidos de dados persistidos;
- falha de leitura termina em `READ_FAILED`, sem achado e sem notificação ao Rafael;
- os resultados canônicos são `OK`, `SUSPICIOUS`, `NEEDS_CONTEXT` e `READ_FAILED`; `SUSPICIOUS` é terminal no MVP e não cria decisão humana;
- `NEEDS_CONTEXT` permite até três perguntas específicas, uma submissão e uma reanálise. Se ainda faltar contexto, o estado interno permanece `NEEDS_CONTEXT`, mas o estado público termina em `COMPLETED`;
- no MVP, cada `Note` representa um anexo recebido e o Rafael apenas consulta o diagnóstico e marca a leitura individualmente (`NoteRead`);
- upload e resposta de contexto agendam `ProcessingJob` e usam `after()` como fast path; worker/cron faz recuperação durável. Claim otimista impede dois workers de executar o mesmo job;
- a capacidade pública usa cookie HttpOnly, SameSite=Strict, TTL curto, hash persistido e protocolo não secreto. UUID sozinho não autoriza status, contexto ou preview;
- em estado terminal, o preview é negado imediatamente; o primeiro status genérico consome a capability com CAS, limpa o cookie e expira a capability antes da resposta. Repetições retornam 404;
- perguntas e respostas ficam na trilha ADMIN; o REVIEWER recebe apenas o diagnóstico final. O endpoint legado de decisão retorna bloqueio e preserva o histórico;
- reprocessamento preserva execuções e validações anteriores, encerra achados abertos e cria novo job.

## Operação

- `GET /api/admin/system/health`: banco, storage, OpenRouter, fila, última execução e métricas de 24 horas;
- `GET /api/admin/ai-runs` e `GET /api/admin/ai-runs/:id`: runs, tokens, custo, latência e resposta sanitizada;
- `GET /api/admin/logs`: trilha administrativa, execuções da IA e decisões humanas;
- `POST /api/internal/ai/jobs/:id/run`: execução autenticada de um job;
- `POST /api/admin/notas/:id/reprocess`: agenda reprocessamento autenticado.
- `POST /api/validacoes`: endpoint legado bloqueado no MVP (histórico permanece somente para consulta administrativa).

O status público não expõe classificação, achados, custos ou detalhes técnicos. Ele
usa `estadoPublico` (`PROCESSING`, `NEEDS_CONTEXT`, `COMPLETED`, `READ_FAILED` ou
`FAILED`) e somente as etapas genéricas `READING` e `CHECKING`. O preview seguro,
quando retomado pela UI, exige a mesma capacidade e retorna URL assinada curta,
sem registrar a URL.

Busca aberta na internet não faz parte do MVP. Um futuro adaptador deverá aceitar
somente fontes autorizadas, guardar URL/fonte e tratar a pesquisa como evidência
complementar, nunca como base única.

O alias legado `OpenRouter_API_Key` é aceito em memória e normalizado para o
contrato canônico `OPENROUTER_API_KEY`. O valor nunca é registrado.
