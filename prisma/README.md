# Prisma

Contém o schema e as migrations gerenciadas pelo Prisma.

A migration inicial apenas registra o início do histórico técnico. A WIN-15
adiciona o domínio do MVP:

- `profiles`, vinculada por chave estrangeira a `auth.users` do Supabase;
- `works`, `notes` e `note_items` para o envio e a extração das notas;
- `audit_parameters`, `audit_rules` e `rule_parameters` para regras globais ou
  específicas por obra;
- `findings` e `validations` para a análise e a decisão humana imutável;
- `note_events` para histórico de processamento e mudança de status;
- `notifications` e `push_subscriptions` para caixa interna e push mobile.

Notas com falha de leitura usam `READ_FAILED` e não precisam gerar achados nem
notificações de validação. Notas suspeitas usam `PENDING_VALIDATION`, mantendo a
classificação e os achados que justificam a fila do revisor.
