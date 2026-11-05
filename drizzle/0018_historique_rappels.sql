-- Historique des rappels : les rappels déjà traités sont reportés dans le journal de leur tâche
-- (les nouveaux y sont inscrits au moment de l'envoi).
INSERT INTO "audit_log" ("at", "source", "user_id", "user_name", "entity_kind", "entity_id", "entity_label", "object_id", "action", "details")
SELECT
  d."at",
  'systeme',
  NULL,
  'Rappels',
  'tache',
  t."id",
  t."title",
  t."object_id",
  'rappel',
  jsonb_strip_nulls(jsonb_build_object(
    'rappel', upper(left(d."offset_key", 1)) || '-' || substr(d."offset_key", 2),
    'resultat', d."outcome",
    'canaux', to_jsonb(d."channels"),
    'destinataire', u."name",
    'echeance', d."due_key",
    'erreur', left(d."error", 500),
    'repris', true
  ))
FROM "reminder_deliveries" d
JOIN "todos" t ON t."id" = d."todo_id"
LEFT JOIN "users" u ON u."id" = d."user_id"
WHERE d."outcome" <> 'envoi';
