# Design QA — WinfraBR

Data: 2026-07-12

Browser: Google Chrome

Branch: `NewDesingPc`

## Referências e comparações finais

- Obras ADMIN: `G:\Downloads\Winfrabr\Telapc\telacadastraobraadmpc.png` × `artifacts/qa/obras-admin-final-1440.png` e `artifacts/qa/obras-admin-final-390.png`.
- Histórico de validações: `C:\Users\PdrArth\AppData\Local\Temp\codex-clipboard-a116fecb-76d1-4ab5-8c0a-16732f2afba4.png` × `artifacts/qa/historico-final-1440.png`.
- Validações: `G:\Downloads\Winfrabr\Telapc\telavalidacaorafapc.png` × `artifacts/qa/validacoes-final-1366.png`, `artifacts/qa/validacoes-final-390.png` e `artifacts/qa/validacoes-comentario-500.png`.
- Auditoria comparativa ADMIN: `C:\Users\PdrArth\AppData\Local\Temp\codex-clipboard-339ede29-19e1-42d0-bd03-949e21079fcc.png` × `artifacts/qa/auditoria-admin-final-1440.png`.
- Análise completa da IA: `C:\Users\PdrArth\AppData\Local\Temp\codex-clipboard-895cee1a-67f4-49cb-b424-fc1a45eb6edb.png` × `artifacts/qa/analise-ia-final-1440.png` e `artifacts/qa/analise-ia-final-390.png`.
- Envio público e resultado: `artifacts/qa/enviar-nota-final-1440.png` e `artifacts/qa/enviar-nota-final-390.png`.
- Comparações lado a lado: `artifacts/qa/compare-obras-final.png`, `artifacts/qa/compare-historico-final.png`, `artifacts/qa/compare-validacoes-final.png`, `artifacts/qa/compare-auditoria-final.png` e `artifacts/qa/compare-analise-final.png`.

## Viewports e estados verificados

- 390 × 844: Obras, Validações, Análise completa e Envio público em cards, sem rolagem horizontal.
- 768 × 1024 e 1024 × 768: breakpoints intermediários sem sidebar permanente e sem tabelas saindo da viewport.
- 1366 × 768: lista de validações com rolagem interna, comentário de 500 caracteres e ação de salvar sempre visível.
- 1440 × 900: Obras, Histórico, Auditoria comparativa, Análise completa e Envio público.
- Obras usam dados reais do banco; os quatro registros atuais não têm responsável legado definido.
- Histórico usa exclusivamente validações reais; como o banco não possui decisões concluídas no momento, o estado vazio e as métricas zeradas são esperados.
- Auditoria ADMIN: menu Mais ações, reprocessamento, logs e modal de custo foram exercitados.
- Upload: mapeamento dos estados terminais e timeout de 90 segundos está coberto por teste unitário.

## Correções feitas durante o QA

- Validações: compactação para viewport baixa, crescimento automático do comentário e rodapé interno fixo.
- Obras mobile: métricas passaram para uma coluna e a lista para cards legíveis.
- Auditoria ADMIN: quebra segura de valores longos nos achados e remoção da rolagem horizontal.
- Análise completa: grades `minmax(0, ...)`, itens em cards no mobile e breakpoints não conflitantes.
- Envio público: remoção de `overflow: hidden`, correção do `box-sizing` mobile e rolagem vertical natural.

## Resultado anterior

- Nenhuma das seis telas apresenta rolagem horizontal nos viewports verificados.
- Histórico não expõe confiança, custos, prompts ou dados técnicos para ADMIN nem REVIEWER.
- Confiança, custos, tokens, latência e esforço permanecem apenas na auditoria e nos logs exclusivos de ADMIN.
- O aviso de hidratação observado no Chrome é causado pela extensão ProtonPass (`data-protonpass-form`) alterando o DOM antes da hidratação; não foram encontrados erros de aplicação nas telas verificadas.
- As referências foram comparadas lado a lado com as capturas finais após as correções.

## QA adicional — tela unificada de notas

- **Fonte visual:** `C:/Users/PdrArth/.codex/generated_images/019f5255-6e10-77b3-a062-5fa2b64743c6/exec-b3df7e73-64a9-49b9-9864-4383d9330863.png`
- **Implementação desktop:** `F:/winfra-rafael/.codex/reviewer-notes-desktop.png`
- **Implementação mobile:** `F:/winfra-rafael/.codex/reviewer-notes-mobile.png`
- **Estado:** reviewer, tela unificada `Notas`, anexo suspeito selecionado, diagnóstico da IA aberto.
- **Desktop:** fonte e captura em 1440 × 1024 px, CSS 1440 × 1024, `deviceScaleFactor` 1.
- **Mobile:** captura em 390 × 844 px CSS, sem moldura de dispositivo.

### Evidência visual

A comparação do quadro completo confirma a mesma hierarquia aprovada: navegação compacta, busca e filtros no topo, lista de anexos à esquerda e diagnóstico da IA à direita. A implementação mantém a leitura da evidência dentro do painel selecionado, com esperado/encontrado, justificativa, dados extraídos e acesso ao detalhe. A diferença de quantidade de anexos e textos é intencional, pois a captura usa os dados disponíveis no ambiente e a fonte é uma composição visual.

No recorte de detalhe, tipografia, espaçamento, estados `Suspeita`/`OK`/`Em análise`, cores semânticas e ações ficam legíveis. O painel de achados tem rolagem interna para preservar as ações e o rodapé no desktop; no mobile os cards empilham sem rolagem horizontal.

### Interações verificadas

- Busca por número/fornecedor e limpeza dos filtros.
- Filtro por período e status.
- Seleção de anexos e atualização do diagnóstico exibido.
- Abertura de `Dados extraídos` e link `Ver nota detalhada`.
- Layout responsivo em 1440 × 1024 e 390 × 844; no mobile a rolagem é vertical e não há overflow horizontal.
- O botão `Marcar como lida` está implementado com estado local e troca para `Marcada como lida`; persistência no backend fica para a etapa de notificações.
- Console sem erro de aplicação durante a captura local; `npm run typecheck`, `npm run lint` e `npm run build` passaram.

### Histórico da comparação

1. **Primeira captura:** o reviewer ainda expunha a navegação antiga de validações/histórico e links para essa área.
2. **Correção aplicada:** reviewer passou a usar a tela unificada; atalhos, notificações e ajuda foram direcionados para `Notas`, mantendo validações apenas no ADMIN.
3. **Captura final:** desktop e mobile sem P0/P1/P2 acionáveis; evidência visual registrada nos caminhos acima.

### Findings

Não há diferenças P0, P1 ou P2 pendentes. O uso de dados de demonstração e a persistência futura de “marcar como lida” são limitações de escopo, não desvios visuais desta entrega.

### Follow-up polish

- Conectar `Marcar como lida` ao endpoint de notificações quando a regra de leitura for definida.
- Ajustar a densidade da lista quando o volume real de anexos estiver disponível.

final result: passed
