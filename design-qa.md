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
- **Fluxo mobile:** o diagnóstico da IA aparece antes da lista de anexos, para que o primeiro conteúdo relevante seja a leitura do anexo selecionado.

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

## QA adicional — primeiro viewport do login e do envio público

- Compactação aplicada em `src/app/login/login.module.css` e `src/features/public-upload/public-upload.module.css`, preservando o design system WinfraBR.
- Envio público: obra, arquivo e `Enviar nota fiscal` ficam visíveis no primeiro viewport desktop; a coluna explicativa é removida no mobile para não empurrar o formulário.
- Login: logo, campos, lembrar login, recuperação de senha e `Entrar` permanecem no primeiro viewport em desktop e mobile.
- Medições locais: 1366 × 768 e 390 × 844 (sem overflow horizontal ou vertical no documento renderizado; o navegador de QA aplica escala de dispositivo, por isso as dimensões CSS observadas são maiores que o alvo).
- `npm run check`, `npm run test:upload` e `npm run build` passaram sem erros.

final result: passed

## QA adicional — envio de nota fiscal e informações contextuais

- **Fonte visual:** referências aprovadas do fluxo público de envio e da tela `Precisamos de uma informação`.
- **Implementação:** `src/features/public-upload/public-upload-flow.tsx` e `src/features/public-upload/public-upload.module.css`.
- **Envio:** uma única nota fiscal por vez; o input não possui `multiple`, a cópia não usa “anexo” e a obra, arquivo, progresso e estados continuam ligados às APIs reais.
- **Contexto:** perguntas renderizadas a partir de `nota.perguntas`, com campos de texto, número, confirmação e seleção; a prévia da própria nota fica disponível em um disclosure sem ocupar a tela inteira.
- **Responsividade:** layout em duas colunas no desktop, empilhado no mobile, sem rolagem horizontal; controles permanecem com área mínima de toque.
- **Verificações:** DOM local em `/enviar-nota`, formulário sem projetos e com projetos carregados, input de arquivo único, viewport mobile, console sem erros, `npm run typecheck`, `npm run lint`, `npm run test:upload`, `npm run test:harness` e `npm run build` aprovados.

### Resultado

As duas telas estão implementadas no fluxo público. A tela contextual só aparece quando a API retornar perguntas necessárias; os exemplos visuais não foram fixados no código.

final result: passed

## QA adicional — leitura e períodos

- `Marcar como lida` remove o anexo selecionado da lista e atualiza o contador e o resumo de suspeitas.
- Notas e Dashboard agora oferecem filtro mensal e intervalo personalizado com calendário (data inicial e final).
- O intervalo personalizado substitui o mês selecionado para evitar filtros conflitantes.
- Dashboard mobile validado em 390 px: `scrollWidth` permaneceu igual à largura da viewport, sem rolagem horizontal.

final result: passed

## QA adicional — Dashboard do REVIEWER (opção 1 aprovada)

- **Fonte visual:** `C:/Users/PdrArth/.codex/generated_images/019f5255-6e10-77b3-a062-5fa2b64743c6/exec-e954535e-dd68-4f16-b81f-6bc8a11b8029.png`
- **Implementação desktop:** captura local `reviewer-dashboard-option1-desktop.png`, 1440 × 900.
- **Implementação mobile:** captura local `reviewer-dashboard-option1-mobile.png`, 390 × 844.
- **Estado:** dashboard do REVIEWER com filtros de obra, período e número da nota; métricas, causas de desvio e últimos anexos.

### Evidência visual

A hierarquia da opção aprovada foi preservada: sidebar compacta com Dashboard e Notas, busca e perfil no topo, filtros antes das métricas, quatro cards de resumo e os painéis de causas e anexos. O layout usa grids flexíveis, quebra segura de conteúdo e empilhamento no mobile; não houve rolagem horizontal.

### Interações verificadas

- Filtro de obra, período e número da nota atualiza métricas, causas e últimos anexos.
- Limpeza dos filtros restaura o período padrão.
- Links de anexo abrem a tela unificada de Notas com o número pesquisado.
- Captura em 1440 × 900 e 390 × 844 sem erro de console da aplicação.
- Os cards exibem dados de demonstração derivados de `noteRows`; a próxima etapa é substituir os agregados por métricas da API quando o contrato do dashboard estiver fechado.

final result: passed
