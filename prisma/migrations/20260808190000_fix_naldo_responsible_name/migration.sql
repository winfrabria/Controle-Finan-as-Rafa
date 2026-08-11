UPDATE "works"
SET "responsible_name" = 'Naldo',
    "updated_at" = CURRENT_TIMESTAMP
WHERE LOWER(TRIM("responsible_name")) = 'nlado';
