import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  uniqueIndex,
  integer,
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

export const objects = pgTable(
  "objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    parentId: uuid("parent_id"),
    type: text("type"),
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

export type User = typeof users.$inferSelect;
export type ObjectRow = typeof objects.$inferSelect;
export type Todo = typeof todos.$inferSelect;
export type NewTodo = typeof todos.$inferInsert;
export type NewObject = typeof objects.$inferInsert;

export const CATEGORIES = categoryEnum.enumValues;
export const PRIORITIES = priorityEnum.enumValues;
export const STATUSES = statusEnum.enumValues;
export const RECURRENCES = recurrenceEnum.enumValues;
export const ROLES = roleEnum.enumValues;
