# Correção determinística de reconciliação

Data: 21/08/2026
Branch: `codex/harness-fix-reconciliation`
Base de auditoria: PRD de estabilização e red team Ox de 21/08/2026

## Escopo corrigido

- cobrança agregada não é somada novamente como item de suporte;
- pagamentos parcelados são deduplicados e somados antes da comparação;
- desconto só reconcilia aritmética quando possui valor numérico verificável;
- identidade e valor monetário de duplicatas são normalizados;
- contradição já coberta por regra determinística não gera segundo achado;
- lacunas de cobertura só suprimem divergência total na mesma camada ou grupo;
- `TOTAL_MISMATCH` é bloqueado para qualquer fonte sem cobertura `COMPLETE`.

## Decisão canônica de RT3

Quando todos os itens possuem `countsTowardDocumentTotal: false`, a camada
contabilizável está vazia. Esse estado invalida a alegação de cobertura
completa: o Harness não emite `TOTAL_MISMATCH`, não declara a área `TOTALS`
como coberta e deve depender de reextração/limitação segura. Somar todos os
itens como fallback poderia reintroduzir dupla contagem em documentos compostos.

## Fora do escopo

RT7 e o fluxo de perguntas de contexto não foram alterados nesta branch.
