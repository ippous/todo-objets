import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import { purge, testMarker } from "./helpers";

// Commandes de saisie : création, test, aide IA, $$ (résultat inséré) et @@ (recalculé à l'affichage).
// L'aide IA passe par un faux serveur (ANTHROPIC_BASE_URL=http://127.0.0.1:3199 côté Carnet, E2E_FAKE_AI=1 ici)
// et suppose une clé Claude enregistrée (le test la pose puis la retire).

const EMAIL = process.env.E2E_EMAIL ?? "ippous@gmail.com";
const SECRET = process.env.E2E_SECRET ?? "test-local";
const FAKE_AI = process.env.E2E_FAKE_AI === "1";

test.beforeEach(async ({ page }) => {
  const share = process.env.E2E_VERCEL_SHARE;
  if (share) await page.goto(`/?_vercel_share=${encodeURIComponent(share)}`);
});

async function login(page: Page) {
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail autorisée").fill(EMAIL);
  await page.getByLabel("Code de test").fill(SECRET);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Arbre des objets" })).toBeVisible();
  await purge(page, testMarker(test.info()));
}

test.afterEach(async ({ page }, info) => {
  await purge(page, testMarker(info));
});

let server: Server | undefined;
test.beforeAll(async () => {
  if (!FAKE_AI) return;
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ content: [{ type: "text", text: "```js\n// Proposé par l'IA\nreturn 'semaine ' + 45;\n```" }] }));
    });
  });
  await new Promise<void>((r) => server!.listen(3199, "127.0.0.1", r));
});
test.afterAll(async () => {
  await new Promise((r) => (server ? server.close(r) : r(undefined)));
});

const codeField = (page: Page) => page.getByLabel(/Code JavaScript/);

test("commandes : création, test, IA, $$ et @@ dans les descriptions", async ({ page }, info) => {
  const m = testMarker(info);
  const name = `bonjour-${m}`.toLowerCase().slice(0, 40);
  const objet = `Portail ${m}`;
  const tache = `Repeindre ${m}`;
  await login(page);

  if (FAKE_AI) {
    await page.goto("/utilisateurs/ia");
    const claude = page.getByRole("region", { name: "Claude (Anthropic)" });
    await claude.getByLabel("Clé d'API").fill("sk-ant-test-0123456789abcdefWXYZ");
    await claude.getByRole("button", { name: "Enregistrer" }).click();
    await expect(claude.getByText("Clé enregistrée …WXYZ")).toBeVisible();
  }

  // Création : test du code, erreurs, boucle infinie arrêtée
  await page.goto("/commandes");
  await expect(page.getByRole("link", { name: "date", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Nouvelle commande" }).click();
  await page.getByLabel(/^Nom/).fill(name);
  await page.getByLabel(/^Description/).fill("Salutation de test");
  await codeField(page).fill("return x;");
  await page.getByRole("button", { name: "Tester" }).click();
  await expect(page.getByTestId("resultat-test")).toContainText("ReferenceError");
  await codeField(page).fill("while (true) {}");
  await page.getByRole("button", { name: "Tester" }).click();
  await expect(page.getByTestId("resultat-test")).toContainText("Délai dépassé", { timeout: 5000 });
  await codeField(page).fill("return typeof fetch;");
  await page.getByRole("button", { name: "Tester" }).click();
  await expect(page.getByTestId("resultat-test")).toContainText("undefined");

  if (FAKE_AI) {
    await page.getByLabel(/Ce que doit faire la commande/).fill("le numéro de la semaine");
    await page.getByRole("button", { name: "Écrire le code" }).click();
    await expect(codeField(page)).toHaveValue(/return 'semaine ' \+ 45;/);
    await page.getByRole("button", { name: "Tester" }).click();
    await expect(page.getByTestId("resultat-test")).toContainText("semaine 45");
    await page.getByRole("button", { name: "Revenir au code précédent" }).click();
    await expect(codeField(page)).toHaveValue("return typeof fetch;");
  }

  await codeField(page).fill('return "Bonjour " + ctx.titre;');
  await page.getByRole("button", { name: "Tester" }).click();
  await expect(page.getByTestId("resultat-test")).toContainText("Bonjour Repeindre le portail");
  await page.getByRole("button", { name: "Créer la commande" }).click();
  await expect(page.getByText("Enregistrée.")).toBeVisible();
  const commandUrl = page.url();

  // Objet avec @@ dans sa description : recalculé à l'affichage
  await page.goto("/objets/nouveau");
  await page.getByLabel("Nom").fill(objet);
  const objEditor = page.getByRole("textbox", { name: "Description", exact: true });
  await objEditor.click();
  await page.keyboard.type(`Accueil : @@${name}`);
  await expect(page.getByRole("listbox", { name: /recalculées/ }).getByRole("option", { name: new RegExp(name) })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(objEditor.locator(".commande-live")).toHaveText(`Bonjour ${objet}`);
  await page.getByRole("button", { name: "Créer l'objet" }).click();
  await expect(page.getByRole("heading", { level: 1, name: objet })).toBeVisible();
  await expect(page.locator(".rich .commande-live")).toHaveText(`Bonjour ${objet}`);

  // Tâche : $$ insère le texte une fois pour toutes, @@ reste dynamique
  await page.getByRole("link", { name: "Ajouter une tâche", exact: true }).click();
  await page.getByLabel("Titre", { exact: true }).fill(tache);
  await page.getByRole("button", { name: "Créer la tâche" }).click();
  await page.getByRole("link", { name: tache }).click();
  await expect(page.getByRole("heading", { level: 1, name: tache })).toBeVisible();
  const editor = page.getByRole("textbox", { name: "Description", exact: true });
  await editor.click();
  await page.keyboard.type(`$$${name.slice(0, 5)}`);
  const list = page.getByRole("listbox", { name: /résultat inséré/ });
  await expect(list.getByRole("option", { name: new RegExp(name) })).toBeVisible();
  await page.keyboard.type(name.slice(5));
  await page.keyboard.press("Enter");
  await expect(editor).toContainText(`Bonjour ${tache}`);
  await expect(editor).not.toContainText("$$");
  // Commande inconnue : message, et Entrée reste un retour à la ligne
  await page.keyboard.type(" $$inexistante");
  await expect(page.getByText("Aucune commande « inexistante »")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: objet })).toBeVisible();
  await page.getByRole("link", { name: tache }).click();
  await expect(page.getByRole("textbox", { name: "Description", exact: true })).toContainText(`Bonjour ${tache}`);

  // Suppression de la commande : les @@ restants signalent l'erreur
  await page.goto(commandUrl);
  await page.getByRole("button", { name: "Supprimer la commande" }).click();
  await page.getByRole("button", { name: "Oui, supprimer" }).click();
  await expect(page.getByRole("heading", { name: "Commandes de saisie" })).toBeVisible();
  await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);

  if (FAKE_AI) {
    await page.goto("/utilisateurs/ia");
    await page.getByRole("region", { name: "Claude (Anthropic)" }).getByRole("button", { name: "Retirer la clé" }).click();
    await expect(page.getByRole("region", { name: "Claude (Anthropic)" }).getByText("Pas de clé")).toBeVisible();
  }
});
