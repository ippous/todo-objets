import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { auditLog } from "@/db/schema";
import { actorOf } from "@/lib/audit";
import { dependencyEdges, getDependencies, isBlocked, newlyReady, setDependencies } from "@/lib/dependencies";
import { createTodo, createUser, DomainError, deleteTodo, getTodo, listObjects, listTodos, setTodoStatus, updateTodo } from "@/lib/repo";
import { seedInitialTree } from "@/lib/seed";
import { createTestDb } from "./helpers";

let db: Db;
let objectId: string;

beforeEach(async () => {
  db = await createTestDb();
  await seedInitialTree(db);
  objectId = (await listObjects(db))[0].id;
});

const task = (title: string, extra: Record<string, unknown> = {}) => createTodo(db, { objectId, title, ...extra });

describe("enchaînement des tâches", () => {
  it("une tâche attend ses prédécesseurs, est bloquée puis prête", async () => {
    const a = await task("Démonter la clôture");
    const b = await task("Labourer");
    const c = await task("Semer");
    await setDependencies(db, c.id, [a.id, b.id]);
    let d = await getDependencies(db, c.id);
    expect(d.attend.map((t) => t.title).sort()).toEqual(["Démonter la clôture", "Labourer"]);
    expect(isBlocked(d.attend)).toBe(true);
    expect((await getDependencies(db, a.id)).debloque.map((t) => t.title)).toEqual(["Semer"]);
    expect((await listTodos(db, {})).find((t) => t.id === c.id)!.blockedBy).toBe(2);

    await setTodoStatus(db, a.id, "fait");
    expect(await newlyReady(db, a.id)).toHaveLength(0); // Labourer reste à faire
    await setTodoStatus(db, b.id, "fait");
    expect((await newlyReady(db, b.id)).map((t) => t.title)).toEqual(["Semer"]);
    d = await getDependencies(db, c.id);
    expect(isBlocked(d.attend)).toBe(false);
    expect((await listTodos(db, {})).find((t) => t.id === c.id)!.blockedBy).toBe(0);
    expect(await dependencyEdges(db, [a.id, b.id, c.id])).toHaveLength(2);
  });

  it("refuse elle-même, une tâche inconnue et les boucles directes ou indirectes", async () => {
    const a = await task("A");
    const b = await task("B");
    const c = await task("C");
    await expect(setDependencies(db, a.id, [a.id])).rejects.toThrow("elle-même");
    await expect(setDependencies(db, a.id, ["00000000-0000-0000-0000-000000000000"])).rejects.toThrow("introuvable");
    await setDependencies(db, b.id, [a.id]);
    await setDependencies(db, c.id, [b.id]);
    await expect(setDependencies(db, a.id, [b.id])).rejects.toThrow(DomainError);
    await expect(setDependencies(db, a.id, [c.id])).rejects.toThrow("Boucle");
    // Remplacer la liste : on peut retirer puis ajouter
    await setDependencies(db, c.id, [a.id]);
    expect((await getDependencies(db, c.id)).attend.map((t) => t.title)).toEqual(["A"]);
    await setDependencies(db, c.id, []);
    expect((await getDependencies(db, c.id)).attend).toHaveLength(0);
  });

  it("disparaît avec la tâche, et se trace dans le journal", async () => {
    const user = await createUser(db, { email: "e@x.fr", name: "Eric" });
    const actor = actorOf(user, "interface");
    const a = await task("A");
    const b = await task("B");
    await setDependencies(db, b.id, [a.id], actor);
    const log = await db.select().from(auditLog);
    expect(log.find((l) => l.action === "dependances")?.details).toEqual({ ajoutees: ["A"], retirees: [] });
    await deleteTodo(db, a.id);
    expect((await getDependencies(db, b.id)).attend).toHaveLength(0);
  });

  it("date de début : avant l'échéance, et décalée avec la récurrence", async () => {
    await expect(task("X", { startDate: "2026-12-10", dueDate: "2026-12-01" })).rejects.toThrow();
    const t = await task("Vidange", { startDate: "2026-11-25", dueDate: "2026-11-30", recurrence: "mensuelle" });
    const next = await setTodoStatus(db, t.id, "fait", { today: "2026-11-30" });
    const n = (await getTodo(db, next!))!;
    expect([n.startDate, n.dueDate]).toEqual(["2026-12-25", "2026-12-30"]);
    await updateTodo(db, t.id, { startDate: null });
    expect((await getTodo(db, t.id))!.startDate).toBeNull();
  });
});
