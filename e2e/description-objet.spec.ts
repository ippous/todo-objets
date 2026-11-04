import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import { purge, testMarker } from "./helpers";

// Description d'objet modifiée sur sa fiche : cases à cocher, image dans le texte,
// aide IA pour rédiger la description et créer des tâches.
// L'IA passe par un faux serveur (ANTHROPIC_BASE_URL=http://127.0.0.1:3199 côté Carnet, E2E_FAKE_AI=1 ici).

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
      const text = prompt.includes("Propose 3 à 8 tâches")
        ? JSON.stringify({
            taches: [
              { titre: "Vidanger le moteur", description: "Huile 10W40", heures: 1 },
              { titre: "Graisser les rotules", heures: 0.5 },
            ],
          })
        : '<h3>Entretien</h3><p>Tracteur de la ferme.</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Contrôler les pneus</p></li></ul>';
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ content: [{ type: "text", text }] }));
    });
  });
  await new Promise<void>((r) => server!.listen(3199, "127.0.0.1", r));
});
test.afterAll(async () => {
  await new Promise((r) => (server ? server.close(r) : r(undefined)));
});

async function jpeg(page: Page, color: string): Promise<Buffer> {
  const b64 = await page.evaluate((c) => {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 400;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 600, 400);
    return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
  }, color);
  return Buffer.from(b64, "base64");
}

test("description d'objet : sur la fiche, cases à cocher, image, IA", async ({ page }, info) => {
  const m = testMarker(info);
  const objet = `Tracteur ${m}`;
  await login(page);

  if (FAKE_AI) {
    await page.goto("/utilisateurs/ia");
    const claude = page.getByRole("region", { name: "Claude (Anthropic)" });
    await claude.getByLabel("Clé d'API").fill("sk-ant-test-0123456789abcdefWXYZ");
    await claude.getByRole("button", { name: "Enregistrer" }).click();
    await expect(claude.getByText("Clé enregistrée …WXYZ")).toBeVisible();
  }

  await page.goto("/objets/nouveau");
  await page.getByLabel("Nom").fill(objet);
  await page.getByRole("button", { name: "Créer l'objet" }).click();
  await expect(page.getByRole("heading", { level: 1, name: objet })).toBeVisible();

  // Saisie sur la fiche : texte et cases à cocher
  const editor = page.getByRole("textbox", { name: "Description", exact: true });
  await editor.click();
  await page.keyboard.type("Révision annuelle");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Cases à cocher" }).click();
  await page.keyboard.type("Filtre à air");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Courroie");
  await expect(page.getByText("Modifications non enregistrées")).toBeVisible();
  await editor.getByRole("checkbox").first().check();

  // Image insérée dans le texte (hors galerie)
  await page.getByLabel("Images à insérer").setInputFiles({ name: "moteur.jpg", mimeType: "image/jpeg", buffer: await jpeg(page, "#2a6") });
  await expect(editor.locator("img")).toHaveCount(1);
  await expect(editor.locator("img")).toHaveAttribute("src", /^\/api\/photos\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Enregistrer la description" }).click();
  await expect(page.getByText("Description enregistrée.")).toBeVisible();

  await page.reload();
  await expect(editor).toContainText("Révision annuelle");
  await expect(editor.getByRole("checkbox")).toHaveCount(2);
  await expect(editor.getByRole("checkbox").first()).toBeChecked();
  await expect(editor.getByRole("checkbox").last()).not.toBeChecked();
  const img = editor.locator("img");
  await expect(img).toHaveCount(1);
  expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  // L'image du texte n'apparaît pas dans la galerie
  await expect(page.getByRole("heading", { name: /^Photos/ })).toHaveText("Photos");

  if (!FAKE_AI) return;

  // IA : mise à niveau du texte (l'image d'origine est conservée)
  await page.getByRole("button", { name: "Rédiger ou mettre à niveau la description" }).click();
  const prop = page.getByTestId("proposition-description");
  await expect(prop).toContainText("Tracteur de la ferme.");
  await prop.getByRole("button", { name: "Remplacer la description" }).click();
  await expect(editor).toContainText("Contrôler les pneus");
  await expect(editor.locator("img")).toHaveCount(1);
  await page.getByRole("button", { name: "Enregistrer la description" }).click();
  await expect(page.getByText("Description enregistrée.")).toBeVisible();

  // IA : tâches proposées, créées sur l'objet
  await page.getByRole("button", { name: "Proposer des tâches" }).click();
  const props = page.getByTestId("propositions-taches");
  await expect(props.getByRole("checkbox", { name: /Vidanger le moteur/ })).toBeChecked();
  await props.getByRole("checkbox", { name: /Graisser les rotules/ }).uncheck();
  await props.getByRole("button", { name: "Créer les tâches cochées (1)" }).click();
  await expect(page.getByText("1 tâche créée.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Vidanger le moteur" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Graisser les rotules" })).toHaveCount(0);

  await page.goto("/utilisateurs/ia");
  await page.getByRole("region", { name: "Claude (Anthropic)" }).getByRole("button", { name: "Retirer la clé" }).click();
  await expect(page.getByRole("region", { name: "Claude (Anthropic)" }).getByText("Pas de clé")).toBeVisible();
});

test("même zone de description à la création : image et IA avant d'enregistrer", async ({ page }, info) => {
  const m = testMarker(info);
  const objet = `Serre ${m}`;
  const tache = `Arroser ${m}`;
  await login(page);

  if (FAKE_AI) {
    await page.goto("/utilisateurs/ia");
    const claude = page.getByRole("region", { name: "Claude (Anthropic)" });
    await claude.getByLabel("Clé d'API").fill("sk-ant-test-0123456789abcdefWXYZ");
    await claude.getByRole("button", { name: "Enregistrer" }).click();
    await expect(claude.getByText("Clé enregistrée …WXYZ")).toBeVisible();
  }

  // Nouvel objet : image et texte de l'IA avant création
  await page.goto("/objets/nouveau");
  await page.getByLabel("Nom").fill(objet);
  const editor = page.getByRole("textbox", { name: "Description", exact: true });
  await editor.click();
  await page.keyboard.type("Serre tunnel");
  await page.getByLabel("Images à insérer").setInputFiles({ name: "serre.jpg", mimeType: "image/jpeg", buffer: await jpeg(page, "#369") });
  await expect(editor.locator("img")).toHaveCount(1);
  if (FAKE_AI) {
    await page.getByRole("button", { name: "Rédiger ou mettre à niveau la description" }).click();
    await page.getByTestId("proposition-description").getByRole("button", { name: "Remplacer la description" }).click();
    await expect(editor).toContainText("Tracteur de la ferme.");
    await expect(editor.locator("img")).toHaveCount(1);
  }
  await page.getByRole("button", { name: "Créer l'objet" }).click();
  await expect(page.getByRole("heading", { level: 1, name: objet })).toBeVisible();
  const img = page.getByRole("textbox", { name: "Description", exact: true }).locator("img");
  await expect(img).toHaveCount(1);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  await expect(page.getByRole("heading", { name: /^Photos/ })).toHaveText("Photos");

  // Nouvelle tâche : image avant création
  await page.getByRole("link", { name: "Ajouter une tâche", exact: true }).click();
  await page.getByLabel("Titre", { exact: true }).fill(tache);
  await page.getByRole("textbox", { name: "Description", exact: true }).click();
  await page.getByLabel("Images à insérer").setInputFiles({ name: "tuyau.jpg", mimeType: "image/jpeg", buffer: await jpeg(page, "#963") });
  await expect(page.getByRole("textbox", { name: "Description", exact: true }).locator("img")).toHaveCount(1);
  await page.getByRole("button", { name: "Créer la tâche" }).click();
  await page.getByRole("link", { name: tache }).click();
  await expect(page.getByRole("heading", { level: 1, name: tache })).toBeVisible();
  const timg = page.getByRole("textbox", { name: "Description", exact: true }).locator("img");
  await expect(timg).toHaveCount(1);
  await expect.poll(() => timg.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);

  if (FAKE_AI) {
    await page.goto("/utilisateurs/ia");
    await page.getByRole("region", { name: "Claude (Anthropic)" }).getByRole("button", { name: "Retirer la clé" }).click();
    await expect(page.getByRole("region", { name: "Claude (Anthropic)" }).getByText("Pas de clé")).toBeVisible();
  }
});

test("boutons en icônes sur mobile, avec info-bulle à l'appui long", async ({ page }, info) => {
  const m = testMarker(info);
  const objet = `Abri ${m}`;
  await login(page);
  await page.goto("/objets/nouveau");
  await page.getByLabel("Nom").fill(objet);
  await page.getByRole("button", { name: "Créer l'objet" }).click();
  await expect(page.getByRole("heading", { level: 1, name: objet })).toBeVisible();

  const add = page.getByRole("link", { name: "Ajouter une tâche", exact: true });
  const actions = [add, page.getByRole("link", { name: "Modifier ou déplacer" }), page.getByRole("button", { name: "Plusieurs sous-objets" })];
  if (info.project.name !== "mobile") {
    // Sur PC le texte est visible, pas besoin d'info-bulle
    expect(await add.evaluate((el) => (el as HTMLElement).innerText.trim())).toBe("Ajouter une tâche");
    return;
  }
  // Une seule ligne de boutons sur mobile
  const tops = await Promise.all(actions.map((a) => a.evaluate((el) => Math.round(el.getBoundingClientRect().top))));
  expect(new Set(tops).size).toBe(1);
  // Texte masqué : seule l'icône est visible
  expect(await add.evaluate((el) => (el as HTMLElement).innerText.trim())).toBe("");

  // Appui long : la bulle s'affiche et le lien n'est pas suivi
  const box = (await add.boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await add.dispatchEvent("pointerdown", { pointerType: "touch", clientX: at.x, clientY: at.y, bubbles: true });
  await page.waitForTimeout(600);
  await expect(page.locator("span[aria-hidden].fixed", { hasText: "Ajouter une tâche" })).toBeVisible();
  await add.dispatchEvent("pointerup", { pointerType: "touch", bubbles: true });
  await add.dispatchEvent("click", { bubbles: true });
  await expect(page.getByRole("heading", { level: 1, name: objet })).toBeVisible();
  await expect(page.locator("span[aria-hidden].fixed", { hasText: "Ajouter une tâche" })).toBeHidden({ timeout: 3000 });

  // Appui bref : action normale
  await add.click();
  await expect(page.getByRole("heading", { name: "Nouvelle tâche" })).toBeVisible();
});
