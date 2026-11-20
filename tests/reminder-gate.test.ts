import { describe, expect, it } from "vitest";
import { invaliderProchainRappel, lireProchainRappel, noterProchainRappel, VEILLE_MAX_MS } from "@/lib/reminder-gate";
import { createTodo, listObjects } from "@/lib/repo";
import { seedInitialTree } from "@/lib/seed";
import { createTestDb } from "./helpers";

// Hors de Vercel, la note est gardée en mémoire du processus : même comportement.
describe("veille de la base entre deux rappels", () => {
  it("note le prochain rappel, borné à 3 h, et l'efface sur demande", async () => {
    const now = new Date();
    const dans1h = new Date(now.getTime() + 3600_000);
    expect((await noterProchainRappel(dans1h, now)).getTime()).toBe(dans1h.getTime());
    expect((await lireProchainRappel())?.getTime()).toBe(dans1h.getTime());

    const loin = new Date(now.getTime() + 48 * 3600_000);
    expect((await noterProchainRappel(loin, now)).getTime()).toBe(now.getTime() + VEILLE_MAX_MS);
    expect((await noterProchainRappel(null, now)).getTime()).toBe(now.getTime() + VEILLE_MAX_MS);

    await invaliderProchainRappel();
    expect(await lireProchainRappel()).toBeNull();
  });

  it("une tâche créée ou modifiée efface la note", async () => {
    const db = await createTestDb();
    await seedInitialTree(db);
    const [obj] = await listObjects(db);
    const now = new Date();
    await noterProchainRappel(null, now);
    expect(await lireProchainRappel()).not.toBeNull();
    await createTodo(db, { objectId: obj.id, title: "Nouvelle" });
    expect(await lireProchainRappel()).toBeNull();
  });
});
