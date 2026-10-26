import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import {
  addDocument,
  addLink,
  addPhoto,
  deleteDocument,
  deleteLink,
  deleteObject,
  DomainError,
  listDocuments,
  listLinks,
  listObjects,
  normalizeUrl,
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

describe("liens", () => {
  it("normalise les adresses et refuse les protocoles dangereux", () => {
    expect(normalizeUrl("pompe-irricall.fr/notice")).toBe("https://pompe-irricall.fr/notice");
    expect(normalizeUrl(" http://exemple.fr ")).toBe("http://exemple.fr/");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "", "pas une adresse"]) {
      expect(() => normalizeUrl(bad)).toThrow(DomainError);
    }
  });

  it("ajoute un lien avec un titre par défaut, puis le supprime", async () => {
    const l = await addLink(db, { objectId: ids["PoolHouse"], url: "www.piscine-pompes.fr/modele-x" });
    expect(l.title).toBe("piscine-pompes.fr");
    const l2 = await addLink(db, { objectId: ids["PoolHouse"], url: "https://a.fr", title: "  Garantie  " });
    expect(l2.title).toBe("Garantie");
    expect((await listLinks(db, ids["PoolHouse"])).map((x) => x.title)).toEqual(["piscine-pompes.fr", "Garantie"]);
    await deleteLink(db, l.id);
    expect(await listLinks(db, ids["PoolHouse"])).toHaveLength(1);
    await expect(deleteLink(db, l.id)).rejects.toBeInstanceOf(DomainError);
  });
});

describe("documents", () => {
  it("ajoute, liste et supprime des documents", async () => {
    const d = await addDocument(db, {
      objectId: ids["La ferme"],
      pathname: "test/documents/x/facture.pdf",
      filename: "Facture couvreur.pdf",
      contentType: "application/pdf",
      size: 12345,
    });
    expect((await listDocuments(db, ids["La ferme"]))[0].filename).toBe("Facture couvreur.pdf");
    expect(await deleteDocument(db, d.id)).toBe("test/documents/x/facture.pdf");
    expect(await listDocuments(db, ids["La ferme"])).toHaveLength(0);
  });

  it("la suppression d'un objet emporte ses documents, liens et photos", async () => {
    await addDocument(db, {
      objectId: ids["Prairies"],
      pathname: "test/documents/p/plan.pdf",
      filename: "plan.pdf",
      contentType: "application/pdf",
      size: 1,
    });
    await addLink(db, { objectId: ids["Prairies"], url: "cadastre.gouv.fr" });
    await addPhoto(db, { objectId: ids["Prairies"] }, { pathname: "test/a.jpg", thumbPathname: "test/a-v.jpg" });
    const files = await deleteObject(db, ids["Prairies"]);
    expect(files.sort()).toEqual(["test/a-v.jpg", "test/a.jpg", "test/documents/p/plan.pdf"]);
    expect(await listLinks(db, ids["Prairies"])).toHaveLength(0);
  });
});
