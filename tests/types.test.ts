import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import {
  addDocument,
  createType,
  deleteDocument,
  deleteType,
  DomainError,
  getObject,
  listObjects,
  listTypes,
  renameType,
  setDocumentType,
  typeIdByName,
  updateObject,
} from "@/lib/repo";
import { seedInitialTree } from "@/lib/seed";
import { createTestDb } from "./helpers";

let db: Db;
const ids: Record<string, string> = {};

beforeEach(async () => {
  db = await createTestDb();
  await seedInitialTree(db);
  for (const o of await listObjects(db)) ids[o.name] = o.id;
});

describe("types d'objets", () => {
  it("fournit les types de départ et le nom du type sur chaque objet", async () => {
    const types = await listTypes(db, "objet");
    expect(types.map((t) => t.name)).toEqual(
      expect.arrayContaining(["bâtiment", "pièce", "propriété", "terrain", "véhicule"]),
    );
    expect(types.find((t) => t.name === "terrain")?.usage).toBe(3); // Prairies, Carrière, Pâtures
    expect((await getObject(db, ids["Annexe"]))?.type).toBe("bâtiment");
  });

  it("crée, renomme et refuse les doublons sans tenir compte de la casse", async () => {
    const t = await createType(db, "objet", "  Serre   chauffée ");
    expect(t.name).toBe("Serre chauffée");
    await expect(createType(db, "objet", "SERRE CHAUFFÉE")).rejects.toBeInstanceOf(DomainError);
    await renameType(db, "objet", t.id, "Serre");
    expect((await listTypes(db, "objet")).some((x) => x.name === "Serre")).toBe(true);
    await expect(renameType(db, "objet", t.id, "Pièce")).rejects.toThrow("existe déjà");
  });

  it("le renommage s'applique aux objets associés", async () => {
    const terrain = await typeIdByName(db, "objet", "terrain");
    await renameType(db, "objet", terrain, "parcelle");
    expect((await getObject(db, ids["Prairies"]))?.type).toBe("parcelle");
  });

  it("refuse de supprimer un type utilisé, accepte sinon", async () => {
    const piece = await typeIdByName(db, "objet", "pièce");
    await expect(deleteType(db, "objet", piece)).rejects.toThrow("2 objets l'utilisent");
    const libre = await createType(db, "objet", "Hangar");
    await deleteType(db, "objet", libre.id);
    expect((await listTypes(db, "objet")).some((x) => x.name === "Hangar")).toBe(false);
    // après réaffectation des objets, le type devient supprimable
    const autre = await typeIdByName(db, "objet", "équipement");
    for (const n of ["Salle de sport", "PoolHouse"]) {
      const o = (await getObject(db, ids[n]))!;
      await updateObject(db, o.id, { name: o.name, typeId: autre, description: null, location: null, tags: [] });
    }
    await deleteType(db, "objet", piece);
  });
});

describe("types de documents", () => {
  it("fournit les types de départ et bloque la suppression d'un type utilisé", async () => {
    const names = (await listTypes(db, "document")).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["Facture", "Garantie", "Mode d'emploi", "Guide de démarrage", "Autre"]));
    const facture = await typeIdByName(db, "document", "Facture");
    const garantie = await typeIdByName(db, "document", "Garantie");
    const d = await addDocument(db, {
      objectId: ids["PoolHouse"],
      typeId: facture,
      pathname: "test/documents/a/f.pdf",
      filename: "f.pdf",
      contentType: "application/pdf",
      size: 10,
    });
    await expect(deleteType(db, "document", facture)).rejects.toThrow("1 document l'utilise");
    await setDocumentType(db, d.id, garantie);
    await deleteType(db, "document", facture);
    await expect(deleteType(db, "document", garantie)).rejects.toBeInstanceOf(DomainError);
    await deleteDocument(db, d.id);
    await deleteType(db, "document", garantie);
  });
});
