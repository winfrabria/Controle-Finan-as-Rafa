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

---

## QA final — estabilização do Harness e evidências (2026-08-29)

### Referência e implementação

- Referência visual: `C:\Users\PdrArth\AppData\Local\Temp\codex-clipboard-0421f1cb-4bdd-408a-85e3-2a5f29e89351.png`.
- Implementação local: `http://localhost:3001`, branch `codex/stabilize-universal-docs`.
- Capturas: `artifacts/qa/reviewer-harness-1-finding-2048.png`, `artifacts/qa/reviewer-harness-4-findings-2048.png` e `artifacts/qa/note-detail-harness-4-findings-2048.png`.
- A lista mantém a hierarquia compacta alaranjada da referência; a análise detalhada usa duas áreas e remove a terceira coluna permanente de evidências.

### Casos e interações validados

- Caso real com 1 achado: a comparação legada sem base verificável passou a exibir `Valores encontrados`, sem inventar valor esperado.
- Caso real com 4 achados: datas e valores conflitantes aparecem neutros; o item 12 mostra R$ 40,00 e R$ 44,50 sem escolher uma referência arbitrária.
- Campos obrigatórios explícitos: `7 campos obrigatórios vazios`, dois exemplos e referência `Campos obrigatórios preenchidos`.
- Metadados internos `documentRole`, `boundingBox` e `requirementBasis`: ausentes do conteúdo do REVIEWER.
- Navegação anterior/próximo: passou nos quatro achados.
- Feedback: abriu como card recolhível; nenhum feedback foi enviado.
- Botão grande `Marcar como lida`: presente; o POST não foi disparado para preservar os dados de teste.
- Overflow horizontal: ausente nos viewports desktop capturados.
- Console das telas de lista e detalhe: nenhum erro ou aviso.
- A base atual possui no máximo 4 achados por nota. O comportamento de lista não impõe limite ou truncamento e os formatadores cobrem listas extensas, mas o QA visual de 10+ achados exige um novo documento com esse estado; nenhum dado artificial foi inserido no banco.

### Verificação técnica

- `npm run test:harness`: 236 testes, 233 aprovados, 3 integrações ignoradas por dependerem do banco, 0 falhas.
- `npm run test:pwa`: 36/36.
- `npm run test:upload`: 47/47.
- `npm run test:note-detail`: 10/10.
- `npm run check`: passou sem avisos.
- `npm run build`: passou, com 44 rotas geradas.
- `npm run evals:harness:plan`: 8 modelos e 20 casos, sem chamadas pagas. As rodadas online permanecem pendentes por crédito do provedor e não alteram o modelo de produção.

### Escopo preservado

- Telas exclusivas atuais do PWA não foram redesenhadas nesta etapa.
- Nenhum commit, push ou deploy foi executado.
- Nenhuma nota foi apagada ou alterada durante o QA.

final result: passed

---

## QA local — Harness verificado e achados compactos (2026-08-29)

### Fonte e implementação

- **Referência visual aprovada:** `C:/Users/PdrArth/AppData/Local/Temp/codex-clipboard-0421f1cb-4bdd-408a-85e3-2a5f29e89351.png`.
- **Implementação comparada:** `C:/Users/PdrArth/AppData/Local/Temp/codex-clipboard-af3d3f9a-e90b-40be-a26a-b5bedb4c1148.png`.
- **Tela pública verificada ao vivo:** `/enviar-nota`, ambiente local na porta 3001.
- **Estado desktop:** lista de achados, encontrado em vermelho, referência em verde e evidências em cartões claros.

### Ajustes desta rodada

- Campos obrigatórios extensos passaram a mostrar contagem e no máximo dois exemplos no resumo.
- Comparações longas são compactadas no cartão; o conteúdo integral continua disponível no detalhe.
- O painel rápido mostra no máximo dois locais de evidência e informa quantos locais adicionais existem.
- Feedback permanece em cartão recolhível e a análise detalhada oferece a ação grande `Marcar como lida`.
- O seletor público de obra foi exercitado com busca por cidade e retornou somente a obra correspondente.

### Verificação técnica

- `npm run test:harness`: 227 aprovados, 3 ignorados por dependência de banco, 0 falhas.
- `npm run test:upload`: 44/44.
- `npm run test:note-detail`: 10/10.
- `npm run test:pwa`: 36/36.
- `npm run test:push`: 40/40.
- `npm run check`: passou após regenerar os tipos temporários do Next.js.
- `npm run build`: passou, com 44 páginas geradas.
- Console da tela pública: sem erros ou alertas de aplicação.

### Limitação conhecida

A tela autenticada pós-limpeza ainda não possui uma nota processada para produzir uma nova captura equivalente. A comparação final com dados reais deve ser repetida depois do primeiro upload de teste do usuário; nenhuma credencial foi transmitida automaticamente.

final result: BLOCKED — aguardando o primeiro upload de teste para a captura autenticada final

---

## QA visual — envio público PWA para aprovação

### Protótipos

- **Envio único:** SuperDesign `c2c96784-a261-4deb-8fc9-7d331153958c`, versão 3.
- **Múltiplos documentos:** SuperDesign `d2e1e67d-697c-45b8-b9a8-87a62b375093`, versão 1.
- Ambos permanecem como protótipos de aprovação; não foram integrados ao código nem publicados em produção.

### Verificações

- Viewports `390 × 844` e `320 × 844`, sem rolagem horizontal.
- Busca e troca de obra verificadas.
- Envio único: processamento, falha técnica, reenvio do mesmo arquivo e sucesso verificados.
- Envio múltiplo: fila de documentos, resultado parcial, falha independente, reenvio somente do arquivo com falha e sucesso final verificados.
- A ação principal permanece fixa e respeita a área segura inferior.
- A única falha de console observada foi o `favicon.ico` do domínio de prévia do SuperDesign; não pertence ao protótipo.

final result: passed

---

## QA adicional — envio público V1 aprovado e proposta V2 com múltiplos documentos

### Referência e implementação V1

- Referência aprovada no SuperDesign: draft `aca2bef8-ba21-440a-a860-a07aa30973f9`.
- Rota implementada: `/enviar-nota`.
- Comparação visual em estado equivalente e viewport de 1440 × 900: `winfra-enviar-nota-v1-comparacao.png`.
- O formulário mantém o design system WinfraBR e apresenta busca de obra por nome, código ou cidade, documento selecionado, remoção/troca de arquivo e ação principal no primeiro viewport.
- Diferenças intencionais em relação ao protótipo: limite real de 10 MB e dados reais carregados pela API de obras.

### Estados de erro e retomada

- Falha técnica mostra `Falha de processamento` sem culpar o arquivo e permite `Reenviar este arquivo`.
- Falha de leitura mostra `Falha de leitura` e permite `Escolher outro arquivo`.
- `Enviar outra nota` limpa o arquivo e preserva a obra já selecionada.
- O reenvio do mesmo arquivo foi validado por interceptação local: duas chamadas POST distintas foram disparadas sem trocar o documento.

### V2 para múltiplos documentos

- Protótipo separado no SuperDesign: draft `ce836165-0ecb-4739-8464-d37d4042925d`.
- A fila mantém um estado independente por documento: pronto, enviando, enviado ou com erro.
- Um erro não invalida os demais documentos; é possível reenviar apenas o item que falhou ou removê-lo.
- A tela de resultado parcial informa quantos documentos foram enviados e quais precisam de nova tentativa.
- A V2 permanece somente como protótipo e não foi integrada à aplicação nesta etapa.

### Verificações

- Busca e seleção de obra: passou.
- Seleção, troca e remoção de arquivo: passou.
- Falha técnica, reenvio do mesmo arquivo e novo envio: passou.
- Falha de leitura e escolha de outro arquivo: passou.
- V1 mobile em 390 × 844 e 320 × 844 sem rolagem horizontal: passou.
- V2 mobile em 390 × 844, com fila e retomada individual: passou.
- Console local: nenhum erro da aplicação.
- `npm run test:upload`: 42/42.
- `npm run test:pwa`: 36/36.
- `npm run lint`: passou.
- `npm run typecheck`: passou.
- `npm run build`: passou.

final result: passed

---

## QA local — estabilização e redesign dos achados (2026-08-24)

### Referência e implementação

- **Referência aprovada:** SuperDesign, projeto `36e4cfa9-5e43-437d-a551-51f06b47b947`, draft `e2ca8c27-dc53-4244-89e3-b2520c7a9a97`.
- **Implementação local:** `http://localhost:3001`, branch `codex/stabilize-universal-docs`.
- **Desktop:** duas áreas permanentes — lista compacta de achados e achado selecionado — sem terceira coluna fixa.
- **PWA:** um achado por vez, evidência em tela cheia e navegação fixa respeitando a safe area.
- **Comparação:** encontrado primeiro em vermelho; referência esperada depois em verde.
- **Erros públicos:** falha técnica de processamento e falha real de leitura possuem mensagens distintas.

### Verificações concluídas

- Envio público abriu sem erro de aplicação; a API de obras respondeu e a seleção de obra funcionou.
- `npm run typecheck`: passou.
- `npm run lint`: passou.
- `npm run test:upload`: 42/42.
- `npm run test:pwa`: 36/36.
- `npm run test:note-detail`: 10/10.
- `npm run test:harness`: 200 aprovados, 3 ignorados por dependência de banco, 0 falhas.
- `npm run build`: passou, com 44 rotas geradas.

### Findings

- **P0:** nenhum encontrado nos testes automatizados e no fluxo público acessível.
- **P1 — QA visual autenticado bloqueado:** a comparação final das telas reais de Notas e Análise da IA, em desktop e PWA, exige uma sessão REVIEWER autenticada no navegador local. Não foram transmitidas credenciais automaticamente.
- **P2:** nenhum desvio estrutural identificado na revisão de código; o julgamento visual final depende do estado autenticado acima.

### Como desbloquear a validação visual final

Entrar manualmente como REVIEWER em `http://localhost:3001` e validar a tela de Notas e uma Análise da IA com achados em 1440 × 900, 390 × 844 e 320 × 844. Até essa confirmação, esta entrega permanece somente no ambiente local e não deve ser enviada à produção.

final result: BLOCKED

---

## QA final — navegador compacto dos achados no PWA (2026-08-23)

### Referência e comparação

- Figma: `https://www.figma.com/design/yeZFBPpGW05JTEszxANZVZ`, node `2:3`.
- Captura da referência: `.codex-temp/figma/mobile-final.png`.
- Captura renderizada: `.codex-temp/browser/mobile-qa-viewport.png`.
- Comparação lado a lado: `.codex-temp/mobile-comparison.png`.
- Estado: REVIEWER, nota suspeita com três achados, primeiro achado expandido.

### Ajuste aprovado

- A navegação grande no rodapé de cada achado foi removida.
- O seletor agora fica antes da lista, com contador, título do achado atual e duas ações compactas de 44 × 44 px.
- Só um achado permanece expandido; avançar ou voltar atualiza e aproxima o card selecionado.
- A ação fixa `Marcar como lida` continua independente e não conflita com a navegação.

### Verificações

- Próximo achado: abriu o achado 2 e atualizou o contador para `2 de 3`.
- Voltar/próximo: ambos habilitados no estado intermediário e desabilitados corretamente nos extremos.
- Áreas de toque dos dois botões: 44 × 44 px.
- Overflow horizontal: 0 px no viewport mobile testado.
- A captura comparativa confirmou a mesma hierarquia visual da referência, com a alteração intencional do navegador inferior para o controle compacto superior aprovado pelo usuário.
- P0: nenhum.
- P1: nenhum.
- P2: nenhum.

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

---

## QA adicional — detalhe mobile da nota

### Referência e estado testado

- Referência aprovada: `C:\Users\PdrArth\.codex\generated_images\01a00083-0590-7b23-acee-4174e1357a74\exec-c3f70249-428b-4413-91db-1915bb1d58f7.png`.
- Rota real autenticada: `/notas/897f8d33-a307-43ab-843e-b171c855df08/analise-ia`.
- Viewport: `390 × 844`.
- Estado: nota suspeita real com oito achados, primeiro achado expandido e ação fixa do revisor.

### Resultado visual

- A hierarquia da referência foi preservada: barra compacta, diagnóstico primeiro, um achado expandido, demais achados recolhidos, resumo da nota, dados extraídos e ação fixa.
- Os comparativos usam rótulo semântico para presença de item contratual (`Item previsto no contrato` / `Item encontrado na nota`) e mantêm `Esperado` / `Encontrado` para valor, quantidade e data.
- Não houve rolagem horizontal no viewport testado (`scrollWidth` igual ao `clientWidth`).
- O conteúdo real permaneceu legível com oito achados e textos longos.

### Interações verificadas

- Accordion de achados: passou.
- Navegação Anterior/Próximo e contador: passou.
- Abertura e fechamento da nota fiscal: passou.
- Expansão de dados extraídos: passou.
- A ação `Marcar como lida` permaneceu visível; o POST não foi disparado para não alterar o dado compartilhado durante o QA.

### Verificação técnica

- `npm run test:note-detail`: 5/5.
- `npm run test:pwa`: 28/28.
- `npm run test:upload`: 35/35.
- `npm run check`: passou.
- `npm run build`: passou.

final result: passed
