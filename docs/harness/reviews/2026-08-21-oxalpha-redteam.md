# Red team independente — Harness WinfraBR (oxalpha)

Data: 2026-08-21
Base: `main@1650fa6` (branch local `codex/harness-redteam-oxalpha`, commit `1f0aa18`)
PRD lido integralmente: `docs/harness/PRD_STABILIZATION_2026-08-21.md`
Relatório do WP-A: não disponível nesta worktree no momento da análise (`docs/harness/reviews/` inexistia), logo a etapa "questionar o WP-A" fica pendente para uma rodada futura.
Política testada: `2026-08-14.2`.

Escopo executado conforme PRD §6/WP-B e §7: nenhuma alteração em código de produção; nenhum push, merge, deploy ou migration; casos de teste mínimos criados apenas para provar falhas; sem cadeia de pensamento.

Convenção: cada achado indica **fato observado** (reproduzido) ou **fato por inspeção** (leitura de código, sem execução). Hipóteses e recomendações estão marcadas.

---

## Resumo executivo

8 falhas reproduzidas em código (RT-01 a RT-08, provas automatizadas em `tests/harness/redteam-failures.test.ts`) e 7 observações estruturais por inspeção (RT-09 a RT-15). As falhas concentraram-se na camada determinística (`src/lib/audit-harness/rules.ts`) e na orquestração (`src/lib/audit-harness/engine.ts`): falsos positivos de conciliação de pagamento agregado, furos de falso negativo que silenciam `TOTAL_MISMATCH` e `ITEM_ARITHMETIC_MISMATCH`, duplicação semântica entre regra determinística e descoberta livre, e conversão indevida de pergunta de contexto legítima em achado. Concorrência, loops de retry e transições de estado foram auditados sem encontrar violação (seção 4).

| ID | Tipo | Severidade | Arquivo principal |
|----|------|------------|-------------------|
| RT-01 | Falso positivo | Alta | src/lib/audit-harness/rules.ts |
| RT-02 | Falso positivo (+ falso negativo secundário) | Alta | src/lib/audit-harness/rules.ts |
| RT-03 | Falso negativo | Média | src/lib/audit-harness/rules.ts |
| RT-04 | Falso negativo | Média | src/lib/audit-harness/rules.ts |
| RT-05 | Falso negativo | Média | src/lib/audit-harness/rules.ts |
| RT-06 | Duplicação semântica | Média | src/lib/audit-harness/engine.ts |
| RT-07 | Pergunta de contexto incorreta / falso positivo | Alta | src/lib/audit-harness/engine.ts |
| RT-08 | Falso negativo | Média | src/lib/audit-harness/engine.ts |
| RT-09 | Hardcode de caso | Média | src/server/notes/context-questions.ts |
| RT-10 | Política inerte / telemetria enganosa | Baixa | src/lib/audit-harness/policy.ts |
| RT-11 | Fixture dourada inconsistente e órfã | Baixa | src/lib/audit-harness/__fixtures__/golden-cases.json |
| RT-12 | Defesa de prompt injection rasa | Baixa | src/server/integrations/openrouter/audit-client.ts |
| RT-13 | Sanitização apenas por nome de chave | Baixa | src/lib/audit-harness/security.ts |
| RT-14 | Métrica de cobertura inflada | Baixa | src/lib/audit-harness/rules.ts |
| RT-15 | Regra de obra inválida ignorada em silêncio | Média | src/lib/audit-harness/rules.ts |

---

## 1. Falhas reproduzidas

Provas: `tests/harness/redteam-failures.test.ts`. Todos os 8 testes declaram o comportamento **correto esperado** e todos falham contra o código atual, ou seja, 8/8 comportamentos desejados são violados.

### RT-01 — Pagamento agregado reconciliado gera `AGGREGATE_PAYMENT_MISMATCH` (falso positivo)

- **Fato observado** (teste RT1).
- **Arquivo/linha**: `src/lib/audit-harness/rules.ts:303-384`, em especial 325 (`uniqueItems` inclui todo item com observação no grupo, inclusive o próprio item `AGGREGATE_PAYMENT`) e 331-334 (`itemTotal` soma esses itens).
- **Impacto**: num boleto/fatura corretamente conciliado (cobrança R$ 100,00 = suportes R$ 60,00 + R$ 40,00, todos com `documentGroup` comum e observações de evidência), a soma inclui o valor da própria cobrança (R$ 200,00 contra pagamento de R$ 100,00) e dispara um achado `WARNING` com confiança 0,99 sobre um documento correto — exatamente o risco 3 do PRD (contar camadas sobrepostas como independentes) na forma inversa.
- **Reprodução**: teste RT1; itens 1-3 com papel AGGREGATE_PAYMENT/SUPPORTING_DOCUMENT, mesmo `documentGroup`, valores 100/60/40, todos com `evidenceObservations`.
- **Correção sugerida**: excluir itens com `documentRole === "AGGREGATE_PAYMENT"` de `uniqueItems` (ou somar apenas `LINE_ITEM`/`SUPPORTING_DOCUMENT`) ao calcular `itemTotal`; manter o item agregado apenas como fonte do `paymentTotal`.

### RT-02 — Pagamentos parciais comparados só com a primeira parcela (falso positivo + falso negativo secundário)

- **Fato observado** (teste RT2).
- **Arquivo/linha**: `src/lib/audit-harness/rules.ts:335-349` — `uniquePayments` deduplica as parcelas, mas `paymentTotal` usa somente `uniquePayments[0]` (linha 343); além disso a linha 346 marca **todas** as observações `PAYMENT` como reconciliadas.
- **Impacto**: compra de R$ 100,00 paga em duas parcelas de R$ 60,00 e R$ 40,00 gera `AGGREGATE_PAYMENT_MISMATCH` espúrio (compara 100 contra 60). Secundariamente, marcar todas as parcelas como reconciliadas esconde conflitos reais entre ficha e pagamento dessas mesmas linhas em `reconcileEvidenceObservations` (falso negativo).
- **Reprodução**: teste RT2; dois suportes de 60 e 40 com observações PAYMENT de 60 (pág. 1) e 40 (pág. 2) no mesmo grupo.
- **Correção sugerida**: somar todas as parcelas deduplicadas (`paymentTotal = Σ uniquePayments`) e marcar como reconciliadas somente as observações efetivamente comparadas.

### RT-03 — Camada explícita toda `false` silencia `TOTAL_MISMATCH` mesmo com cobertura `COMPLETE` (falso negativo)

- **Fato observado** (teste RT3).
- **Arquivo/linha**: `src/lib/audit-harness/rules.ts:110-118` (`hasExplicitSelection` aceita seleção vazia), `74-78` (`sumItemTotals([])` retorna `null`) e `590-615` (bloco de `TOTAL_MISMATCH` não executa com soma `null`).
- **Impacto**: se a extração marca `countsTowardDocumentTotal: false` em **todos** os itens (erro comum de modelo) e declara `itemCoverage.status = COMPLETE`, a reconciliação do total é pulada sem qualquer sinal — viola o espírito do gate 1 do PRD (o gate existe para evitar falso positivo, mas não pode abrir furo para falso negativo total).
- **Reprodução**: teste RT3; cobertura COMPLETE com 2 itens somando 90 contra total declarado 100, ambos `false`.
- **Correção sugerida**: quando houver seleção explícita com zero itens `true` e cobertura `COMPLETE`, tratar como camada inválida: emitir achado específico (ex.: `TOTAL_LAYER_UNSELECTED`) ou cair para a heurística legada em vez de pular a verificação.

### RT-04 — Palavra "desconto" sem número suprime `ITEM_ARITHMETIC_MISMATCH` (falso negativo)

- **Fato observado** (teste RT4).
- **Arquivo/linha**: `src/lib/audit-harness/rules.ts:51-61` — descrição contendo "desconto" sem valor parseável retorna `true` e cancela a checagem quantidade × preço.
- **Impacto**: qualquer item cuja descrição mencione "desconto" (texto livre extraído do documento, potencialmente controlado por terceiro) fica imune à validação aritmética determinística; divergências reais de qty × preço deixam de ser apontadas. O comentário do código reconhece a troca, mas o gatilho atual é explorável por texto do próprio anexo.
- **Reprodução**: teste RT4; 2 × 50 = 100 contra total do item 80, descrição "Servico com desconto aplicado no fechamento da conta" — nenhum achado gerado.
- **Correção sugerida**: só suprimir quando o desconto for numericamente verificável (valor parseado que explica a diferença); caso contrário, emitir o achado aritmético normal (ou um achado distinto `DISCOUNT_UNVERIFIABLE`).

### RT-05 — Formatação do total impede detecção de duplicata exata (falso negativo)

- **Fato observado** (teste RT5).
- **Arquivo/linha**: comparação de igualdade estrita de string em `src/lib/audit-harness/rules.ts:673-691` (`candidate.totalAmount === invoice.totalAmount`), combinada com a construção dos candidatos em `src/server/notes/process-note-audit.ts:245-251` (`Decimal.toString()` produz "1000", enquanto a extração persiste "1000.00").
- **Impacto**: notas verdadeiramente duplicadas não recebem `POSSIBLE_DUPLICATE` quando a representação decimal difere (casas opcionais), reduzindo o recall do achado obrigatório de duplicidade do corpus.
- **Reprodução**: teste RT5; invoice `totalAmount: "1000.00"` contra candidato `"1000"` com mesmo número/fornecedor/data.
- **Correção sugerida**: comparar os valores após `Number(...)` com tolerância monetária já existente (`moneyTolerance`), não por igualdade de string.

### RT-06 — Contradição já coberta por regra determinística é promulgada de novo (duplicação semântica)

- **Fato observado** (teste RT6).
- **Arquivo/linha**: `src/lib/audit-harness/engine.ts:319-322` — `routeContextQuestions(input.aiDiscovery?.contextQuestions ?? [], aiFindings)` recebe **apenas** achados de IA como `existingFindings`; os achados universais/de obra (linhas 300-305) não participam da checagem de `findingAlreadyCoversValues` (63-73).
- **Impacto**: quando a regra determinística já apontou `EVIDENCE_AMOUNT_MISMATCH_n` (ficha R$ 28,00 × recibo R$ 18,00) e a IA devolve pergunta contendo os mesmos valores, o engine cria também `INTERNAL_CONTRADICTION_*` para a mesma divergência — dois cards para o revisor sobre o mesmo fato, violando o princípio anti-repetição do PRD (risco 5 e métrica de taxa de duplicação semântica).
- **Reprodução**: teste RT6; invoice com observações SHEET 28 / RECEIPT 18 mais `contextQuestion` citando ambos os valores.
- **Correção sugerida**: passar `[...universal.findings, ...work.findings, ...aiFindings]` como `existingFindings` na chamada de `routeContextQuestions`.

### RT-07 — Pergunta de contexto legítima convertida em achado por regex genérica (pergunta incorreta → falso positivo)

- **Fato observado** (teste RT7).
- **Arquivo/linha**: `src/lib/audit-harness/engine.ts:29-30` (`INTERNAL_CONTRADICTION_PATTERN` aceita termos genéricos como "enquanto", "se a/o(s)", "para resultar", "vs") e `46-61` (`objectiveContradiction` promove qualquer pergunta com ≥ 2 valores monetários/datas que contenha um desses termos).
- **Impacto**: pergunta legítima sobre **fato externo** ("Se a obra autorizou limite de R$ 500,00 e a nota totaliza R$ 480,00, existe aprovação adicional pendente?") é transformada em achado `INTERNAL_CONTRADICTION_*` com evidência resumida ao próprio texto da pergunta — sem página, linha ou trecho rastreável no anexo. Isso fere simultaneamente o princípio do PRD §3 (pergunta de contexto só para fato externo) e a exigência de evidência rastreável (gate 4), além de inflar a taxa de achado sem evidência.
- **Reprodução**: teste RT7 via `routeContextQuestions` direto.
- **Correção sugerida**:
  1. exigir que a promoção cite referências do anexo (página/linha presentes na pergunta ou em observações conhecidas) antes de criar o achado;
  2. restringir o padrão de contradição a pares explícitos de registros (ex.: "ficha/recibo/pagamento") em vez de conectivos genéricos;
  3. corrigir a fraqueza correlata de `findingAlreadyCoversValues` (engine.ts:63-73): casamento por substring faz "R$ 10,00" ser considerado coberto por "R$ 110,00".

### RT-08 — Gap de cobertura em um grupo documental suprime `TOTAL_MISMATCH` de outro grupo (falso negativo)

- **Fato observado** (teste RT8).
- **Arquivo/linha**: `src/lib/audit-harness/engine.ts:181-185` e `199-200` — `hasCoverageGap` é booleano global: qualquer `COMPOSITE_DETAIL_COVERAGE_GAP` ou `COMPOSITE_PAYMENT_DOCUMENT_GAP*` descarta **todo** `TOTAL_MISMATCH`, independentemente do `documentGroup` afetado.
- **Impacto**: num composto com cobrança não comprovada no grupo A e camada fiscal completa e divergente no grupo B, a divergência real do total desaparece do resultado — falso negativo de severidade crítica para o revisor.
- **Reprodução**: teste RT8; `evaluateUniversalRules` emite `TOTAL_MISMATCH`, `evaluateHarness` o descarta por causa do gap do grupo "obra-a".
- **Correção sugerida**: tornar a precedência escopada por grupo/camada (comparar `documentGroup`/`noteItemLineNumber` do gap e do `TOTAL_MISMATCH`) em vez de descarte global por presença de qualquer gap.

---

## 2. Observações estruturais (por inspeção de código)

### RT-09 — Hardcode de caso em filtro de opções opacas

- **Fato por inspeção**: `src/server/notes/context-questions.ts:92-96` — regex `/^(?:all\s+(?:violet|filet)|option\s*\d+|...)/i` embute tokens específicos ("violet", "filet"), que remetem a fornecedor/produto de caso real, dentro da regra de validação.
- **Impacto**: viola diretamente o princípio do PRD §3 ("nenhuma regra pode conter nome de fornecedor... vindo de caso real") e cria dependência frágil: novos placeholders opacos não previstos na lista passam pelo filtro.
- **Correção sugerida**: generalizar para padrões estruturais (`all\s+\w+`, rótulo idêntico/contido no prompt, rótulo sem relação com o texto da pergunta) e remover os tokens de caso.

### RT-10 — Política de raciocínio inerte (gatilhos calculados, nunca aplicados)

- **Fato por inspeção**: `src/lib/audit-harness/policy.ts:25-49` — `selectReasoningEffort` acumula `triggers` (HIGH_VALUE, CRITICAL_FINDING etc.) mas sempre retorna `AUDIT_POLICY.defaultReasoningEffort` ("high"); os limites `xhighTriggers` (13-16) não alteram o esforço efetivo.
- **Impacto**: telemetria sugere escalonamento que não ocorre; custo/latência de casos críticos não são gerenciados como a política descreve — área de risco 9 do PRD (esconder comportamento atrás da classificação final). Menor relacionado: `rules.ts:643-657` usa `new Date()` por padrão em `FUTURE_ISSUE_DATE`, tornando replays de avaliação não determinísticos.
- **Correção sugerida**: ou implementar o escalonamento (mapear triggers → effort) ou remover os gatilhos/xhighTriggers até decisão de produto; injetar `now` obrigatório no runner de avaliação.

### RT-11 — Fixture dourada inconsistente e órfã

- **Fato por inspeção**: `src/lib/audit-harness/__fixtures__/golden-cases.json:17-20` — caso `no-finding-no-coverage` espera `NEEDS_CONTEXT`, mas `decideClassification` (decision-matrix.ts:42-71) retorna `OK` sem perguntas nem `contextRequired`; o arquivo não é referenciado por nenhum script/teste (grep "golden-cases" só encontra o próprio arquivo).
- **Impacto**: quando o WP-C construir o runner sobre fixtures existentes, herdará expectativa errada ou precisará corrigi-la sob pressão de "não mudar regra para o teste passar".
- **Correção sugerida**: no WP-C, substituir a expectativa por `OK` (ou definir `needsContext` explícito no caso) e consumir o arquivo a partir do contrato versionado do runner.

### RT-12 — Filtragem de pergunta de política cobre apenas formulação em português

- **Fato por inspeção**: `src/server/integrations/openrouter/audit-client.ts:51-52` e `84` — `POLICY_QUESTION_PATTERN` casa apenas "quais/qual/defina/estabeleça/informe + regras/políticas/...". Pergunta equivalente em outra língua ("Which spending rules apply here?") passa pelo filtro e chega ao remetente público.
- **Impacto**: baixo em cenário atual (prompt proíbe e o modelo é instruído em PT-BR), mas a única defesa mechanizada fora do prompt é essa regex; o gate "precisão das perguntas de contexto" pode ser penalizado sem sinal técnico.
- **Correção sugerida**: adicionar verificação estrutural complementar (pergunta que menciona termos de política sem citar nenhum registro do anexo deve ser descartada/loggada), independente de idioma.

### RT-13 — Sanitização de persistência apenas por nome de chave

- **Fato por inspeção**: `src/lib/audit-harness/security.ts:1-19` — `SENSITIVE_KEYS` cobre `apikey`, `authorization`, `chainofthought`, `reasoning`, `reasoningdetails`, `signedurl`; não cobre `token`, `secret`, `password`, `cookie` e não inspeciona valores de string (um segredo embutido em texto atravessa).
- **Impacto**: superfície real hoje é pequena (schemas strict fixam as chaves de `evidence`), mas `contextSummary` (saída livre do modelo, até 4.000 caracteres) é persistida sem sanitização em `process-note-audit.ts:446` e renderizada em telas internas e públicas. Gate 6 depende quase inteiramente do prompt e do `exclude: true` do provider.
- **Correção sugerida**: ampliar `SENSITIVE_KEYS`, reaplicar as redações de `pipelineFailureDetails` (processing-jobs.ts:90-97) a strings longas persistidas e registrar comprimento/origem de `contextSummary` em auditoria.

### RT-14 — Áreas de cobertura marcadas sem checagem efetiva

- **Fato por inspeção**: `src/lib/audit-harness/rules.ts:722-725` — `ALCOHOL` e `PERSONAL_HYGIENE` são adicionados a `coveredAreas` sempre que `items.length > 0`, mesmo quando nenhum termo foi avaliado com sucesso (listas fixas podem não casar com nada).
- **Impacto**: infla `coveredAreas` e o limiar `covered = size >= 3` (linha 727), distorcendo a métrica "cobertura de páginas e itens" do PRD §5.
- **Correção sugerida**: marcar a área apenas quando a varredura por termos executou sobre descrições não vazias; reportar separadamente áreas "varridas sem casamento".

### RT-15 — Configuração de regra de obra inválida é descartada silenciosamente

- **Fato por inspeção**: `src/lib/audit-harness/rules.ts:735-737` — `if (!parsed.success) continue;` não incrementa `evaluated`, não registra aviso e não aparece no resultado.
- **Impacto**: uma regra ativa da obra com schema inválido simplesmente não audita; o operador não consegue distinguir "obra sem regras" de "regra quebrada", enfraquecendo a verificabilidade do gate 2 do PRD (zero regra aplicada sem parâmetro fornecido — aqui o inverso: parâmetro fornecido, nunca aplicado).
- **Correção sugerida**: retornar diagnóstico por regra (`invalidRules: [{ code, issues }]`) no resultado de `evaluateWorkRules` e registrá-lo em `AiRun.structuredResponse`/evento de auditoria.

---

## 3. Comandos e testes executados

Ambiente Windows; worktree dedicado; branch `codex/harness-redteam-oxalpha`.

```
npm install
npm run typecheck                                   → OK (sem erros)
npx eslint tests/harness/redteam-failures.test.ts --max-warnings=0 → OK
npm run test:harness                                → 111 testes: 108 pass, 0 fail, 3 skipped*
DATABASE_URL="postgresql://user:pass@localhost:5432/db" npm run test:harness (idem acima)
npx tsx --conditions=react-server --test tests/harness/redteam-failures.test.ts
                                                    → 8 testes, 0 pass, 8 fail (provas RT-01..RT-08)
```

\* Observação de ambiente: `processing-jobs.test.ts`, `processing-jobs.integration.test.ts` e `processing-worker.test.ts` importam `@/server/db/prisma`, que lança erro no carregamento sem `DATABASE_URL`, mesmo nos testes que não tocam o banco. Com uma URL dummy, todos passam (os 3 skipped são de integração e pulam sem banco real). Recomenda-se carregar o client sob demanda para os testes unitários rodarem sem variável de ambiente.

Os testes de prova (RT1–RT8) foram escritos para afirmar o comportamento **correto**; ficam intencionalmente falhando enquanto as falhas existirem, servindo de regressão para quem corrigir. Nenhum arquivo de produção foi modificado (`git status` mostra apenas o relatório e o teste).

## 4. Áreas auditadas sem violação encontrada

Registro dos alvos do WP-B examinados sem achado explorável nesta rodada:

- **Concorrência de jobs**: `claimProcessingJob` usa CAS por `attempt/status` (processing-jobs.ts:231-249); recuperação de leases é condicionada a `lockedAt <= staleBefore` dentro de transação (processing-worker.ts:131-307). Não encontrei janela de dupla execução.
- **Loops**: retries de provider limitados (`maxAttempts=2` para auditoria, config.ts:104-106; backoff capado em 60s, processing-jobs.ts:316-320); `drainProcessingQueue` limitado por batch e orçamento de runtime; falha de provider termina em estado terminal auditável (`PROCESSING_ATTEMPTS_EXHAUSTED`), atendendo o gate 8.
- **Transições inválidas**: guardas de versão/stage em `finalizeReadFailure` e finalização de auditoria (process-note-audit.ts:264-283, 435-461) impedem resultado obsoleto sobre escrever estado novo; revogação de capability pública substitui o hash, não apenas expira (public-capability.ts:38-43).
- **Injeção de prompt (camada determinística)**: regras universais consomem apenas campos tipados do schema; textos livres do documento não alcançam `eval`/caminho de execução. A superfície restante é a de RT-04 (texto influencia supressão de checagem) e RT-07 (texto da pergunta vira evidência).
- **Idempotência de contexto**: submissão pública com fingerprint + chave única + tratamento de corrida P2002 (context-questions.ts:299-453) — sem caminho para dupla reanálise.

## 5. Hipóteses não confirmadas (para rodadas futuras)

- Comportamento de `normalizeAuditContent` forçando `needsContext=true` (audit-client.ts:97-101) em combinação com respostas parciais do provider — exige gravações reais (WP-C offline) para validar.
- Efeito de `Decimal.toString()` em outros pontos de comparação além de RT-05 (datas/hora limite) — requer banco com dados representativos.
