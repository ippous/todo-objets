import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import { purge, testMarker } from "./helpers";

// Page Assistant : avec un faux serveur Claude (ANTHROPIC_BASE_URL=http://127.0.0.1:3199 côté Carnet, E2E_FAKE_AI=1 ici),
// le modèle demande l'outil rechercher_taches puis répond avec un lien. Sans faux serveur, seule la page sans clé est testée.

const EMAIL = process.env.E2E_EMAIL ?? "ippous@gmail.com";
const SECRET = process.env.E2E_SECRET ?? "test-local";
const FAKE_AI = process.env.E2E_FAKE_AI === "1";

async function login(page: Page) {
  const share = process.env.E2E_VERCEL_SHARE;
  if (share) await page.goto(`/?_vercel_share=${encodeURIComponent(share)}`);
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
let marker = "";
test.beforeAll(async () => {
  if (!FAKE_AI) return;
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw) as { messages: { role: string; content: unknown }[] };
      const last = body.messages.at(-1)!;
      res.writeHead(200, { "content-type": "application/json" });
      // 1er appel : demande l'outil ; 2e appel (résultat reçu) : répond avec le lien trouvé
      if (typeof last.content === "string") {
        res.end(
          JSON.stringify({
            stop_reason: "tool_use",
            content: [
              { type: "text", text: "Je cherche." },
              { type: "tool_use", id: "t1", name: "rechercher_taches", input: { recherche: marker } },
            ],
          }),
        );
      } else {
        const result = JSON.stringify(last.content);
        const url = /https?:\/\/[^"\\]+\/taches\/[0-9a-f-]{36}/.exec(result)?.[0] ?? "";
        res.end(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: `Trouvé : [la tâche](${url}).\n- **une seule**` }] }));
      }
    });
  });
  await new Promise<void>((r) => server!.listen(3199, "127.0.0.1", r));
});
test.afterAll(async () => {
  await new Promise((r) => (server ? server.close(r) : r(undefined)));
});

test("assistant : outil de Carnet appelé, réponse avec lien, conversation gardée", async ({ page }, info) => {
  test.skip(!FAKE_AI, "faux serveur IA requis (E2E_FAKE_AI=1)");
  marker = testMarker(info);
  await login(page);
  await page.goto("/utilisateurs/ia");
  const claude = page.getByRole("region", { name: "Claude (Anthropic)" });
  await claude.getByLabel("Clé d'API").fill("sk-ant-test-0123456789abcdefWXYZ");
  await claude.getByRole("button", { name: "Enregistrer" }).click();
  await expect(claude.getByText("Clé enregistrée …WXYZ")).toBeVisible();

  try {
    await page.goto("/objets/nouveau");
    await page.getByLabel("Nom", { exact: true }).fill(`Hangar ${marker}`);
    await page.getByRole("button", { name: /Créer/ }).click();
    await page.getByRole("link", { name: "Ajouter une tâche", exact: true }).first().click();
    await page.getByLabel("Titre", { exact: true }).fill(`Graisser ${marker}`);
    await page.getByRole("button", { name: "Créer la tâche" }).click();

    await page.getByRole("link", { name: "Assistant", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Assistant" })).toBeVisible();
    await page.getByLabel("Message pour l'assistant").fill(`Où en est ${marker} ?`);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("list", { name: "Outils utilisés" })).toContainText("Recherche de tâches · 1 tâche");
    const link = page.getByRole("link", { name: "la tâche" });
    await expect(link).toBeVisible();
    await expect(page.locator("strong", { hasText: "une seule" })).toBeVisible();

    // Conversation gardée au rechargement, puis effacée
    await page.reload();
    await expect(page.getByText(`Où en est ${marker} ?`)).toBeVisible();
    await link.click();
    await expect(page.getByRole("heading", { level: 1, name: `Graisser ${marker}` })).toBeVisible();
    await page.goto("/assistant");
    await page.getByRole("button", { name: "Nouvelle conversation" }).click();
    await expect(page.getByText("Par exemple :")).toBeVisible();
  } finally {
    await page.goto("/utilisateurs/ia");
    await page.getByRole("region", { name: "Claude (Anthropic)" }).getByRole("button", { name: "Retirer la clé" }).click();
  }
});

test("assistant sans clé : invitation à configurer", async ({ page }) => {
  await login(page);
  await page.goto("/assistant");
  await expect(page.getByRole("heading", { level: 1, name: "Assistant" })).toBeVisible();
  const empty = page.getByText("Aucun assistant IA n'est configuré.");
  const panel = page.getByLabel("Message pour l'assistant");
  await expect(empty.or(panel)).toBeVisible();
});
