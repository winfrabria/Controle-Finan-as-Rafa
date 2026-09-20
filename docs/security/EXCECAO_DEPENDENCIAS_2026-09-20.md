# Exceção temporária de dependências — 2026-09-20

## Decisão

Os quatro registros `high` atuais de `npm audit --omit=dev` ficam aceitos temporariamente para esta release candidate. Eles representam duas cadeias transitivas do CLI `prisma@7.10.0`: `@prisma/config -> deepmerge-ts@7.1.5` e `prisma -> mysql2@3.15.3`.

Não será aplicado `npm audit fix --force`, downgrade para Prisma 6 nem override isolado dessas dependências. Essas opções alteram uma fronteira central do ORM ou criam uma combinação não suportada sem eliminar um risco explorável no runtime atual.

## Evidência de não exposição no runtime

- A aplicação usa PostgreSQL por `@prisma/adapter-pg`; não abre conexão MySQL.
- Foram inspecionados 61 arquivos `.next/server/**/*.nft.json` do build de produção.
- Não houve referência a `mysql2`, `deepmerge-ts` ou `@prisma/config` nesses traces.
- `mysql2` e `deepmerge-ts` chegam ao projeto pelo pacote de desenvolvimento `prisma`, usado para gerar cliente, validar schema e executar migrações.
- O alerta não é considerado resolvido: ele permanece visível no `npm audit` e nesta exceção.

## Riscos e controles

1. `deepmerge-ts`: exaustão de pilha ao mesclar grafos recursivos. O projeto não recebe configuração Prisma de usuário final nem executa o CLI Prisma em requisições web.
2. `mysql2`: downgrade de autenticação e descompressão sem limite contra um servidor MySQL hostil. A aplicação não usa MySQL e o pacote não está no trace do servidor compilado.
3. Prisma CLI não deve ser instalado ou executado no container/runtime web de produção. Migrações devem ocorrer em etapa separada e controlada.
4. O artefato de produção deve ser montado a partir do output compilado e de suas dependências rastreadas, sem incluir o workspace completo de desenvolvimento.

## Prazo e gatilhos de revisão

Revisar até **2026-10-20**, ou antes se ocorrer qualquer um destes eventos:

- publicação de uma versão estável compatível do Prisma que atualize as dependências afetadas;
- mudança da aplicação para MySQL;
- inclusão de `mysql2`, `deepmerge-ts` ou `@prisma/config` nos traces do servidor;
- execução do Prisma CLI dentro do processo web;
- novo advisory com exploração aplicável ao fluxo atual.

Sem essa revisão ou se algum gatilho ocorrer, a exceção expira e a promoção seguinte deve ser bloqueada.
