# Referência de interface do MVP

Documento de trabalho da WIN-35. Ele transforma as 21 imagens de referência em uma especificação funcional para o frontend, sem tornar os mockups uma fonte literal de dados, textos ou regras de negócio.

## 1. Escopo e regras de leitura

- Referências mobile: 10 imagens entregues na pasta externa `telacell`, todas com 941 × 1672 px.
- Referências desktop: 11 imagens entregues na pasta externa `Telapc`, todas com 1448 × 1086 px.
- As imagens não devem ser copiadas para o repositório ou para o Linear. Este documento é a fonte compartilhada para implementação.
- Nomes de obras, fornecedores, valores, quantidades, distâncias, datas, textos de rodapé e números de notas são conteúdo ilustrativo.
- Variações de logotipo, slogan e ilustrações de fundo devem ser normalizadas com os ativos oficiais quando eles existirem.
- As regras das issues prevalecem sobre detalhes visuais dos mockups. Em especial, a falha de leitura da WIN-22 não é uma nota suspeita, e as decisões humanas da WIN-29 são mais completas que o seletor binário desenhado nas referências.

## 2. Inventário das referências

### Mobile

| ID | Arquivo, na ordem numérica | Tela | Elementos e estado principal | Issue |
| --- | --- | --- | --- | --- |
| M01 | `...14_57_05 (1).png` | Login | E-mail, senha, exibir/ocultar senha, recuperação, entrar e acesso alternativo ao envio público | WIN-16 |
| M02 | `...14_57_05 (2).png` | Seleção de obra | Lista vertical de obras com ícone, nome, local e ação por linha | WIN-18 |
| M03 | `...14_57_05 (3).png` | Upload | Obra selecionada, área de arquivo, formatos/tamanho, dicas e CTA | WIN-18 |
| M04 | `...14_57_05 (4).png` | Processamento | Progresso por etapas: arquivo recebido, extração e análise | WIN-18; apoio às WIN-20 e WIN-26 |
| M05 | `...14_57_05 (5).png` | Sucesso de envio | Confirmação, resumo da obra e arquivo, novo envio e retorno | WIN-18 |
| M06 | `...14_57_05 (6).png` | Falha de leitura | Erro, contexto do envio, orientação de nova captura e reenvio | WIN-22 |
| M07 | `...14_57_05 (7).png` | Dashboard | KPIs, distribuição por status, pendências, notas recentes e navegação inferior | WIN-27 |
| M08 | `...14_57_05 (8).png` | Lista de notas | Filtros compactos e cartões de nota com status e acesso ao detalhe | WIN-27 |
| M09 | `...14_57_05 (9).png` | Fila de validações | Busca/filtros, KPIs e cartões de suspeitas com motivo e CTA analisar | WIN-27; WIN-29 |
| M10 | `...14_57_05 (10).png` | Detalhe e validação | Resumo, prévia, dados extraídos, explicação da IA e formulário de decisão | WIN-28; WIN-29 |

### Desktop

| ID | Arquivo, em ordem cronológica | Tela | Elementos e estado principal | Issue |
| --- | --- | --- | --- | --- |
| D01 | `...14_55_37 (1).png` | Login | Faixa institucional lateral e cartão central de autenticação | WIN-16 |
| D02 | `...14_55_38 (2).png` | Seleção de obra | Grade de obras e link secundário de contato | WIN-18 |
| D03 | `...14_55_38 (3).png` | Upload | Stepper, obra selecionada, dropzone, seleção de arquivo e dicas | WIN-18 |
| D04 | `...14_55_38 (4).png` | Processamento | Percentual, progresso por etapas e aviso de processamento | WIN-18; apoio às WIN-20 e WIN-26 |
| D05 | `...14_55_38 (5).png` | Sucesso de envio | Confirmação central, contexto do envio e ações de continuidade | WIN-18 |
| D06 | `...14_56_02 (1).png` | Dashboard | Sidebar, busca global, KPIs, gráfico, tabela recente, pendências e insights | WIN-27 |
| D07 | `...14_56_03 (2).png` | Lista de notas | KPIs, filtros avançados, tabela, ações e paginação | WIN-27 |
| D08 | `...14_56_03 (3).png` | Fila de validações | KPIs, filtros, tabela de suspeitas e CTA analisar | WIN-27; WIN-29 |
| D09 | `...14_56_03 (4).png` | Detalhe suspeito | Documento, campos extraídos, explicação da IA e validação lado a lado | WIN-28; WIN-29 |
| D10 | `...14_56_03 (5).png` | Resultado OK | Documento, dados extraídos, resumo positivo, histórico e eventos | WIN-28 |
| D11 | `...14_56_15.png` | Falha de leitura | Erro central, resumo do envio, orientação e reenvio | WIN-22 |

## 3. Arquitetura dos fluxos

### 3.1 Envio público, sem login

1. **Entrada:** o engenheiro acessa diretamente o envio público ou usa “Ir para envio de nota” no login.
2. **Seleção de obra:** escolhe uma obra pré-cadastrada. Sem obra, não avança. A interface pode usar lista no mobile e grade no desktop, mas deve preservar a mesma informação e ordem de foco.
3. **Upload:** confirma a obra e envia um único PDF, JPG ou PNG. Deve poder trocar a obra antes de enviar.
4. **Validação local:** bloqueia ausência de arquivo, formato não aceito e tamanho acima do limite configurado. A referência mostra 10 MB; esse valor deve vir da regra real do backend/configuração.
5. **Transferência:** mostra progresso de upload quando mensurável e impede duplo envio.
6. **Processamento:** informa etapas reais do backend. Não inventar percentual quando a API só expuser estados; nesse caso usar indicador indeterminado e texto de etapa.
7. **Conclusão:** sucesso oferece “Enviar nova nota” e “Voltar ao início”. Falha de leitura oferece orientação acionável e reenvio, preservando a obra quando seguro.

Rotas públicas e nomes finais ficam a cargo da implementação, mas seleção, upload, processamento, sucesso e falha devem aceitar acesso sem sessão, conforme WIN-16 e WIN-18.

### 3.2 Área interna, com login

1. **Login:** Rafael ou usuário WinfraBR autentica; credenciais inválidas permanecem no formulário com mensagem contextual.
2. **Dashboard:** resume volume, valor e distribuição das notas e destaca a fila que exige decisão.
3. **Notas:** filtros refinam a lista; abrir uma linha leva ao detalhe sem perder o contexto anterior.
4. **Validações:** mostra somente itens que exigem ação humana, com o motivo principal visível.
5. **Detalhe:** compara documento original, dados extraídos, itens, resumo/Markdown, achados, classificação, regra aplicada e histórico.
6. **Decisão humana:** registra decisão, motivo e comentário; após salvar, confirma persistência, atualiza status e mantém histórico imutável.

Dashboard, notas, validações e detalhe são protegidos. Sessão ausente ou expirada redireciona ao login e, após autenticar, retorna ao destino original quando possível.

## 4. Especificação por tela

### Login

**Estrutura:** área institucional, título, subtítulo, campos de e-mail e senha, controle de visibilidade, recuperação de senha, botão primário e acesso ao envio público. No desktop, a arte ocupa uma faixa lateral; no mobile, vira cabeçalho e o formulário ocupa um painel inferior.

**Estados:** vazio; preenchendo; senha visível/oculta; enviando; credenciais inválidas; campo inválido; indisponibilidade de autenticação; sessão expirada. Durante envio, bloquear repetição e preservar o e-mail. Mensagens de credencial ficam junto ao formulário e erros de campo junto ao campo.

### Seleção de obra

**Estrutura:** título, instrução e coleção de `ObraCard`. Cada item deve mostrar pelo menos nome e local; distância só aparece se for dado real e necessário. Mobile usa uma coluna; desktop usa grade responsiva.

**Estados:** carregando com skeleton; lista disponível; busca/filtro se o volume justificar; vazia; erro ao carregar; obra selecionada. A referência desktop mostra “Entre em contato”, mas esse canal só deve existir quando produto e conteúdo estiverem definidos.

### Upload

**Estrutura:** stepper no desktop ou título/retorno no mobile, resumo da obra, `FileDropzone`, restrições, dicas de legibilidade e CTA. Drag-and-drop é melhoria desktop; o seletor de arquivo continua obrigatório para teclado e mobile.

**Estados:** vazio; drag over; arquivo selecionado; arquivo inválido por formato; excede tamanho; leitura local falhou; enviando; upload interrompido; concluído. Mostrar nome, tamanho e ação de remover/trocar antes do envio. Não depender apenas de cor para erro.

### Processamento

**Estrutura:** indicador visual, título, texto de expectativa, lista de etapas e aviso sobre continuidade. Etapas visuais só podem representar estados reais: recebido, extraindo, analisando e finalizando.

**Estados:** aguardando início; ativo; etapa concluída; demora acima do esperado; concluído; falha de leitura; falha técnica recuperável. Se o processamento continuar em background, dizer claramente que o usuário pode sair e como verá o resultado. Não manter a tela presa a polling ilimitado.

### Sucesso

**Estrutura:** ícone semântico, confirmação, obra, nome do arquivo, CTA para novo envio e retorno. Sucesso significa que o envio foi recebido; não afirmar que a auditoria terminou se ela ainda estiver processando.

**Estados:** recebido e aguardando análise; análise concluída, quando houver confirmação real. O texto deve diferenciar os dois.

### Falha de leitura

**Estrutura:** ícone e título de erro, explicação em linguagem simples, obra/arquivo, recomendações específicas e CTA de reenvio.

**Estados cobertos pela WIN-22:** baixa confiança, imagem ilegível, foto ruim, PDF borrado ou ausência de campos mínimos. Esses casos recebem status próprio de falha de leitura, não entram na fila de Rafael e não são exibidos como suspeita. Falha de rede, timeout e erro interno usam mensagem técnica genérica e opção de tentar novamente, sem alegar que o documento é ilegível.

### Dashboard

**Estrutura:** shell autenticado, título/contexto, KPIs, distribuição por status, pendências, notas recentes e, no desktop, insights. KPIs mínimos derivados das referências: total, OK, suspeitas e pendentes de validação; valor analisado só entra se a métrica estiver definida.

**Interações:** período e obra afetam todos os módulos; cartões de status podem abrir a lista já filtrada; “Ver todas” preserva o filtro correspondente. Mobile empilha módulos e reduz a tabela recente a lista/cartões. Gráficos sempre têm legenda e equivalente textual.

### Lista de notas

**Estrutura:** busca, filtros de status/obra/período/fornecedor, contagem de resultados e coleção paginada. Desktop usa tabela; mobile usa cartões. Campos prioritários: número, fornecedor, obra, emissão, valor, status e acesso ao detalhe.

**Estados:** carregando; resultados; nenhum resultado sem filtros; nenhum resultado para filtros; erro; paginação; filtros aplicados e limpeza. Status previstos visualmente: OK, suspeita, pendente de validação, rejeitada e falha de leitura. A taxonomia final deve seguir o modelo de domínio.

### Fila de validações

**Estrutura:** KPIs da fila, busca/filtros, motivo principal, valor, data e CTA “Analisar”. Deve priorizar notas suspeitas ou incompatíveis que realmente pedem decisão humana.

**Estados:** fila com itens; vazia; filtros sem resultado; carregando; erro; item atualizado por outro usuário. Falha de leitura não aparece aqui. A ordenação padrão deve favorecer urgência/antiguidade, definida pelo produto, e ser visível ao usuário.

### Detalhe da nota

**Estrutura desktop:** cabeçalho/resumo; três áreas principais para prévia do original, dados extraídos e explicação/achados; seção de validação e histórico. **Estrutura mobile:** as mesmas áreas em sequência vertical, com seções recolhíveis quando necessário e ação de salvar acessível sem cobrir conteúdo.

**Conteúdo obrigatório da WIN-28:** arquivo original; campos extraídos; itens da nota; Markdown ou resumo da extração; achados; classificação; regra usada; histórico básico e eventos. As referências mostram apenas parte desse conteúdo; “ver todos os campos” e “ver análise completa” devem expandir ou navegar sem perder contexto.

**Estados:** carregando; documento disponível; prévia indisponível com opção de baixar; extração parcial; sem achados/OK; suspeita; incompatível por falta de parâmetro; histórico; erro. Comparação entre original e extração deve continuar utilizável com zoom de navegador e teclado.

### Validação humana

O seletor visual `OK / Suspeita` das referências é apenas uma simplificação. A WIN-29 exige registrar decisões sobre o achado ou a nota com, no mínimo, as semânticas: apontamento correto, falso positivo, válido e suspeito confirmado. A implementação pode agrupar opções na interface, desde que o valor persistido seja inequívoco.

**Campos e comportamento:** decisão obrigatória; motivo obrigatório conforme regra de domínio; comentário opcional; resumo do que será alterado; salvar com estado de carregamento; confirmação de sucesso; erro preservando o formulário; conflito se outra validação ocorreu; usuário e data obtidos da sessão/sistema. Salvar acrescenta histórico e nunca altera o arquivo original nem apaga decisões anteriores.

## 5. Componentes reutilizáveis

| Componente | Responsabilidade | Variações principais |
| --- | --- | --- |
| `PublicShell` | Fundo institucional e painel de conteúdo | mobile com cabeçalho; desktop com faixa lateral ou superior |
| `AppShell` | Navegação, cabeçalho, usuário e área principal | sidebar desktop; barra inferior mobile |
| `BrandMark` | Marca consistente | completa, compacta, monocromática; usar ativo oficial |
| `PageHeader` | Título, descrição, retorno e ações | público e autenticado |
| `TextField` | Campo, rótulo, ajuda e erro | e-mail, senha, busca, texto |
| `Button` | Ações | primário, secundário, discreto, perigo; tamanhos normal e compacto |
| `ObraCard` | Seleção/resumo de obra | selecionável, resumo, lista, grade |
| `FileDropzone` | Seleção e validação de arquivo | vazio, hover/drag, selecionado, erro, enviando |
| `ProgressSteps` | Progresso do fluxo | horizontal desktop; vertical/compacto mobile; determinado/indeterminado |
| `FeedbackPanel` | Sucesso, falha e orientação | sucesso, aviso, erro técnico, falha de leitura |
| `MetricCard` | Número, contexto e tendência | neutro, sucesso, alerta, informativo |
| `StatusBadge` | Status textual e semântico | OK, suspeita, pendente, rejeitada, falha de leitura |
| `FilterBar` | Busca, filtros, período e limpeza | inline desktop; painel/drawer mobile |
| `NotesCollection` | Dados equivalentes em tabela ou cartões | tabela desktop; cartões mobile |
| `EmptyState` | Ausência de dados ou resultados | primeira utilização, filtro sem resultado, fila concluída |
| `DocumentPreview` | Visualização e download do original | PDF/imagem, zoom, indisponível |
| `ExtractedDataList` | Campos e itens extraídos | resumo, completo, parcial |
| `FindingCard` | Achado, regra e evidência | informativo, alerta, incompatibilidade |
| `ValidationForm` | Decisão humana | inicial, alterado, salvando, salvo, erro, conflito |
| `Timeline` | Processamento e histórico | sistema, IA e decisão humana |
| `Skeleton` | Carregamento sem salto de layout | card, tabela, detalhe, gráfico |

Todos os componentes interativos precisam de foco visível, nome acessível, estado disabled real e área de toque mínima de 44 × 44 px no mobile.

## 6. Estados transversais

Toda tela com dados remotos deve prever: inicial, carregando, sucesso com dados, vazio, erro recuperável e sessão expirada quando protegida. Toda mutação deve prever: pronta, enviando, sucesso, erro com dados preservados e proteção contra repetição.

Regras adicionais:

- **Loading:** skeleton para conteúdo estrutural; spinner para ações curtas; progresso real apenas quando mensurável.
- **Erro:** mensagem próxima da origem, descrição acionável e retry quando seguro.
- **Offline/rede instável:** não descartar arquivo selecionado ou validação digitada; informar o que ainda não foi salvo.
- **Concorrência:** no detalhe/validação, avisar se o status mudou desde o carregamento e exigir atualização antes de sobrescrever.
- **Permissão:** ocultar ou desabilitar ações conforme o papel, mas o backend continua sendo a autoridade.
- **Feedback:** toast serve para confirmação complementar; erros críticos e estados persistentes permanecem visíveis no conteúdo.

## 7. Responsividade

Abordagem mobile-first, sem tratar 941 px ou 1448 px das imagens como breakpoints de CSS.

| Faixa inicial | Comportamento esperado |
| --- | --- |
| `< 640 px` | Uma coluna; painel ocupando a largura; navegação inferior; filtros em drawer/painel; coleções em cartões; detalhe empilhado |
| `640–1023 px` | Uma ou duas colunas conforme conteúdo; navegação compacta; filtros podem quebrar linha; tabelas só quando legíveis |
| `≥ 1024 px` | Sidebar; cabeçalho; grids de KPIs; tabelas; detalhe em múltiplas colunas; faixas institucionais laterais no fluxo público |

- Container de conteúdo: largura fluida com máximo aproximado de 1440 px e gutters de 16 px no mobile, 24 px em tablet e 32 px no desktop.
- Grades: obras em 1/2/3 colunas; KPIs em 2 colunas no mobile quando couberem sem truncar e 4 ou 5 no desktop; detalhe em 1 coluna no mobile e até 3 no desktop.
- Tabelas não devem depender de rolagem horizontal como experiência principal no celular; usar cartões com os mesmos campos e ações.
- Sidebar desktop vira barra inferior mobile com os destinos prioritários. Destinos excedentes ficam em “Mais”; o conjunto final segue permissões e escopo do MVP.
- Conteúdo deve continuar funcional a 320 px CSS, zoom de 200% e textos ampliados, sem ações encobertas.

## 8. Design tokens iniciais

Os valores abaixo são sementes extraídas visualmente, não medições exatas. Devem ser centralizados como tokens na implementação e ajustados aos ativos oficiais e aos critérios de contraste.

### Cores

| Token sugerido | Valor inicial | Uso |
| --- | --- | --- |
| `color-brand-navy-900` | `#001F4D` | fundos institucionais e texto forte |
| `color-brand-navy-800` | `#062D63` | navegação/variação de fundo |
| `color-brand-amber-500` | `#FFB000` | CTA e destaque da marca |
| `color-brand-amber-600` | `#E99A00` | hover/pressed do âmbar |
| `color-action-blue-600` | `#0B5CFF` | links e ações internas |
| `color-success-600` | `#16A34A` | OK e sucesso |
| `color-warning-600` | `#F59E0B` | suspeita e atenção |
| `color-danger-600` | `#EF4444` | erro, rejeição e falha de leitura |
| `color-info-600` | `#2563EB` | pendência e informação |
| `color-neutral-950` | `#0F172A` | texto principal |
| `color-neutral-600` | `#64748B` | texto secundário |
| `color-neutral-300` | `#CBD5E1` | bordas fortes |
| `color-neutral-200` | `#E2E8F0` | divisores e bordas |
| `color-neutral-50` | `#F8FAFC` | fundo da aplicação |
| `color-surface` | `#FFFFFF` | cartões e painéis |

O amarelo da marca sobre branco não deve ser usado como única cor de texto pequeno. Status sempre combina cor, ícone e rótulo.

### Tipografia, espaçamento e forma

- Família inicial: `Inter`, com fallback para `system-ui, sans-serif`; substituir apenas se a marca definir fonte oficial.
- Escala tipográfica: 12, 14, 16, 18, 24, 32 e 40 px; corpo padrão 16 px no fluxo público e 14–16 px na área densa, sem texto funcional abaixo de 12 px.
- Pesos: 400 para corpo, 500 para controles/rótulos, 600 para subtítulos e 700 para títulos/KPIs.
- Escala de espaço: 4, 8, 12, 16, 24, 32, 48 e 64 px.
- Raios: 6 px para controles compactos, 8 px para inputs/botões, 12 px para cartões e 20–24 px para painéis públicos mobile.
- Bordas: 1 px neutra; 2 px para foco. Sombra leve apenas para separar cartões/painéis, sem substituir borda ou hierarquia.
- Alturas: controles de 40–44 px no desktop e pelo menos 44–48 px no mobile.
- Movimento: 150–250 ms para feedback; respeitar `prefers-reduced-motion`; processamento não deve depender de animação para comunicar estado.

## 9. Correspondência com as issues de implementação

| Issue | Responsabilidade de interface derivada das referências | Telas/componentes | Condição crítica de aceite |
| --- | --- | --- | --- |
| WIN-16 | Autenticação, sessão e separação entre área pública e interna | M01, D01, `PublicShell`, `AppShell`, `TextField` | Dashboard, validações e área interna protegidos; envio acessível sem login |
| WIN-18 | Seleção de obra, upload unitário e mensagens do envio público | M02–M05, D02–D05, `ObraCard`, `FileDropzone`, `ProgressSteps`, `FeedbackPanel` | Bloquear obra ausente e arquivo inválido; aceitar PDF/JPG/PNG; sucesso/erro claros |
| WIN-22 | Falha específica de leitura/qualidade e orientação de reenvio | M06, D11, `FeedbackPanel` | Status de falha de leitura; não encaminhar nem alertar Rafael |
| WIN-27 | Dashboard, notas, filtros, status e acesso rápido ao que exige decisão | M07–M09, D06–D08, métricas, filtros, coleções e badges | Filtrar por obra e abrir rapidamente itens que exigem decisão humana |
| WIN-28 | Auditoria comparativa e explicável da nota | M10, D09, D10, `DocumentPreview`, dados, achados e histórico | Original versus extração, itens, resumo/Markdown, regra, classificação e histórico compreensíveis |
| WIN-29 | Registro da decisão humana sem perda de histórico | M10, D08, D09, `ValidationForm`, `Timeline` | Decisão inequívoca, motivo/comentário, usuário/data e histórico preservado |

Dependências visuais não mudam as dependências técnicas do Linear. WIN-18 cobre a experiência pública mesmo quando o processamento depende de extração/análise; WIN-27 abre caminho para WIN-28; WIN-28 fornece o contexto necessário para WIN-29.

## 10. Checklist de implementação e revisão visual

- [ ] Usar os mockups como direção visual, não como dados ou regra literal.
- [ ] Manter envio público sem autenticação e área interna protegida.
- [ ] Distinguir recebido, processando, concluído, falha técnica e falha de leitura.
- [ ] Garantir que falha de leitura não entre na fila de validação de Rafael.
- [ ] Preservar equivalência de informação entre tabela desktop e cartões mobile.
- [ ] Implementar loading, vazio, erro, retry, sessão expirada e conflito de atualização.
- [ ] Mostrar status com texto/ícone, não apenas por cor.
- [ ] Tornar teclado, foco, leitor de tela, zoom e redução de movimento funcionais.
- [ ] Persistir validação com usuário, data, motivo e histórico sem alterar o original.
- [ ] Validar contraste, ativos oficiais, textos finais e limites reais antes do aceite visual.

## 11. Decisões pendentes que não devem ser inventadas pelo frontend

- Ativos oficiais de marca, fonte e ilustrações de obra.
- Limite real de upload e política de retenção/reenvio.
- Taxonomia final de status e transições permitidas.
- Critério e cálculo dos KPIs, tendências, insights e valor analisado.
- Ordenação/prioridade da fila de validações.
- Canal de recuperação de senha e canal de contato para obra ausente.
- Comportamento de processamento em background, atualização e notificações.
- Matriz detalhada de permissões entre Rafael e usuários WinfraBR.
