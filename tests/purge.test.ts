import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import {
  addDocument,
  addPhoto,
  createObject,
  createTodo,
  createType,
  DomainError,
  listObjects,
  listTodos,
  listTypes,
  purgeTestData,
  typeIdByName,
} from "@/lib/repo";
import { seedInitialTree } from "@/lib/seed";
import { createTestDb } from "./helpers";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await seedInitialTree(db);
});

describe("purge des données de test", () => {
  it("supprime les objets marqués, leurs sous-arbres, tâches, fichiers et types, sans toucher au reste", async () => {
    const before = (await listObjects(db)).length;
    const keep = (await listObjects(db))[0];
    const root = await createObject(db, { name: "Tracteur e2e-abc" });
    const child = await createObject(db, { name: "Moteur", parentId: root.id });
    const grand = await createObject(db, { name: "Piston", parentId: child.id });
    const t = await createTodo(db, { objectId: grand.id, title: "Vidange" });
    const loose = await createTodo(db, { objectId: keep.id, title: "Tâche e2e-abc" });
    const untouched = await createTodo(db, { objectId: keep.id, title: "Vraie tâche" });
    await addPhoto(db, { objectId: child.id }, { pathname: "local/objets/a.jpg", thumbPathname: "local/objets/a-t.jpg" });
    await addPhoto(db, { todoId: loose.id }, { pathname: "local/taches/b.jpg", thumbPathname: "local/taches/b-t.jpg" });
    await addDocument(db, {
      owner: { objectId: root.id },
      typeId: await typeIdByName(db, "document", "Facture"),
      pathname: "local/documents/x/y/f.pdf",
      filename: "f.pdf",
      contentType: "application/pdf",
      size: 10,
    });
    await createType(db, "objet", "Type e2e-abc");
    await createType(db, "document", "Doc e2e-abc");

    const r = await purgeTestData(db, "E2E-ABC");
    expect(r.objects).toBe(3);
    expect(r.todos).toBe(2);
    expect(r.types).toBe(2);
    expect(r.files.sort()).toEqual(
      ["local/documents/x/y/f.pdf", "local/objets/a-t.jpg", "local/objets/a.jpg", "local/taches/b-t.jpg", "local/taches/b.jpg"].sort(),
    );
    expect((await listObjects(db)).length).toBe(before);
    const titles = (await listTodos(db)).map((x) => x.title);
    expect(titles).toContain(untouched.title);
    expect(titles).not.toContain(t.title);
    expect((await listTypes(db, "objet")).some((x) => x.name.includes("e2e"))).toBe(false);
  });

  it("garde un type marqué encore utilisé par un objet non marqué", async () => {
    const ty = await createType(db, "objet", "Serre e2e-xyz");
    await createObject(db, { name: "Vraie serre", typeId: ty.id });
    const r = await purgeTestData(db, "e2e-xyz");
    expect(r.types).toBe(0);
  });

  it("refuse un marqueur trop court et échappe les jokers", async () => {
    await expect(purgeTestData(db, "ab")).rejects.toBeInstanceOf(DomainError);
    const r = await purgeTestData(db, "%%%%");
    expect(r.objects).toBe(0);
  });
});
