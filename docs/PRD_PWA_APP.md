# PRD — WinfraBR como aplicativo PWA

**Status:** aprovado para implementação em 14/08/2026
**Produto:** WinfraBR — auditoria inteligente de notas fiscais
**Plataforma:** Next.js 16, React 19, Supabase/PostgreSQL e Vercel
**Responsáveis desta entrega:** agente principal + trilhas paralelas de PWA, interface mobile e qualidade
**Documento complementar:** `docs/UI_REFERENCE.md`

## 1. Visão do produto

O WinfraBR deve funcionar como um aplicativo instalável, confiável e adequado ao uso diário em celular, tablet e desktop. A entrega não cria uma segunda aplicação nem migra o produto para tecnologia nativa: a aplicação Next.js existente continua sendo a fonte única e passa a oferecer instalação, modo standalone, ciclo de atualização controlado, fallback offline seguro e uma interface consistente com padrões de aplicativo.

A identidade visual e os fluxos já implementados serão preservados. A reorganização deve remover inconsistências de responsividade e comportamento, sem substituir telas funcionais por um redesenho sem referência.

## 2. Objetivos

1. Tornar o WinfraBR instalável como PWA em navegadores compatíveis e abrir em modo standalone.
2. Implementar service worker com uma política de cache restritiva, auditável e segura para dados fiscais.
3. Disponibilizar fallback offline neutro, sem expor dados de usuário, documentos, APIs ou respostas RSC.
4. Implementar fluxos claros de instalação, conectividade e atualização do aplicativo.
5. Padronizar a experiência mobile em todas as rotas ativas, incluindo safe areas, navegação inferior, toque, teclado, modais, filtros e documentos.
6. Preservar o estado permitido do usuário durante falhas recuperáveis, sem reenvio automático de notas ou duplicação de mutações.
7. Criar testes unitários, contratuais e práticos para manifest, service worker, cache, instalação, atualização, responsividade e acessibilidade.
8. Manter o build atual com Turbopack e evitar dependências de runtime desnecessárias.

## 3. Fora do escopo desta fase

- Web Push, VAPID, inscrição de dispositivos e notificações com o aplicativo fechado.
- Envio de e-mail e integração com Resend ou outro provedor externo.
- Publicação em App Store ou Google Play.
- Sincronização offline de dados fiscais, documentos, formulários administrativos ou filas de upload.
- Background Sync para `POST`, upload ou contexto.
- Cache persistente de dashboards, notas, documentos, relatórios, notificações, logs ou dados de autenticação.
- Deploy em produção. A entrega será validada localmente e ficará pronta para uma etapa posterior de publicação.

## 4. Usuários e fluxos

### 4.1 Público

- Entrar, recuperar senha e atualizar senha.
- Selecionar obra, escolher/tirar foto de uma nota, enviar, acompanhar processamento, responder contexto e receber resultado.
- Instalar o PWA e entender quando a conexão é necessária.

### 4.2 Rafael / reviewer

- Consultar dashboard, caixa de notas, diagnóstico, análise completa e histórico.
- Marcar uma nota como lida sem fluxo de aprovação/rejeição nesta versão do MVP.
- Usar a barra inferior e retornar ao contexto anterior sem perda desnecessária de posição.

### 4.3 Administrador

- Consultar dashboard, notas, auditoria comparativa, análise, obras, histórico e logs.
- Criar/editar obras, importar CSV e executar ações administrativas sem controles encobertos no mobile.
- Acessar documentos e rastreabilidade sem permitir que o service worker armazene conteúdo privado.

## 5. Estado atual confirmado

Já existem manifesto, ícones 192/512, metadados, layouts responsivos e barra inferior mobile. Também existe a modelagem `PushSubscription`, mas não há implementação de push.

Ainda não existem service worker, registro client-side, fallback offline, fluxo de instalação, aviso de atualização, política de cache PWA, safe areas ou testes específicos de PWA. A interface possui diversos breakpoints, mas há inconsistências em 320–430 px, controles menores que 44 px, filtros densos, modais sensíveis ao teclado e navegação fixa sem tratamento do indicador inferior do iPhone.

Dois riscos P0 precisam ser tratados junto da transformação:

1. Conteúdo fiscal privado e URLs assinadas nunca podem entrar em Cache Storage. Novos arquivos também não devem ser publicados com cache HTTP prolongado.
2. Falha na URL de um documento real não pode exibir um DANFE de demonstração como se fosse o original. O estado correto é “documento indisponível”.

## 6. Decisões técnicas

### 6.1 Service worker

Será usado um service worker nativo em `public/sw.js`, sem Serwist, Workbox ou `next-pwa`. A escolha mantém compatibilidade direta com o build padrão do Next.js 16/Turbopack, reduz superfície de dependências e permite testar explicitamente cada regra de cache.

O worker deve ser pequeno, versionado e conter funções de classificação de requisição testáveis. Eventos obrigatórios: `install`, `activate`, `fetch` e `message`.

### 6.2 Matriz de cache

| Recurso | Estratégia | Regra de segurança |
| --- | --- | --- |
| `/_next/static/**` versionado por hash | Cache first | Apenas `GET`, mesma origem e resposta bem-sucedida |
| `/brand/**` e assets públicos explicitamente permitidos | Stale while revalidate | Allowlist; nunca ampliar para qualquer imagem |
| `offline.html` e ícones essenciais | Precache versionado | Conteúdo público e neutro |
| Manifesto | Rede com revalidação | Não servir indefinidamente uma versão antiga |
| Navegação HTML | Network only + fallback offline | Nunca gravar HTML/RSC autenticado |
| `/api/**` e `/auth/**` | Network only | Nunca adicionar ao Cache Storage |
| `/admin/**`, `/revisao/**`, `/notas/**`, `/validacoes/**` | Network only | Nunca armazenar página, RSC ou prefetch |
| Requisições RSC/prefetch | Network only | Detectar query/cabeçalhos do Next Router |
| `POST`, `PUT`, `PATCH`, `DELETE`, upload e contexto | Network only | Sem fila e sem replay automático |
| Supabase Storage, URLs assinadas e qualquer origem externa | Network only | O worker não intercepta nem persiste |

O worker deve respeitar `Cache-Control: no-store`, nunca cachear respostas opacas/cross-origin, remover apenas caches antigos com prefixo do WinfraBR e manter caches de terceiros intactos.

### 6.3 Offline

Offline não significa acesso persistente aos dados fiscais. Se uma tela já estiver aberta, os valores em memória permanecem visíveis e um aviso informa que novas ações dependem de conexão. Em refresh ou nova navegação sem rede, a aplicação exibe `offline.html`, sem fornecedor, número de nota, valor, usuário ou qualquer informação da sessão anterior.

Uploads não serão persistidos em Cache Storage ou IndexedDB. Enquanto a tela permanecer aberta, arquivo, obra e respostas ainda não enviadas devem ser preservados em memória. O usuário executa retry manual; não existe reenvio automático.

### 6.4 Atualização

O registro usará `updateViaCache: "none"`. Um worker novo deve permanecer em `waiting` e a interface apresenta “Nova versão disponível”. A atualização só envia `SKIP_WAITING` após ação do usuário e quando não houver upload ou mutação crítica em andamento. Depois de `controllerchange`, a página recarrega uma única vez.

### 6.5 Instalação

- Chromium compatível: capturar `beforeinstallprompt`, mostrar CTA acessível e solicitar instalação somente após ação do usuário.
- iOS/iPadOS: detectar ambiente compatível e mostrar instrução “Compartilhar → Adicionar à Tela de Início”.
- Standalone: ocultar o CTA quando `display-mode: standalone` ou `navigator.standalone` indicar instalação.
- O aviso pode ser dispensado e não deve reaparecer durante a mesma sessão sem necessidade.
- O manifesto deve declarar `id`, `scope`, `start_url`, `display`, cores, idioma e ícones válidos. Não declarar um ícone como `maskable` sem um arquivo visualmente validado para esse propósito.

### 6.6 Documentos privados

- O service worker nunca armazena documento, preview, URL assinada ou resposta que contenha essas URLs.
- Novos uploads devem usar política de cache HTTP sem retenção prolongada.
- A visualização interna deve preferir uma rota autenticada same-origin com `private, no-store` em vez de expor URL assinada no HTML/RSC, desde que isso não quebre visualização e download.
- Documento real indisponível mostra estado explícito e retry/abertura alternativa; apenas notas de demonstração podem renderizar o DANFE sintético.

## 7. Requisitos de interface app-like

### 7.1 Shell compartilhado

- Usar `100dvh` com fallback e variáveis de safe area.
- Cabeçalho e barra inferior devem respeitar `env(safe-area-inset-top)` e `env(safe-area-inset-bottom)`.
- O conteúdo deve receber padding inferior suficiente para nunca ficar sob a navegação.
- Reviewer usa três destinos distribuídos em toda a largura; admin usa quatro.
- Item ativo deve usar `aria-current="page"`.
- O menu “Mais” deve abrir acima da safe area e fechar de forma previsível.
- Em modo standalone, a experiência mantém marca, navegação e hierarquia sem aparência de página institucional.

### 7.2 Responsividade

Viewports mínimos obrigatórios: `320×568`, `360×800`, `390×844`, `430×932`, tablet e desktop. Não pode existir rolagem horizontal na página principal; blocos técnicos podem rolar apenas dentro do próprio container.

Filtros secundários em Notas, Histórico e Logs devem virar painel expansível/drawer no mobile quando não couberem. Busca principal permanece visível. Datas não podem comprimir campos a ponto de cortar conteúdo.

### 7.3 Toque, teclado e acessibilidade

- Alvos interativos mobile com área mínima de 44×44 px.
- Inputs mobile com fonte mínima de 16 px para evitar zoom automático no Safari.
- Foco visível, labels acessíveis, disabled real e mensagens por `role="status"`/`role="alert"` conforme o caso.
- Modais: título associado, foco inicial, Escape, restauração de foco, fundo bloqueado e ação principal visível com teclado.
- Respeitar `prefers-reduced-motion` e evitar animações indispensáveis para entender estado.
- Validar zoom de 200%, texto ampliado, navegação por teclado e ordem semântica.

### 7.4 Requisitos por superfície

**Login/senha:** sem overflow em 320 px; erros de credencial, configuração, callback, rede e link expirado claramente diferentes; campos e CTA visíveis com teclado.

**Envio público:** loading, vazio, erro e retry na lista de obras; seleção por câmera/galeria/arquivo sem excluir PDF; arquivo não desaparece após erro recuperável; queda de rede não duplica envio; estado explica que conexão é obrigatória.

**Dashboard:** filtros legíveis, métricas sem truncamento, skeleton/erro/vazio/retry e nenhuma ação encoberta.

**Notas/Histórico:** busca primária visível; filtros secundários adaptados; cards equivalentes à tabela; empty state diferencia ausência de dados de filtro sem resultado; marcação como lida trata loading/erro sem remoção prematura.

**Auditoria/Análise:** documento real, indisponível e demo são estados distintos; PDF/imagem utilizável por toque; itens e achados legíveis sem scroll horizontal da página; controles de zoom com 44 px.

**Obras:** cards equivalentes à tabela; modal funcional com teclado; importação e erros legíveis; FAB e ações acima da barra inferior/safe area.

**Logs:** filtros adaptados; detalhe mobile como painel/modal previsível; JSON pode rolar horizontalmente somente dentro do bloco; retorno útil em erro/not-found.

## 8. Cabeçalhos e integração com Next.js

- `/sw.js`: `Content-Type: application/javascript`, `Cache-Control: no-cache, no-store, must-revalidate`, `Service-Worker-Allowed: /` e `X-Content-Type-Options: nosniff`.
- `/manifest.webmanifest`: MIME correto e revalidação curta.
- `src/proxy.ts`: excluir explicitamente worker, manifesto, offline e assets públicos essenciais do matcher de autenticação.
- `src/app/layout.tsx`: metadados PWA, Apple Web App, `viewportFit: cover`, theme color e componente de lifecycle.
- O lifecycle registra o worker em produção e também em localhost para a suíte prática, sem contaminar o desenvolvimento comum quando a flag local estiver desativada.

## 9. Telemetria local e privacidade

Não será adicionado provedor externo. Eventos podem ser expostos somente no console de desenvolvimento ou em estados internos não persistentes: worker registrado, update encontrado, instalação aceita/recusada, online/offline. Nunca registrar arquivo, documento, URL assinada, token, e-mail, fornecedor, número, valor ou dados da auditoria.

## 10. Estratégia de testes

### 10.1 Unitários/contratuais

- Classificação de cache para método, origem, rota, modo de navegação, RSC e assets.
- Instalação/ativação/limpeza de caches antigos.
- Mensagem `SKIP_WAITING` e versão do worker.
- Manifesto, escopo, ícones, offline e headers esperados.
- Utilitários de detecção standalone/iOS e decisão de exibir instalação.
- Regressão: documento real sem URL não pode renderizar `DemoDanfe`.

### 10.2 Integração/build

- `npm run check`.
- `npm run test:auth`.
- `npm run test:upload`.
- `npm run test:works`.
- `npm run test:harness`.
- Nova suíte `npm run test:pwa`.
- `npm run build` e `npm start` em porta isolada.
- Verificar que `sw.js`, `offline.html`, manifesto e ícones são servidos no build de produção.

### 10.3 Testes práticos no navegador

- Carregar online, registrar/ativar worker e confirmar controle após segundo load.
- Inspecionar Cache Storage e provar ausência de `/api`, HTML/RSC, rotas privadas, documentos e URLs externas.
- Ficar offline em rota protegida e confirmar fallback neutro.
- Voltar online sem loop e recuperar navegação.
- Simular nova versão; adiar e aplicar update de forma controlada.
- Validar CTA de instalação onde o navegador expuser o evento e instrução iOS por detecção controlada.
- Verificar `scrollWidth <= innerWidth` nas rotas principais nos viewports definidos.
- Verificar elementos focáveis, alvos de toque, barra inferior, safe areas e reduced motion.
- Capturar e comparar visualmente telas-chave antes/depois.

### 10.4 Limites de validação

Emulação de viewport não comprova comportamento final do teclado, file picker, Add to Home Screen ou lifecycle do Safari. A homologação final de iOS requer iPhone real ou Safari/Xcode; Android deve ser validado em aparelho ou emulador. Esses testes serão reportados como pendentes se o hardware não estiver disponível, nunca como aprovados por inferência.

## 11. Critérios de aceite

1. Manifesto válido e assets declarados respondem corretamente.
2. Worker controla o app no build local e possui headers corretos.
3. Páginas privadas, APIs, RSC, uploads e documentos não aparecem em Cache Storage.
4. Offline em rota privada apresenta somente o fallback neutro.
5. Atualização não recarrega automaticamente durante upload/mutação.
6. Aplicativo não possui overflow horizontal nas rotas principais em 320, 360, 390 e 430 px.
7. Navegação, FABs, modais e conteúdo respeitam safe areas e não se sobrepõem.
8. Controles prioritários atingem 44×44 px e inputs mobile evitam zoom automático.
9. Documento real indisponível nunca é substituído por DANFE de demonstração.
10. Fluxos de login, envio público, dashboard, notas, detalhe, obras e logs mantêm comportamento funcional.
11. Testes existentes, nova suíte PWA, lint, typecheck e build passam.
12. Nenhum segredo, URL assinada ou dado fiscal é gravado em logs, caches ou artefatos de teste.

## 12. Plano de execução e ownership

### Trilha A — Núcleo PWA e segurança de cache

Responsável por worker, offline, lifecycle, manifesto, headers, proxy, metadados, política de documentos privados e testes unitários diretamente ligados ao núcleo. Não altera os grandes módulos visuais.

### Trilha B — Interface mobile e comportamento app-like

Responsável por shell, safe areas, navegação, touch targets, filtros, modais, upload, login e estados do documento. Preserva identidade visual, contratos de backend e regras do Harness.

### Trilha C — Qualidade e validação

Responsável pela suíte contratual PWA, matriz de regressão, scripts de teste e inspeção de cache/build. Não altera regras de negócio nem estilos de produção, exceto correções mínimas solicitadas após evidência de teste.

### Integração — Agente principal

Consolida as trilhas, resolve conflitos, revisa segurança, executa gates completos, realiza validação visual/prática e registra claramente o que foi ou não validado.

## 13. Sequência de entrega

1. PRD e auditoria de baseline.
2. Núcleo PWA/cache e base mobile em paralelo.
3. Testes contratuais e correções P0.
4. Integração de interface por superfícies prioritárias.
5. Build de produção local e testes práticos online/offline/update.
6. Auditoria visual e acessibilidade em todos os viewports previstos.
7. Relatório final com evidências, limites e pendências de aparelho real.

## 14. Definition of Done

A fase termina somente quando o código estiver integrado, os critérios acima estiverem cobertos, os testes automatizados passarem, o build de produção local funcionar e a validação prática demonstrar cache seguro e interface utilizável nos viewports previstos. Push e e-mail permanecem documentados para a próxima fase e não podem ser apresentados como implementados.
