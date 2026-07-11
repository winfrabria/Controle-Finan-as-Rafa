# Auditoria de Gastos HWN

Base fullstack do MVP, construída com Next.js, App Router e TypeScript.

## Desenvolvimento

Requisitos: Node.js 20.9+ e npm.

```bash
copy .env.example .env.local
npm install
npm run dev
```

A aplicação fica disponível em `http://localhost:3000` e o health check em
`http://localhost:3000/api/health`.

## Validação

```bash
npm run lint
npm run typecheck
npm run build
```

## Estrutura

- `src/app`: páginas e rotas HTTP do App Router.
- `src/features`: módulos funcionais do produto.
- `src/lib/integrations`: adaptadores futuros para Supabase e OpenRouter.
- `src/server`: regras e serviços exclusivos do servidor.
- `prisma`: schema e migrations futuros.

As integrações com Supabase (Postgres, Auth e Storage), Prisma e OpenRouter ainda
não estão implementadas. As variáveis esperadas estão documentadas em
`.env.example` sem valores secretos.
