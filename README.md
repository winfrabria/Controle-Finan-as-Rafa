# Auditoria de Gastos HWN

Base fullstack do MVP, construída com Next.js, App Router e TypeScript.

## Desenvolvimento

Requisitos: Node.js 20.19+ e npm.

```bash
copy .env.example .env
npm install
npm run prisma:generate
npm run dev
```

A aplicação fica disponível em `http://localhost:3000` e o health check em
`http://localhost:3000/api/health`.

## Validação

```bash
npm run lint
npm run typecheck
npm run prisma:format
npm run prisma:validate
npm run prisma:generate
npm run build
```

## Banco de dados

O runtime usa `DATABASE_URL`; no Supabase/Vercel, use preferencialmente a URL do
Transaction pooler (porta `6543`). O Prisma CLI usa `DIRECT_URL` para migrations e
operações de schema; use a conexão direta (porta `5432`) ou o Session pooler
quando o ambiente não tiver acesso IPv6. Nunca envie credenciais reais ao Git.

Variáveis obrigatórias:

- `DATABASE_URL`: conexão pooled usada pelo cliente Prisma na aplicação.
- `DIRECT_URL`: conexão sem transaction pooling usada pelo Prisma CLI.

Comandos de schema e migrations:

```bash
# Cria uma migration local após mudanças no schema
npm run prisma:migrate:dev -- --name nome_da_migration

# Aplica migrations já versionadas em homologação/produção
npm run prisma:migrate:deploy

# Regera o client após alterações no schema
npm run prisma:generate
```

A migration inicial da WIN-14 é deliberadamente técnica e não cria tabelas de
negócio. A modelagem completa pertence à WIN-15.

## Estrutura

- `src/app`: páginas e rotas HTTP do App Router.
- `src/features`: módulos funcionais do produto.
- `src/lib/integrations`: adaptadores futuros para Supabase e OpenRouter.
- `src/server`: regras, serviços e cliente Prisma exclusivos do servidor.
- `prisma`: schema e histórico de migrations.

As variáveis esperadas estão documentadas em `.env.example` sem valores secretos.
Supabase Auth, Storage e OpenRouter permanecem para as tarefas específicas.
