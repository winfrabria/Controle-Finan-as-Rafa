# Prisma

Contém o schema e as migrations gerenciadas pelo Prisma.

A migration inicial apenas registra o início do histórico técnico. A WIN-15
adiciona o domínio do MVP:

- `profiles`, vinculada por chave estrangeira a `auth.users` do Supabase;
- `works`, `notes` e `note_items` para o envio e a extração das notas;
- `audit_parameters`, `audit_rules` e `rule_parameters` para regras globais ou
  específicas por obra;
- `findings` e `validations` para preservar histórico técnico legado; decisões
  de aprovação/rejeição ficam bloqueadas no MVP;
- `ai_runs`, `processing_jobs` e `admin_audit_logs` para execução durável,
  métricas e auditoria administrativa;
- `note_context_questions`, `note_context_submissions` e `note_context_answers`
  para uma única rodada de contexto e uma reanálise que reutiliza a extração;
- `note_events` para histórico de processamento e mudança de status;
- `notifications` e `push_subscriptions` para caixa interna e push mobile.

Notas com falha de leitura usam `READ_FAILED` e não precisam gerar achados nem
notificações ao Rafael. Os resultados canônicos são `OK`, `SUSPICIOUS`,
`NEEDS_CONTEXT` e `READ_FAILED`; `SUSPICIOUS` é terminal no MVP e não usa
`PENDING_VALIDATION`. Campos públicos antigos são preenchidos na migração para
manter compatibilidade sem autorizar acesso por UUID.
