# Harness Golden Cases — contrato e runner (WP-C)

Implementação do pacote **WP-C** do PRD `docs/harness/PRD_STABILIZATION_2026-08-21.md`:
contrato versionado de casos dourados e runner determinístico que executa o
Harness **offline** (replay de respostas gravadas, zero chamadas de rede).

## Comandos

```bash
# Executa os casos dourados e imprime o resumo legível
npm run evals:harness

# Usa outro arquivo de casos e grava o relatório JSON
npx tsx scripts/run-harness-evals.ts --cases <caminho.json> --out <relatorio.json>

# Testes unitários do contrato e do runner
npm run test:harness-evals
```

Código de saída: `0` quando todos os casos passam; `1` quando algum caso
falha; `2` para erro de leitura ou de contrato.

## Contrato versionado

Arquivo: `src/lib/audit-harness/evals/golden-case-schema.ts`
Versão atual: `1.0.0` (`GOLDEN_CASES_CONTRACT_VERSION`).

Um arquivo de casos contém `{ contractVersion, cases: [...] }`. Cada caso:

| Campo | Descrição |
| --- | --- |
| `contractVersion` | literal `"1.0.0"` |
| `id` | identificador kebab-case único |
| `title`, `category` | descrição e categoria do corpus (PRD §4) |
| `input.invoice` | extração sintética no formato `HarnessInvoice` |
| `input.workRules` | parâmetros de obra **fornecidos** ao caso |
| `input.duplicates` | candidatos de duplicidade sintéticos |
| `input.aiDiscovery` | resposta gravada para replay offline (opcional) |
| `input.now` | data fixa (`YYYY-MM-DD`) que garante determinismo |
| `expectations` | classificação aceitável, achados e perguntas obrigatórios/proibidos, cobertura mínima, fragmentos OCR proibidos na saída e `maxSemanticDuplicates` |
| `onlineBudget` | opcional; custo/latência máximos para execução online opt-in (ignorado offline) |

Regras do contrato:

- Todo conteúdo é **sintético**. Nenhum fornecedor real, número de nota real,
  nome de arquivo, placa ou valor de caso real pode entrar nos fixtures.
- PDFs reais e segredos não são lidos pelo runner; nada é baixado nem chamado.

## Validações do runner

Arquivo: `src/lib/audit-harness/evals/runner.ts`

Por caso, além das expectativas declaradas:

1. `schemaValidity` — achados produzidos validam contra `harnessFindingSchema`.
2. `classification` — classificação dentro das aceitáveis.
3. `requiredFindings` / `forbiddenFindings` — códigos obrigatórios presentes e
   proibidos ausentes.
4. `requiredContextQuestions` / `forbiddenContextQuestions` — perguntas de
   contexto válidas e proibidas; inclui gate independente que reprova qualquer
   pergunta emitida que contenha contradição objetiva (dois valores ou datas no
   próprio anexo), reforçando a promoção já feita pelo engine.
5. `evidenceTraceability` — todo achado com severidade diferente de `INFO`
   precisa de evidência rastreável (`isSupportedFinding`).
6. `totalMismatchRequiresCompleteCoverage` — `TOTAL_MISMATCH` só é aceito com
   cobertura `COMPLETE` dos itens.
7. `workRuleOnlyWithSuppliedParameters` — achado de `WORK_RULE` exige regra
   fornecida na entrada do caso.
8. `semanticDuplication` — duplicatas semânticas ≤ `maxSemanticDuplicates`
   (mesma chave de deduplicação do engine).
9. `noSecretOrInternalReasoning` — payload público persistido não contém
   chaves sensíveis nem raciocínio interno (`sanitizeForPersistence`).
10. `requiredCoverageAreas` — comprova que o cenário exercitou as áreas
    declaradas, evitando fixture que passa sem testar a regra pretendida.
11. `forbiddenOutputFragments` — texto não confiável do OCR, como instruções
    injetadas no documento, não pode reaparecer no payload público do Harness.

O relatório JSON agrega as métricas do PRD §5 que são computáveis offline:
acurácia de classificação, validade de schema, violações de evidência, achados
proibidos, taxa de duplicação semântica e violações de perguntas de contexto.
Campos de custo/latência aparecem como telemetria não avaliada (`evaluated:
false`) no modo offline; nenhum provedor é chamado.

## Fixtures atuais

`src/lib/audit-harness/evals/__fixtures__/golden-cases.v1.json` — 20 casos
sintéticos cobrindo: NF-e consistente, bebida alcoólica, higiene pessoal,
documento ilegível (`READ_FAILED`), reembolso composto com cobertura parcial
sem `TOTAL_MISMATCH`, `TOTAL_MISMATCH` com cobertura completa, contradição
objetiva promovida a achado, pergunta de contexto externo legítima,
duplicidade real e regra de obra com parâmetro fornecido.
Também há fixtures dedicados para nota de serviço, nota com comprovante,
combustível com relatório, near-duplicate legítimo, bruto/líquido com retenção,
resumo multipágina sem dupla contagem, item bônus de valor zero com desconto
global, prompt injection no OCR, múltiplos CNPJs em papéis legítimos e fronteira
de data/fuso. Todos usam dados genéricos e executam sem rede.

## Garantias

- Determinístico: sem relógio de parede, sem aleatoriedade, sem rede;
  execuções repetidas produzem o mesmo JSON.
- Não altera prompt, regra, schema ou modelo de produção; apenas consome
  `evaluateHarness`.
- Execução online opt-in ficará em rodada futura: o contrato já carrega os
  campos opcionais de orçamento, mas o runner atual recusa-se a chamar
  provedores.

## Relatório offline verificado — 2026-08-21

- Corpus: 20 casos, 20 aprovados e 0 reprovados.
- Acurácia declarada: 100%; validade de schema: 100%.
- Violações de evidência, achados proibidos, perguntas, cobertura e propagação
  de texto OCR: 0.
- Duplicação semântica acima do limite: 0%.
- Telemetria: 0 chamadas de provedor; custo e latência não avaliados offline.
