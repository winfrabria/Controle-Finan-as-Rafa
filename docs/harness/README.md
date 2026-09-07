# Harness de IA

O Harness transforma uma extração validada em uma decisão auditável. A ordem é:

1. extração estruturada com evidências concorrentes preservadas;
2. reconciliação determinística de ficha, venda, recibo, pagamento e desconto;
3. regras universais determinísticas;
4. regras e parâmetros ativos da obra;
5. descoberta livre estruturada pelo Terra high;
6. seleção opcional de verificação independente em anexos de risco;
7. matriz de decisão e faixa de garantia;
8. persistência de achados, métricas, diagnóstico e feedback.

Política do código local: `2026-09-06.1`; prompt: `2026-09-07.1`; regras:
`2026-09-06.1`; schema: `2026-09-07.1`. Esta é uma candidata local e só se
torna baseline de produção após confirmação explícita de publicação. Os artefatos versionados ficam nas pastas
`policy`, `prompts`, `schemas` e `decision-matrix`. Alterações de comportamento
devem criar uma nova versão, casos dourados e regressões antes de substituir a
versão ativa.

## Garantias

- `openai/gpt-5.6-terra`, em `high`, é o padrão seguro da extração e da auditoria. O avaliador pode ser trocado somente pela variável explícita de comparação; o modelo e o esforço efetivamente usados ficam registrados no `AiRun`;
- no pipeline adaptativo, PDFs usam leitura nativa com Flash Lite e uma recuperação distinta com Flash; o parser de recuperação herda o principal, sem trocar automaticamente para um segundo serviço de OCR. O modo legado mantém sua configuração própria;
- `pageCoverage` confronta o inventário de fontes e instruções de cada página com as observações extraídas. É uma salvaguarda estrutural, não uma verificação visual independente;
- quando a recuperação falha depois de uma leitura estruturalmente válida, a leitura anterior é preservada como limitada. Sem cobertura suficiente, só regras locais sustentadas são aplicadas: não há novas chamadas pagas de auditoria ou verificação e o anexo não termina como `OK`;
- documentos compostos classificam o tipo e preservam, por linha, observações
  independentes da ficha, venda, recibo, pagamento e desconto. A reconciliação
  local transforma valores ou datas conflitantes em achados antes da descoberta
  livre, sem depender de um segundo modelo perceber novamente a mesma evidência;
- diferenças explicadas por desconto explícito e reconciliável não viram achado;
- pagamentos agregados usam `documentGroup` e são comparados com a soma dos
  itens do mesmo documento, evitando falsos positivos por produto;
- cobranças consolidadas usam papel e grupo documental para reconciliar todos os
  suportes presentes, sem regra específica por fornecedor, número ou valor;
- campos vazios só viram achado quando houver base verificável: indicação
  explícita no documento ou política global confirmada. Uma área visivelmente
  vazia, isoladamente, não comprova obrigatoriedade;
- `itemCoverage` registra se a camada totalizadora está completa, incompleta ou
desconhecida. `TOTAL_MISMATCH` só é permitido com cobertura explicitamente
completa, sem linhas faltantes e sem déficit entre itens declarados e extraídos;
- divergência de quantidade × preço unitário só vira achado quando a extração
  confirma visualmente os três valores na mesma linha. Uma soma contaminada por
  leitura aritmética não confirmada não autoriza `TOTAL_MISMATCH`;
- no modo legado, Terra high é a rota primária. Somente rejeição de configuração HTTP 400,
  ausência estrutural de endpoint elegível HTTP 404, timeout ou resposta
  estrutural inválida habilitam uma única recuperação no Sol high;
- Envelopes HTTP 200 com `error` seguem essa classificação: códigos explícitos
  de saldo, limite ou indisponibilidade não abrem nova chamada; documento
  realmente ilegível termina em `READ_FAILED`;
- quando o OpenRouter devolve `file_annotations`, o OCR já pago é reutilizado
  no modelo de recuperação configurado. Sem OCR ou rascunho reutilizável, o arquivo pode ser enviado uma única
  vez ao modelo distinto de recuperação;
- a extração e a auditoria fazem no máximo duas chamadas e o `ProcessingJob`
  não repete externamente uma rota já esgotada;
- `reasoning.exclude=true`; chain-of-thought nunca é solicitado ou persistido;
- resposta de IA validada com Zod e JSON Schema estrito;
- URL assinada, chave, autorização e reasoning são removidos de dados persistidos;
- arquivo vazio, corrompido, criptografado, protegido ou realmente ilegível
  termina em `READ_FAILED`, sem achado e sem notificação ao Rafael;
- documento legível sem base auditável suficiente termina em
  `INFORMATION_INSUFFICIENT`; erro de API, timeout ou configuração termina em
  falha técnica e fica disponível para reprocessamento administrativo;
- confiança de leitura baixa, isoladamente, não encerra um documento composto
  materialmente extraído; total, texto multipágina e itens com valores formam
  evidência estrutural independente antes da auditoria;
- os resultados canônicos são `OK`, `SUSPICIOUS`, `NEEDS_CONTEXT`,
  `INFORMATION_INSUFFICIENT` e `READ_FAILED`; `SUSPICIOUS` é terminal no MVP e
  não cria decisão humana;
- divergências de valor, data, total ou identificador comprováveis no próprio anexo viram `SUSPICIOUS`; perguntas são reservadas a fatos externos realmente ausentes;
- `NEEDS_CONTEXT` permite até três perguntas específicas, uma submissão e uma reanálise. Se ainda faltar contexto, o estado interno permanece `NEEDS_CONTEXT`, mas o estado público termina em `COMPLETED`;
- no MVP, cada `Note` representa um anexo recebido e o Rafael apenas consulta o diagnóstico e marca a leitura individualmente (`NoteRead`);
- upload e resposta de contexto agendam `ProcessingJob` e usam `after()` como fast path; worker/cron faz recuperação durável. Claim otimista impede dois workers de executar o mesmo job;
- a capacidade pública usa cookie HttpOnly, SameSite=Strict, TTL curto, hash persistido e protocolo não secreto. UUID sozinho não autoriza status, contexto ou preview;
- em estado terminal, o preview é negado imediatamente; o primeiro status genérico consome a capability com CAS, limpa o cookie e expira a capability antes da resposta. Repetições retornam 404;
- perguntas e respostas ficam na trilha ADMIN; o REVIEWER recebe apenas o diagnóstico final. O endpoint legado de decisão retorna bloqueio e preserva o histórico;
- reprocessamento preserva execuções e validações anteriores. Quando a extração já existe, recupera apenas a auditoria; uma extração nova só ocorre quando realmente necessária.
- regras específicas de obra ficam desativadas por padrão no ciclo de testes
  (`HARNESS_WORK_RULES_ENABLED=false`). A obra selecionada organiza o anexo, mas
  não cria suspeita operacional até a ativação explícita dessa fase.
- observações livres `INFO` não viram achados do revisor. Variação textual de
  nomes sem duas identidades fiscais e associação de placa/equipamento sem
  cadastro ou regra ativa também são descartadas antes da decisão;
- todos os achados consolidados, inclusive determinísticos, ficam vinculados ao
  `AiRun` que fechou a decisão para o log administrativo mostrar a execução por
  inteiro;
- o verificador seletivo usa Sol high e, quando habilitado, faz no máximo uma
  chamada por fingerprint imutável. `off` é o padrão, `shadow` não altera o
  diagnóstico e `enforce` exige aprovação explícita do gate humano;
- anexos de risco não verificados recebem garantia limitada. O Rafael vê apenas
  a faixa alta, média ou limitada e um motivo curto; métricas numéricas ficam no
  ADMIN;
- o feedback do Rafael avalia a qualidade do diagnóstico e nunca reintroduz
  aprovação/rejeição financeira. A versão da nota e o `AiRun` ficam vinculados
  para impedir que feedback antigo seja aplicado a uma auditoria nova;

Reinicie o servidor após qualquer troca de modelo para limpar os clientes em
cache. Comparações futuras devem ocorrer em ambiente controlado, nunca por uma
variável antiga esquecida no deploy.

## Operação

- `GET /api/admin/system/health`: banco, storage, OpenRouter, fila, última execução e métricas de 24 horas;
- `GET /api/admin/ai-runs` e `GET /api/admin/ai-runs/:id`: runs, tokens, custo, latência e resposta sanitizada;
- `GET /api/admin/logs`: trilha administrativa, execuções da IA e decisões humanas;
- `POST /api/internal/ai/jobs/:id/run`: execução autenticada de um job;
- `POST /api/admin/notas/:id/reprocess`: agenda reprocessamento autenticado.
- `PUT /api/notas/:id/audit-feedback`: registra feedback diagnóstico individual
  e idempotente, sem alterar estado financeiro ou achados.
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
