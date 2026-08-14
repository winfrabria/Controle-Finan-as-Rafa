# Validação contratual da PWA

## Gate automatizado

Execute:

```powershell
npm run test:pwa
npm run check
```

`test:pwa` usa somente `node:test`, `tsx` e APIs nativas do Node. Não requer
banco, Supabase, OpenRouter, navegador instalado ou acesso à internet.

| Contrato | Evidência automatizada |
| --- | --- |
| Manifesto instalável | Identidade, escopo, modo standalone, idioma, cores e dimensões reais dos PNGs |
| Arquivos públicos | `offline.html` neutro, sem storage, rede programática, dados fiscais ou templating |
| Headers | Worker sem retenção HTTP, escopo `/`, `nosniff`; manifesto com MIME e revalidação |
| Proxy | Worker, manifesto, offline e ícones essenciais não passam pelo matcher de autenticação |
| Classificação | Allowlist positiva para chunks e marca; todo o restante é `network-only` ou navegação com fallback |
| Dados privados | APIs, auth, admin, revisão, notas, validações, RSC e prefetch nunca acessam Cache Storage |
| Mutações | `POST`, `PUT`, `PATCH` e `DELETE` não são interceptados, persistidos ou repetidos |
| Documentos | Range, URLs com query, Supabase Storage, URLs assinadas e origens externas não são cacheados |
| Respostas | `private`, `no-store`, opacas e falhas HTTP não são gravadas |
| Lifecycle | Precache, cache-first, stale-while-revalidate, fallback offline, activate e `SKIP_WAITING` |
| Limpeza | Apenas caches antigos com o prefixo de ownership `winfrabr-pwa-` são removidos |

O worker clássico é executado em `node:vm` com implementações controladas de
`self`, eventos, Cache Storage e rede. Os testes exercitam o comportamento do
arquivo real `public/sw.js`; não duplicam suas regras em regexes.

## Resultado integrado em 2026-08-14

- `npm run test:pwa`: 28/28 aprovados.
- Regressões de autenticação, upload, obras e Harness: 159 aprovadas, 3
  ignoradas por exigirem banco, 0 falhas.
- Total automatizado: 187 aprovados, 3 ignorados, 0 falhas.
- `npm run check`, `npm run prisma:validate`, `node --check public/sw.js`,
  `git diff --check` e `npm run build`: aprovados.

## Validação prática concluída

1. Build de produção servido localmente, sem erro de console ou de aplicação.
2. Headers reais de `sw.js`, manifesto e fallback conferidos via HTTP 200.
3. Worker novo chegou ao estado de atualização disponível; o clique em
   `Atualizar agora` aplicou a versão e recarregou o app sem loop.
4. Com o servidor parado, uma navegação privada retornou o fallback neutro sem
   dados fiscais. Após o servidor voltar, `Tentar novamente` restaurou a rota.
5. Quinze combinações de rota e viewport em 360, 390 e 430 px ficaram sem
   overflow horizontal, IDs duplicados ou erro de renderização.
6. Controles visíveis auditados ficaram com área de toque de pelo menos 44 px;
   paginação de Notas acessou a segunda página no mobile.
7. Filtros recolhíveis de Notas e Logs, modal de Obras, detalhe de Log, Escape,
   trap/restauração de foco e lock de scroll foram exercitados no navegador.
8. Câmera abriu um único seletor; arquivo com nome longo truncou sem expandir o
   card ou a página. Nenhum upload foi enviado durante a homologação.
9. Mensagens de callback expirado e credenciais inválidas foram distinguidas.
10. Documento real sem URL versus DANFE demo está protegido por contrato
    automatizado dedicado.

## Homologação ainda pendente em ambiente físico

1. O navegador integrado teve limite mínimo efetivo de 360 px; 320 px recebeu
   revisão estática, mas precisa de aparelho ou runner autorizado para aprovação
   prática.
2. Instalação/standalone no Android e Add to Home Screen no iPhone/iPad.
3. Teclado virtual, notch/safe areas, rotação, câmera real e file picker nativo.
4. Lifecycle real do Safari/iOS e prompt nativo de instalação do Chromium.

Emulação não aprova os itens físicos acima. Eles permanecem pendentes até teste
no ambiente correspondente.
