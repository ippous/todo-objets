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

test("échéance avec heure, schéma de rappel créé par l'admin et choisi sur la tâche", async ({ page }, info) => {
  const m = testMarker(info);

  // Schéma créé par un administrateur
  await page.goto("/utilisateurs/rappels");
  await expect(page.getByRole("heading", { level: 1, name: "Schémas de rappel" })).toBeVisible();
  await expect(page.getByText("J-10 / J-5 / J-2 / J-1")).toBeVisible();
  await page.getByLabel("Nom").fill(`RDV ${m}`);
  await page.getByLabel("Rappels").fill("m-10 j-10 h3 J-1");
  await page.getByRole("button", { name: "Ajouter le schéma" }).click();
  await expect(page.getByText(`RDV ${m}`, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("J-10 / J-1 / H-3 / M-10").last()).toBeVisible();
  await expect(page.getByLabel("Nom")).toHaveValue("");
  await page.getByLabel("Nom").fill(`Faux ${m}`);
  await page.getByLabel("Rappels").fill("S-2");
  await page.getByRole("button", { name: "Ajouter le schéma" }).click();
  await expect(page.getByText("« S-2 » n'est pas compris")).toBeVisible();

  // Tâche avec date, heure et ce schéma
  await page.goto("/taches/nouvelle");
  await page.getByLabel("Titre", { exact: true }).fill(`Vétérinaire ${m}`);
  await page.getByLabel("Objet concerné").selectOption({ index: 1 });
  const time = page.getByLabel("Heure (facultative)");
  await expect(time).toBeDisabled();
  await page.getByLabel("Échéance", { exact: true }).fill("2099-03-12");
  await time.fill("14:30");
  await page.getByRole("combobox", { name: "Rappels" }).selectOption({ label: `RDV ${m} · J-10 / J-1 / H-3 / M-10` });
  await expect(page.getByText("comptés depuis le 12/03/2099 à 14:30")).toBeVisible();
  await page.getByRole("button", { name: "Créer la tâche" }).click();

  await page.goto(`/taches?q=${encodeURIComponent(m)}`);
  await expect(page.getByText("12 mars 2099 à 14:30")).toBeVisible();
  await page.getByRole("link", { name: `Vétérinaire ${m}` }).click();
  await expect(page.getByText(`Rappels « RDV ${m} » : prochain (J-10) le 2 mars 2099`)).toBeVisible();
  await expect(page.getByLabel("Heure (facultative)")).toHaveValue("14:30");

  // Sans date, l'heure disparaît
  await page.getByLabel("Échéance", { exact: true }).fill("");
  await expect(page.getByLabel("Heure (facultative)")).toHaveValue("");
});

test("page Mes rappels et route d'envoi protégée", async ({ page, request }) => {
  await page.goto("/rappels");
  await expect(page.getByRole("heading", { level: 1, name: "Mes rappels" })).toBeVisible();
  await expect(page.getByLabel(/Par e-mail/)).toBeVisible();
  await page.getByLabel(/Par e-mail/).uncheck();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Enregistré.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/Par e-mail/)).not.toBeChecked();
  await page.getByLabel(/Par e-mail/).check();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Enregistré.")).toBeVisible();

  const res = await request.get("/api/rappels/envoyer");
  expect(res.status()).toBe(401);
});
