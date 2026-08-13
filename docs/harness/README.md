# Harness de IA

O Harness transforma uma extração validada em uma decisão auditável. A ordem é:

1. extração estruturada com evidências concorrentes preservadas;
2. reconciliação determinística de ficha, venda, recibo, pagamento e desconto;
3. regras universais determinísticas;
4. regras e parâmetros ativos da obra;
5. descoberta livre estruturada pelo Terra high;
6. matriz de decisão;
7. persistência de achados, métricas e diagnóstico.

Política ativa: `2026-08-13.2`; prompt: `2026-08-13.2`; regras: `2026-08-13.2`; schema:
`2026-08-13.2`. Os artefatos versionados ficam nas pastas
`policy`, `prompts`, `schemas` e `decision-matrix`. Alterações de comportamento
devem criar uma nova versão, casos dourados e regressões antes de substituir a
versão ativa.

## Garantias

- `openai/gpt-5.6-terra`, em `high`, é usado na extração e na auditoria. Testes reais mostraram que `max` excede a janela operacional em PDFs longos; o modelo e o esforço efetivamente usados ficam registrados no `AiRun`;
- PDFs usam `mistral-ocr` por padrão antes da estruturação, rota indicada para documentos escaneados e compostos;
- documentos compostos classificam o tipo e preservam, por linha, observações
  independentes da ficha, venda, recibo, pagamento e desconto. A reconciliação
  local transforma valores ou datas conflitantes em achados antes da descoberta
  livre, sem depender de um segundo modelo perceber novamente a mesma evidência;
- diferenças explicadas por desconto explícito e reconciliável não viram achado;
- uma resposta estruturalmente inválida permite uma única reconstrução com o OCR ou rascunho já obtido; sem material reutilizável, o mesmo Terra é repetido uma vez. Não existe cadeia silenciosa entre modelos;
- a auditoria faz no máximo duas chamadas e o `ProcessingJob` não repete externamente a rota já concluída;
- `reasoning.exclude=true`; chain-of-thought nunca é solicitado ou persistido;
- resposta de IA validada com Zod e JSON Schema estrito;
- URL assinada, chave, autorização e reasoning são removidos de dados persistidos;
- falha de leitura termina em `READ_FAILED`, sem achado e sem notificação ao Rafael;
- confiança de leitura baixa, isoladamente, não encerra um documento composto
  materialmente extraído; total, texto multipágina e itens com valores formam
  evidência estrutural independente antes da auditoria;
- os resultados canônicos são `OK`, `SUSPICIOUS`, `NEEDS_CONTEXT` e `READ_FAILED`; `SUSPICIOUS` é terminal no MVP e não cria decisão humana;
- divergências de valor, data, total ou identificador comprováveis no próprio anexo viram `SUSPICIOUS`; perguntas são reservadas a fatos externos realmente ausentes;
- `NEEDS_CONTEXT` permite até três perguntas específicas, uma submissão e uma reanálise. Se ainda faltar contexto, o estado interno permanece `NEEDS_CONTEXT`, mas o estado público termina em `COMPLETED`;
- no MVP, cada `Note` representa um anexo recebido e o Rafael apenas consulta o diagnóstico e marca a leitura individualmente (`NoteRead`);
- upload e resposta de contexto agendam `ProcessingJob` e usam `after()` como fast path; worker/cron faz recuperação durável. Claim otimista impede dois workers de executar o mesmo job;
- a capacidade pública usa cookie HttpOnly, SameSite=Strict, TTL curto, hash persistido e protocolo não secreto. UUID sozinho não autoriza status, contexto ou preview;
- em estado terminal, o preview é negado imediatamente; o primeiro status genérico consome a capability com CAS, limpa o cookie e expira a capability antes da resposta. Repetições retornam 404;
- perguntas e respostas ficam na trilha ADMIN; o REVIEWER recebe apenas o diagnóstico final. O endpoint legado de decisão retorna bloqueio e preserva o histórico;
- reprocessamento preserva execuções e validações anteriores. Quando a extração já existe, recupera apenas a auditoria; uma extração nova só ocorre quando realmente necessária.

Reinicie o servidor após qualquer troca de modelo para limpar os clientes em
cache. Comparações futuras devem ocorrer em ambiente controlado, nunca por uma
variável antiga esquecida no deploy.

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

A pesquisa web é opcional (`OPENROUTER_WEB_SEARCH_ENABLED=false` por padrão), usa
no máximo uma chamada e três resultados e só serve como evidência complementar.
Fontes externas, quando habilitadas, ficam registradas no `AiRun`; preço genérico
encontrado na internet nunca sustenta uma suspeita sozinho.

O alias legado `OpenRouter_API_Key` é aceito em memória e normalizado para o
contrato canônico `OPENROUTER_API_KEY`. O valor nunca é registrado.
