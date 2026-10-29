import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  uniqueIndex,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["admin", "membre"]);
export const categoryEnum = pgEnum("category", ["entretien", "travaux", "administratif"]);
export const priorityEnum = pgEnum("priority", ["haute", "moyenne", "basse"]);
export const statusEnum = pgEnum("status", ["a_faire", "en_cours", "fait"]);
export const recurrenceEnum = pgEnum("recurrence", ["aucune", "mensuelle", "saisonniere", "annuelle"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: roleEnum("role").notNull().default("membre"),
  weeklyHoursAvailable: numeric("weekly_hours_available", { precision: 6, scale: 2, mode: "number" }),
  skills: text("skills"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const objectTypes = pgTable(
  "object_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("object_types_name_uq").on(sql`lower(${t.name})`)],
);

export const documentTypes = pgTable(
  "document_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("document_types_name_uq").on(sql`lower(${t.name})`)],
);

export const objects = pgTable(
  "objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    parentId: uuid("parent_id"),
    typeId: uuid("type_id").references(() => objectTypes.id, { onDelete: "restrict" }),
    description: text("description"),
    location: text("location"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id], name: "objects_parent_fk" }).onDelete("restrict"),
    index("objects_parent_idx").on(t.parentId),
    index("objects_type_idx").on(t.typeId),
    check("objects_not_own_parent", sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
  ],
);

export const todos = pgTable(
  "todos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    objectId: uuid("object_id")
      .notNull()
      .references(() => objects.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    category: categoryEnum("category").notNull().default("entretien"),
    priority: priorityEnum("priority").notNull().default("moyenne"),
    status: statusEnum("status").notNull().default("a_faire"),
    estHours: numeric("est_hours", { precision: 8, scale: 2, mode: "number" }),
    actualHours: numeric("actual_hours", { precision: 8, scale: 2, mode: "number" }),
    estValueEur: numeric("est_value_eur", { precision: 12, scale: 2, mode: "number" }),
    actualValueEur: numeric("actual_value_eur", { precision: 12, scale: 2, mode: "number" }),
    dueDate: date("due_date", { mode: "string" }),
    recurrence: recurrenceEnum("recurrence").notNull().default("aucune"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    doneAt: timestamp("done_at", { withTimezone: true }),
    previousOccurrenceId: uuid("previous_occurrence_id"),
  },
  (t) => [
    index("todos_object_idx").on(t.objectId),
    index("todos_status_idx").on(t.status),
    index("todos_assignee_idx").on(t.assigneeId),
    uniqueIndex("todos_previous_occurrence_uq").on(t.previousOccurrenceId),
    foreignKey({ columns: [t.previousOccurrenceId], foreignColumns: [t.id], name: "todos_previous_occurrence_fk" }).onDelete(
      "set null",
    ),
  ],
);

/** Sous-tâches : une liste ordonnée de cases à cocher dans une tâche. */
export const subtasks = pgTable(
  "subtasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    todoId: uuid("todo_id")
      .notNull()
      .references(() => todos.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("subtasks_todo_idx").on(t.todoId, t.position)],
);

export const photos = pgTable(
  "photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    objectId: uuid("object_id").references(() => objects.id, { onDelete: "cascade" }),
    todoId: uuid("todo_id").references(() => todos.id, { onDelete: "cascade" }),
    pathname: text("pathname").notNull(),
    thumbPathname: text("thumb_pathname").notNull(),
    width: integer("width"),
    height: integer("height"),
    isCover: boolean("is_cover").notNull().default(false),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("photos_object_idx").on(t.objectId),
    index("photos_todo_idx").on(t.todoId),
    check("photos_one_owner", sql`(${t.objectId} IS NULL) <> (${t.todoId} IS NULL)`),
    uniqueIndex("photos_object_cover_uq").on(t.objectId).where(sql`${t.isCover} AND ${t.objectId} IS NOT NULL`),
    uniqueIndex("photos_todo_cover_uq").on(t.todoId).where(sql`${t.isCover} AND ${t.todoId} IS NOT NULL`),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Un document appartient à un objet OU à une tâche
    objectId: uuid("object_id").references(() => objects.id, { onDelete: "cascade" }),
    todoId: uuid("todo_id").references(() => todos.id, { onDelete: "cascade" }),
    pathname: text("pathname").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    typeId: uuid("type_id")
      .notNull()
      .references(() => documentTypes.id, { onDelete: "restrict" }),
    size: integer("size").notNull(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("documents_object_idx").on(t.objectId),
    index("documents_todo_idx").on(t.todoId),
    index("documents_type_idx").on(t.typeId),
    check("documents_one_owner", sql`(${t.objectId} IS NULL) <> (${t.todoId} IS NULL)`),
    uniqueIndex("documents_pathname_uq").on(t.pathname),
  ],
);

export const links = pgTable(
  "links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Un lien appartient à un objet OU à une tâche
    objectId: uuid("object_id").references(() => objects.id, { onDelete: "cascade" }),
    todoId: uuid("todo_id").references(() => todos.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title").notNull(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("links_object_idx").on(t.objectId),
    index("links_todo_idx").on(t.todoId),
    check("links_one_owner", sql`(${t.objectId} IS NULL) <> (${t.todoId} IS NULL)`),
  ],
);

// ---------- Journal des actions ----------

export const auditSourceEnum = pgEnum("audit_source", ["interface", "api", "mcp", "systeme"]);
export const auditEntityEnum = pgEnum("audit_entity", ["objet", "tache"]);

/**
 * Journal des actions sur les objets et les tâches (et ce qui y est rattaché).
 * Pas de clé étrangère vers l'élément : l'entrée reste après sa suppression,
 * avec le nom de l'élément et de l'auteur au moment de l'action.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    source: auditSourceEnum("source").notNull(),
    // Application ou jeton utilisé (MCP, API)
    client: text("client"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    userName: text("user_name").notNull(),
    entityKind: auditEntityEnum("entity_kind").notNull(),
    entityId: uuid("entity_id").notNull(),
    entityLabel: text("entity_label").notNull(),
    // Objet concerné : l'objet lui-même, ou celui de la tâche
    objectId: uuid("object_id"),
    action: text("action").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entityKind, t.entityId, t.at),
    index("audit_log_object_idx").on(t.objectId, t.at),
    index("audit_log_at_idx").on(t.at),
  ],
);

export type AuditEntry = typeof auditLog.$inferSelect;
export type AuditSource = (typeof auditSourceEnum.enumValues)[number];

export type User = typeof users.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type LinkRow = typeof links.$inferSelect;
export type Subtask = typeof subtasks.$inferSelect;
// ---------- Accès des assistants IA (MCP) ----------

/** Applications clientes OAuth (enregistrement dynamique, RFC 7591). */
export const oauthClients = pgTable("oauth_clients", {
  id: text("id").primaryKey(), // client_id
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Codes d'autorisation OAuth (usage unique, courte durée, PKCE obligatoire). */
export const oauthCodes = pgTable(
  "oauth_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    scope: text("scope").notNull(),
    resource: text("resource"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("oauth_codes_expires_idx").on(t.expiresAt)],
);

export const tokenKindEnum = pgEnum("token_kind", ["personnel", "acces", "rafraichissement"]);

/**
 * Jetons d'accès au MCP. Seule l'empreinte SHA-256 est stockée.
 * - personnel : créé par l'utilisateur, sans expiration (révocable) ;
 * - acces / rafraichissement : émis par OAuth pour un client, liés par grantId.
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: tokenKindEnum("kind").notNull(),
    tokenHash: text("token_hash").notNull(),
    prefix: text("prefix").notNull(),
    name: text("name").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id").references(() => oauthClients.id, { onDelete: "cascade" }),
    grantId: uuid("grant_id"),
    scope: text("scope").notNull().default("lecture"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_tokens_hash_uq").on(t.tokenHash),
    index("api_tokens_user_idx").on(t.userId),
    index("api_tokens_grant_idx").on(t.grantId),
  ],
);

export type OAuthClient = typeof oauthClients.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;

export type Photo = typeof photos.$inferSelect;
export type ObjectBase = typeof objects.$inferSelect;
/** Objet avec le nom de son type (jointure). */
export type ObjectRow = ObjectBase & { type: string | null };
export type ObjectType = typeof objectTypes.$inferSelect;
export type DocumentType = typeof documentTypes.$inferSelect;
export type Todo = typeof todos.$inferSelect;
export type NewTodo = typeof todos.$inferInsert;
export type NewObject = typeof objects.$inferInsert;

export const CATEGORIES = categoryEnum.enumValues;
export const PRIORITIES = priorityEnum.enumValues;
export const STATUSES = statusEnum.enumValues;
export const RECURRENCES = recurrenceEnum.enumValues;
export const ROLES = roleEnum.enumValues;
