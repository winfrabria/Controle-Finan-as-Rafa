-- Older INFORMATION_INSUFFICIENT outcomes were encoded as
-- OK + NEEDS_CONTEXT + NO_PARAMETER even when no context question existed.
-- They are terminal but inconclusive, so they must not be presented as OK.
UPDATE "notes"
SET
  "audit_result" = 'READ_FAILED',
  "status" = 'READ_FAILED',
  "failure_code" = COALESCE("failure_code", 'AUDIT_INSUFFICIENT_COVERAGE'),
  "failure_message" = COALESCE(
    "failure_message",
    'A leitura automática não reuniu cobertura suficiente para concluir a auditoria.'
  )
WHERE
  "status" = 'OK'
  AND "audit_result" = 'NEEDS_CONTEXT'
  AND "classification" = 'NO_PARAMETER';
