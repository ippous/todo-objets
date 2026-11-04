import { expect, test } from "@playwright/test";
import { purge, testMarker } from "./helpers";

const EMAIL = process.env.E2E_EMAIL ?? "ippous@gmail.com";
const SECRET = process.env.E2E_SECRET ?? "test-local";

test.beforeEach(async ({ page }, info) => {
  const share = process.env.E2E_VERCEL_SHARE;
  if (share) await page.goto(`/?_vercel_share=${encodeURIComponent(share)}`);
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail autorisée").fill(EMAIL);
  await page.getByLabel("Code de test").fill(SECRET);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Arbre des objets" })).toBeVisible();
  await purge(page, testMarker(info));
});

test.afterEach(async ({ page }, info) => {
  await purge(page, testMarker(info));
});

test("$$tel, $$mail, $$what, $$contact insèrent des liens d'action", async ({ page, request }, info) => {
  const m = testMarker(info);
  await page.goto("/taches/nouvelle");
  await page.getByLabel("Titre", { exact: true }).fill(`Appeler le maréchal ${m}`);
  await page.getByLabel("Objet concerné").selectOption({ index: 1 });
  const desc = page.getByRole("textbox", { name: "Description" });
  await desc.click();

  // Les commandes intégrées sont proposées après $$
  await page.keyboard.type("$$t");
  await expect(page.getByRole("option", { name: /\$\$tel/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type("06 12 34 56 78)");
  await expect(desc.locator('a[href="tel:0612345678"]')).toHaveText("06 12 34 56 78");

  await page.keyboard.type("$$mail(jean@societe.fr)");
  await expect(desc.locator('a[href="mailto:jean@societe.fr"]')).toBeVisible();
  await page.keyboard.type("$$WHAT(06 12 34 56 78)");
  await expect(desc.locator('a[href="https://wa.me/33612345678"]')).toHaveText("WhatsApp 06 12 34 56 78");
  await page.keyboard.type("$$contact(Jean Dupont; 06 12 34 56 78; jean@societe.fr)");
  const contact = desc.locator('a[href^="/api/vcard"]');
  await expect(contact).toHaveText("Jean Dupont");
  await page.keyboard.type("$$mail(pas-une-adresse)");
  await expect(page.getByRole("alert").filter({ hasText: "n'est pas une adresse e-mail" })).toBeVisible();

  await page.getByRole("button", { name: "Créer la tâche" }).click();
  await page.goto(`/taches?q=${encodeURIComponent(m)}`);
  await page.getByRole("link", { name: `Appeler le maréchal ${m}` }).click();
  const saved = page.getByRole("textbox", { name: "Description" });
  await expect(saved.locator('a[href="tel:0612345678"]')).toBeVisible();
  await expect(saved.locator('a[href="https://wa.me/33612345678"]')).toBeVisible();

  // La fiche contact est servie en vCard
  const href = (await saved.locator('a[href^="/api/vcard"]').getAttribute("href"))!;
  const res = await page.request.get(href);
  expect(res.headers()["content-type"]).toContain("text/vcard");
  expect(await res.text()).toContain("FN:Jean Dupont");
  // …et pas sans connexion
  expect((await request.get(href, { headers: { cookie: "" } })).status()).toBe(401);
});
