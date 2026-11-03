import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import { purge, testMarker } from "./helpers";

// Types de tâche avec icône, réglages des assistants IA et boutons IA d'une tâche.
// Les appels à l'IA passent par un faux serveur au format de l'API Anthropic :
// le serveur Carnet doit être lancé avec ANTHROPIC_BASE_URL=http://127.0.0.1:3199.
// Sans cette variable (ex. dev déployé), seule la partie types et réglages est jouée.

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
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const prompt: string = JSON.parse(body || "{}")?.messages?.[0]?.content ?? "";
      const text = prompt.includes("Consigne de l'utilisateur") && prompt.includes("Découpe cette tâche")
        ? JSON.stringify({ sous_taches: [{ titre: "Acheter la peinture", heures: 0.5 }], taches_similaires: [] })
        : prompt.includes("Découpe cette tâche")
        ? JSON.stringify({
            sous_taches: [
              { titre: "Gratter la rouille", heures: 1 },
              { titre: "Appliquer l'antirouille", heures: 0.5 },
            ],
            taches_similaires: [{ titre: "Huiler les gonds", description: "Avant l'hiver", heures: 0.25 }],
          })
        : "<p>Objectif : <strong>protéger le portail</strong> de la rouille.</p><ul><li>Gants</li></ul>";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ content: [{ type: "text", text }] }));
    });
  });
  await new Promise<void>((r) => server!.listen(3199, "127.0.0.1", r));
});
test.afterAll(async () => {
  await new Promise((r) => (server ? server.close(r) : r(undefined)));
});

test("types de tâche avec icône, réglages IA, compléter la description et proposer des sous-tâches", async ({ page }, info) => {
  const suffix = testMarker(info);
  const type = `Ferronnerie ${suffix}`;
  const objet = `Portail ${suffix}`;
  const tache = `Repeindre ${suffix}`;
  await login(page);

  // Un type de tâche avec son icône
  await page.goto("/types");
  const section = page.getByRole("region", { name: /Types de tâches/ });
  await expect(section.getByText("Entretien", { exact: true })).toBeVisible();
  await section.getByRole("button", { name: /Icône du nouveau type/ }).click();
  await page.getByRole("dialog", { name: "Icône du nouveau type" }).getByRole("button", { name: "Marteau" }).click();
  await section.getByLabel("Nouveau type", { exact: true }).fill(type);
  await section.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(section.getByRole("button", { name: `Icône du type ${type} : Marteau. Changer l'icône` })).toBeVisible();
  // Changement d'icône sur place, conservé
  await section.getByRole("button", { name: `Icône du type ${type} : Marteau. Changer l'icône` }).click();
  await page.getByRole("dialog", { name: `Icône du type ${type}` }).getByRole("button", { name: "Pinceau" }).click();
  await expect(page.getByRole("button", { name: `Icône du type ${type} : Pinceau. Changer l'icône` })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.getByRole("button", { name: `Icône du type ${type} : Pinceau. Changer l'icône` })).toBeVisible();

  // Clé d'API (factice) pour Claude
  if (FAKE_AI) {
    await page.goto("/utilisateurs/ia");
    const claude = page.getByRole("region", { name: "Claude (Anthropic)" });
    await claude.getByLabel("Clé d'API").fill("sk-ant-test-0123456789abcdefWXYZ");
    await claude.getByRole("button", { name: "Enregistrer" }).click();
    await expect(claude.getByText("Clé enregistrée …WXYZ")).toBeVisible();
    await expect(claude.getByLabel("Clé d'API")).toHaveValue("");
  }

  // Tâche de ce type : l'icône remplace la vignette dans les listes
  await page.goto("/objets/nouveau");
  await page.getByLabel("Nom").fill(objet);
  await page.getByRole("button", { name: "Créer l'objet" }).click();
  await expect(page.getByRole("heading", { level: 1, name: objet })).toBeVisible();
  await page.getByRole("link", { name: "Ajouter une tâche", exact: true }).click();
  await page.getByLabel("Titre", { exact: true }).fill(tache);
  await page.getByLabel("Type", { exact: true }).selectOption({ label: type });
  await page.getByRole("button", { name: "Créer la tâche" }).click();
  const row = page.getByRole("listitem").filter({ hasText: tache });
  await expect(row.getByText(type)).toBeVisible();
  await expect(row.locator("svg.lucide-paintbrush")).toBeVisible();
  await page.getByRole("link", { name: tache }).click();
  await expect(page.getByRole("heading", { level: 1, name: tache })).toBeVisible();
  await expect(page.getByLabel("Type", { exact: true })).toHaveValue(/.+/);

  if (!FAKE_AI) return;

  // Compléter la description : proposition, puis remplacement et enregistrement
  await page.getByRole("button", { name: "Compléter la description" }).click();
  const prop = page.getByTestId("proposition-description");
  await expect(prop).toContainText("protéger le portail");
  await prop.getByRole("button", { name: "Remplacer la description" }).click();
  await expect(page.getByText("Description remplacée : pense à enregistrer.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Description" })).toContainText("protéger le portail");

  // Proposer des sous-tâches : tout ajouter, y compris la tâche voisine
  await page.getByRole("button", { name: "Proposer des sous-tâches" }).click();
  const props = page.getByTestId("propositions-ia");
  await expect(props.getByRole("checkbox", { name: /Gratter la rouille/ })).toBeChecked();
  await expect(props.getByRole("checkbox", { name: /Huiler les gonds/ })).not.toBeChecked();
  await props.getByRole("checkbox", { name: /Huiler les gonds/ }).check();
  await props.getByRole("button", { name: "Ajouter la sélection (3)" }).click();
  await expect(page.getByText("Ajouté : 2 sous-tâches et 1 tâche.")).toBeVisible();
  await expect(page.getByTestId("sous-tache")).toHaveCount(2);
  await expect(page.getByTestId("sous-taches-total")).toContainText("1,5 h");

  // Second bouton : proposer avec une consigne ajoutée à la demande
  await page.getByRole("button", { name: "Avec une consigne…" }).click();
  await page.getByLabel("Consigne pour l'IA (ajoutée à la demande)").fill("avec le matériel à acheter");
  await page.getByRole("button", { name: "Proposer", exact: true }).click();
  await expect(props.getByRole("checkbox", { name: /Acheter la peinture/ })).toBeChecked();
  await props.getByRole("button", { name: "Ajouter la sélection (1)" }).click();
  await expect(page.getByTestId("sous-tache")).toHaveCount(3);

  // La description proposée est enregistrée avec la tâche
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: objet })).toBeVisible();
  await expect(page.getByRole("link", { name: "Huiler les gonds" })).toBeVisible();
  await page.getByRole("link", { name: tache }).click();
  await expect(page.getByRole("textbox", { name: "Description" })).toContainText("protéger le portail");

  // Sans clé, les boutons expliquent quoi faire
  await page.goto("/utilisateurs/ia");
  await page.getByRole("region", { name: "Claude (Anthropic)" }).getByRole("button", { name: "Retirer la clé" }).click();
  await expect(page.getByRole("region", { name: "Claude (Anthropic)" }).getByText("Pas de clé")).toBeVisible();
});
