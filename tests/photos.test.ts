import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import {
  addPhoto,
  createTodo,
  deleteObject,
  deletePhoto,
  deleteTodo,
  DomainError,
  listObjects,
  listPhotos,
  listTodos,
  objectCovers,
  setCoverPhoto,
  todoCountByObject,
} from "@/lib/repo";
import { seedInitialTree } from "@/lib/seed";
import { createTestDb } from "./helpers";

let db: Db;
const ids: Record<string, string> = {};
const file = (n: string) => ({ pathname: `test/${n}.jpg`, thumbPathname: `test/${n}-v.jpg`, width: 800, height: 600 });

beforeEach(async () => {
  db = await createTestDb();
  await seedInitialTree(db);
  for (const o of await listObjects(db)) ids[o.name] = o.id;
});

describe("photos", () => {
  it("la première photo devient la vignette, on peut en changer", async () => {
    const a = await addPhoto(db, { objectId: ids["PoolHouse"] }, file("a"));
    const b = await addPhoto(db, { objectId: ids["PoolHouse"] }, file("b"));
    expect(a.isCover).toBe(true);
    expect(b.isCover).toBe(false);
    await setCoverPhoto(db, b.id);
    const list = await listPhotos(db, { objectId: ids["PoolHouse"] });
    expect(list.map((p) => [p.id, p.isCover])).toEqual([
      [b.id, true],
      [a.id, false],
    ]);
    expect((await objectCovers(db)).get(ids["PoolHouse"])).toBe(b.id);
  });

  it("supprimer la vignette promeut la photo la plus ancienne restante", async () => {
    const a = await addPhoto(db, { objectId: ids["Carrière"] }, file("a"));
    const b = await addPhoto(db, { objectId: ids["Carrière"] }, file("b"));
    const files = await deletePhoto(db, a.id);
    expect(files).toEqual(["test/a.jpg", "test/a-v.jpg"]);
    const [left] = await listPhotos(db, { objectId: ids["Carrière"] });
    expect(left.id).toBe(b.id);
    expect(left.isCover).toBe(true);
  });

  it("vignette des tâches dans la liste, et nettoyage à la suppression", async () => {
    const t = await createTodo(db, { objectId: ids["Prairies"], title: "Clôture" });
    const p = await addPhoto(db, { todoId: t.id }, file("c"));
    const [row] = await listTodos(db, { subtreeOf: ids["Prairies"] });
    expect(row.coverPhotoId).toBe(p.id);
    expect(await deleteTodo(db, t.id)).toEqual(["test/c.jpg", "test/c-v.jpg"]);
    expect(await listPhotos(db, { todoId: t.id })).toHaveLength(0);
  });

  it("un objet supprimé emporte ses photos ; une photo sans propriétaire existant est refusée", async () => {
    await addPhoto(db, { objectId: ids["Prairies"] }, file("d"));
    expect(await deleteObject(db, ids["Prairies"])).toEqual(["test/d.jpg", "test/d-v.jpg"]);
    await expect(addPhoto(db, { objectId: ids["Prairies"] }, file("e"))).rejects.toBeInstanceOf(DomainError);
  });

  it("compte toutes les tâches par objet, faites comprises", async () => {
    await createTodo(db, { objectId: ids["La ferme"], title: "A" });
    await createTodo(db, { objectId: ids["La ferme"], title: "B", status: "fait" });
    expect((await todoCountByObject(db)).get(ids["La ferme"])).toBe(2);
  });
});
