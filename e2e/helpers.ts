import { createHash } from "node:crypto";
import { expect, type Page, type TestInfo } from "@playwright/test";

/**
 * Marqueur propre à un test (stable d'un essai à l'autre) : tout ce que le test crée
 * porte ce marqueur dans son nom, ce qui permet de le purger avant et après.
 */
export function testMarker(info: TestInfo) {
  const h = createHash("sha1").update(info.testId).digest("hex").slice(0, 6);
  return `e2e-${info.project.name}-${h}`;
}

/** Supprime les données portant le marqueur (route réservée au dev, session requise). */
export async function purge(page: Page, marker: string) {
  const res = await page.request.post("/api/test/purge", { data: { marker } });
  if (res.status() === 401) return; // pas de session : le test n'a rien pu créer
  expect(res.ok(), `purge ${marker} : ${res.status()} ${await res.text()}`).toBeTruthy();
}
