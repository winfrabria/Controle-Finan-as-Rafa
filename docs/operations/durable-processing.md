# Processamento durável de anexos

## Objetivo

O upload continua tentando iniciar o processamento imediatamente com `after()`.
Essa execução é apenas a via rápida. A fonte de verdade é a tabela
`processing_jobs`, consumida pelo endpoint protegido
`GET /api/internal/ai/worker`.

O worker:

- assume jobs com claim otimista e idempotente;
- processa um anexo por invocação por padrão;
- retoma jobs `FAILED` ainda dentro do limite de tentativas;
- recupera leases `RUNNING` abandonadas após seis minutos;
- aproveita a extração já concluída quando a interrupção aconteceu na auditoria;
- nunca agenda automaticamente anexos legados sem job.

## Configuração de produção

1. Gere um segredo aleatório com pelo menos 32 caracteres.
2. Configure-o na Vercel como `CRON_SECRET` para Production, Preview e
   Development conforme necessário.
3. Faça o deploy. O `vercel.json` instala um fallback diário compatível com o
   plano Hobby.
4. Para processamento contínuo, configure o Supabase Cron para chamar, a cada
   minuto, a URL de produção `/api/internal/ai/worker` usando o header
   `Authorization: Bearer <CRON_SECRET>`.
5. Guarde a URL e o segredo no Supabase Vault; não coloque o valor em migration,
   código, logs ou documentação.

O plano Hobby da Vercel limita Cron Jobs a uma execução diária. Por isso, o
agendamento por minuto deve ficar no Supabase Cron. A função continua rodando na
Vercel, com duração máxima de 300 segundos.

Referências oficiais:

- https://vercel.com/docs/cron-jobs/manage-cron-jobs
- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://supabase.com/docs/guides/cron

## Recuperação de anexos antigos

`GET /api/admin/ai/jobs/recover` mostra jobs vencidos e anexos `RECEIVED` que
nunca receberam um job. O endpoint exige ADMIN.

Para agendar anexos selecionados sem executá-los imediatamente:

```json
POST /api/admin/ai/jobs/recover
{
  "confirm": true,
  "noteIds": ["uuid-do-anexo"]
}
```

É obrigatório selecionar explicitamente de 1 a 25 anexos. Essa proteção evita
que arquivos antigos de demonstração consumam IA acidentalmente. A execução só
começa quando o worker protegido for chamado.

## Operação e saúde

`GET /api/admin/ai/health` informa:

- jobs pendentes, vencidos e falhos;
- leases abandonadas;
- anexos legados sem job;
- presença da configuração do worker;
- execuções, erros, tokens, custo e latência das últimas 24 horas.

Nunca registre o segredo, a chave da OpenRouter, URLs assinadas ou raciocínio
interno dos modelos.
