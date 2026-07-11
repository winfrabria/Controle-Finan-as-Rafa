# Server

Código exclusivo do servidor, como serviços, autorização e orquestração de dados,
deve ficar neste diretório.

- `db/prisma.ts`: cliente Prisma singleton, protegido contra importação em Client
  Components por `server-only`.
