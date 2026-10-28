import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import {
  addSubtask,
  createTodo,
  deleteSubtask,
  deleteTodo,
  DomainError,
  listObjects,
  listSubtasks,
  reorderSubtasks,
  setTodoStatus,
  updateSubtask,
} from "@/lib/repo";
import { seedInitialTree } from "@/lib/seed";
import { createTestDb } from "./helpers";

let db: Db;
let objectId: string;

beforeEach(async () => {
  db = await createTestDb();
  await seedInitialTree(db);
  objectId = (await listObjects(db))[0].id;
});

const titles = async (todoId: string) => (await listSubtasks(db, todoId)).map((s) => s.title);

describe("sous-tâches", () => {
  it("s'ajoutent en fin de liste, se cochent, se renomment et se suppriment", async () => {
    const t = await createTodo(db, { objectId, title: "Repeindre le portail" });
    const a = await addSubtask(db, t.id, "  Poncer  ");
    await addSubtask(db, t.id, "Sous-couche");
    const c = await addSubtask(db, t.id, "Deux couches");
    expect(await titles(t.id)).toEqual(["Poncer", "Sous-couche", "Deux couches"]);

    await updateSubtask(db, a.id, { done: true });
    await updateSubtask(db, c.id, { title: "Deux couches de finition" });
    const list = await listSubtasks(db, t.id);
    expect(list.map((s) => s.done)).toEqual([true, false, false]);
    expect(list[2].title).toBe("Deux couches de finition");

    await deleteSubtask(db, a.id);
    expect(await titles(t.id)).toEqual(["Sous-couche", "Deux couches de finition"]);
    await expect(deleteSubtask(db, a.id)).rejects.toThrow(DomainError);
  });

  it("refuse un texte vide ou trop long, et une tâche inconnue", async () => {
    const t = await createTodo(db, { objectId, title: "Tâche" });
    await expect(addSubtask(db, t.id, "   ")).rejects.toThrow(DomainError);
    await expect(addSubtask(db, t.id, "x".repeat(301))).rejects.toThrow(DomainError);
    await expect(addSubtask(db, "00000000-0000-0000-0000-000000000000", "A")).rejects.toThrow("Tâche introuvable");
    const s = await addSubtask(db, t.id, "A");
    await expect(updateSubtask(db, s.id, { title: "" })).rejects.toThrow(DomainError);
  });

  it("se réordonnent, uniquement avec la liste complète de la tâche", async () => {
    const t = await createTodo(db, { objectId, title: "Tâche" });
    const other = await createTodo(db, { objectId, title: "Autre" });
    const [a, b, c] = [await addSubtask(db, t.id, "A"), await addSubtask(db, t.id, "B"), await addSubtask(db, t.id, "C")];
    const x = await addSubtask(db, other.id, "X");

    await reorderSubtasks(db, t.id, [c.id, a.id, b.id]);
    expect(await titles(t.id)).toEqual(["C", "A", "B"]);
    // Ajoutée après un réordonnancement : toujours en dernier
    await addSubtask(db, t.id, "D");
    expect(await titles(t.id)).toEqual(["C", "A", "B", "D"]);

    await expect(reorderSubtasks(db, t.id, [a.id, b.id])).rejects.toThrow(DomainError);
    await expect(reorderSubtasks(db, t.id, [a.id, b.id, c.id, x.id])).rejects.toThrow(DomainError);
    await expect(reorderSubtasks(db, t.id, [a.id, a.id, b.id, c.id])).rejects.toThrow(DomainError);
    expect(await titles(t.id)).toEqual(["C", "A", "B", "D"]);
    expect(await titles(other.id)).toEqual(["X"]);
  });

  it("sont reprises décochées par l'occurrence suivante d'une tâche récurrente", async () => {
    const t = await createTodo(db, { objectId, title: "Vidange", recurrence: "annuelle", dueDate: "2026-03-01" });
    const a = await addSubtask(db, t.id, "Huile");
    await addSubtask(db, t.id, "Filtre");
    await updateSubtask(db, a.id, { done: true });
    const next = await setTodoStatus(db, t.id, "fait", {}, "2026-03-02");
    expect(next).toBeTruthy();
    const subs = await listSubtasks(db, next!);
    expect(subs.map((s) => [s.title, s.done])).toEqual([
      ["Huile", false],
      ["Filtre", false],
    ]);
    // L'occurrence terminée garde ses cases
    expect((await listSubtasks(db, t.id)).map((s) => s.done)).toEqual([true, false]);
  });

  it("disparaissent avec leur tâche", async () => {
    const t = await createTodo(db, { objectId, title: "Tâche" });
    await addSubtask(db, t.id, "A");
    await deleteTodo(db, t.id);
    expect(await listSubtasks(db, t.id)).toEqual([]);
  });
});
