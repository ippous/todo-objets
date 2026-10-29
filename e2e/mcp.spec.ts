import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { purge, testMarker } from "./helpers";

const EMAIL = process.env.E2E_EMAIL ?? "ippous@gmail.com";
const SECRET = process.env.E2E_SECRET ?? "test-local";

// Le serveur MCP est le même pour les deux profils : on ne le teste qu'en « desktop »
test.skip(({ isMobile }) => isMobile, "Serveur MCP testé une seule fois");

async function login(page: Page, stay = false) {
  if (!stay) await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail autorisée").fill(EMAIL);
  await page.getByLabel("Code de test").fill(SECRET);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
}

test.beforeEach(async ({ page }, info) => {
  const share = process.env.E2E_VERCEL_SHARE;
  if (share) await page.goto(`/?_vercel_share=${encodeURIComponent(share)}`);
  await login(page);
  await expect(page.getByRole("heading", { name: "Arbre des objets" })).toBeVisible();
  await purge(page, testMarker(info));
});

test.afterEach(async ({ page }, info) => {
  await purge(page, testMarker(info));
});

/** Client MCP officiel, avec en-têtes (jeton, et cookie de partage Vercel en dev protégé). */
async function mcpClient(baseURL: string, token: string, cookie?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (cookie) headers.Cookie = cookie;
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", baseURL), { requestInit: { headers } }));
  return client;
}

async function vercelCookie(page: Page) {
  const cookies = await page.context().cookies();
  const c = cookies.filter((k) => k.name.startsWith("_vercel"));
  return c.length ? c.map((k) => `${k.name}=${k.value}`).join("; ") : undefined;
}

const parse = (r: Awaited<ReturnType<Client["callTool"]>>) =>
  JSON.parse((r.content as { type: string; text: string }[])[0].text) as Record<string, unknown>;

async function seed(page: Page, m: string) {
  await page.goto("/objets/nouveau");
  await page.getByLabel("Nom").fill(`Pompe ${m}`);
  const ed = page.getByRole("textbox", { name: "Description" });
  await ed.click();
  await page.getByRole("button", { name: "Gras (Ctrl+B)" }).click();
  await page.keyboard.type("Débit 6 m3/h");
  await page.getByRole("button", { name: "Créer l'objet" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Pompe ${m}` })).toBeVisible();
  const objectId = page.url().split("/objets/")[1];
  await page.getByRole("link", { name: "Ajouter une tâche", exact: true }).click();
  await page.getByLabel("Titre", { exact: true }).fill(`Graisser ${m}`);
  await page.getByLabel("Durée (heures)").first().fill("2");
  await page.getByLabel("Valeur (€)").first().fill("80");
  await page.getByRole("button", { name: "Créer la tâche" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Pompe ${m}` })).toBeVisible();
  return objectId;
}

test("sans jeton : 401 et métadonnées OAuth publiées", async ({ page }) => {
  const request = page.request; // garde le cookie de partage Vercel (dev protégé)
  const res = await request.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect(res.status()).toBe(401);
  const www = res.headers()["www-authenticate"];
  expect(www).toContain("resource_metadata=");
  const prm = await (await request.get("/.well-known/oauth-protected-resource/api/mcp")).json();
  expect(prm.resource).toMatch(/\/api\/mcp$/);
  const as = await (await request.get(`/.well-known/oauth-authorization-server`)).json();
  expect(as.code_challenge_methods_supported).toEqual(["S256"]);
  expect(as.authorization_endpoint).toMatch(/\/oauth\/autoriser$/);
  expect((await request.post("/api/mcp", { headers: { Authorization: "Bearer carnet_pat_faux_jeton_12345678901234567890" }, data: {} })).status()).toBe(401);
});

test("jeton personnel : outils en lecture, puis révocation", async ({ page, baseURL }, info) => {
  const m = testMarker(info);
  const objectId = await seed(page, m);

  await page.goto("/connexion-ia");
  await expect(page.getByTestId("mcp-url")).toHaveText(/\/api\/mcp$/);
  await page.getByLabel("Nom du jeton").fill(`Jeton ${m}`);
  await page.getByRole("button", { name: "Créer un jeton" }).click();
  const token = (await page.getByTestId("nouveau-jeton").textContent())!.trim();
  expect(token).toMatch(/^carnet_pat_/);

  const client = await mcpClient(baseURL!, token, await vercelCookie(page));
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual(["consulter_historique", "lister_objets", "obtenir_objet", "obtenir_tache", "rechercher_taches", "vue_ensemble"]);
  expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);

  const vue = parse(await client.callTool({ name: "vue_ensemble", arguments: {} }));
  expect(vue.utilisateur_connecte).toBeTruthy();

  const objets = parse(await client.callTool({ name: "lister_objets", arguments: { recherche: m } }));
  expect((objets.objets as { id: string }[]).map((o) => o.id)).toContain(objectId);

  const obj = parse(await client.callTool({ name: "obtenir_objet", arguments: { id: objectId } }));
  expect(obj.description).toBe("**Débit 6 m3/h**");
  const taches = obj.taches as { id: string; titre: string; euros_par_heure: number }[];
  expect(taches.map((t) => t.titre)).toEqual([`Graisser ${m}`]);
  expect(taches[0].euros_par_heure).toBe(40);

  const found = parse(await client.callTool({ name: "rechercher_taches", arguments: { recherche: m } }));
  expect(found.total).toBe(1);
  const tache = parse(await client.callTool({ name: "obtenir_tache", arguments: { id: taches[0].id } }));
  expect(tache.titre).toBe(`Graisser ${m}`);
  expect((tache.objet as { chemin: string }).chemin).toContain(`Pompe ${m}`);

  const missing = await client.callTool({ name: "obtenir_objet", arguments: { id: "00000000-0000-4000-8000-000000000000" } });
  expect(missing.isError).toBe(true);
  await client.close();

  // Révocation depuis la page : le jeton ne marche plus
  await page.reload();
  await page.getByRole("button", { name: `Retirer l'accès Jeton ${m}` }).click();
  await page.getByRole("button", { name: "Oui, retirer" }).click();
  await expect(page.getByRole("button", { name: `Retirer l'accès Jeton ${m}` })).toHaveCount(0);
  await expect(mcpClient(baseURL!, token, await vercelCookie(page))).rejects.toThrow();
});

async function tokenRequest(request: APIRequestContext, form: Record<string, string>) {
  const res = await request.post("/api/oauth/token", { form });
  return { status: res.status(), body: await res.json() };
}

test("OAuth : enregistrement, connexion, consentement, jetons, rafraîchissement, révocation", async ({ page, browser, baseURL }, info) => {
  const m = testMarker(info);
  await seed(page, m);
  const redirect = "http://127.0.0.1:8765/callback";

  // 1. Enregistrement dynamique
  const reg = await page.request.post("/api/oauth/register", { data: { client_name: `Test MCP ${m}`, redirect_uris: [redirect] } });
  expect(reg.status()).toBe(201);
  const { client_id } = await reg.json();

  // 2. Autorisation (PKCE) depuis un navigateur NON connecté : passage par la connexion puis retour
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const qs = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "lecture",
    state: "etat-123",
  });
  const ctx = await browser.newContext({ baseURL });
  const p2 = await ctx.newPage();
  const share = process.env.E2E_VERCEL_SHARE;
  if (share) await p2.goto(`/?_vercel_share=${encodeURIComponent(share)}`);
  await p2.goto(`/oauth/autoriser?${qs}`);
  await expect(p2).toHaveURL(/\/connexion\?retour=/);
  await login(p2, true);
  await expect(p2.getByRole("heading", { name: `Autoriser « Test MCP ${m} » ?` })).toBeVisible();
  const writeBox = p2.getByRole("checkbox", { name: /Autoriser aussi les modifications/ });
  await expect(writeBox).not.toBeChecked(); // portée « lecture » demandée : décochée par défaut

  let callback = "";
  await p2.route("http://127.0.0.1:8765/**", async (route) => {
    callback = route.request().url();
    await route.fulfill({ status: 200, body: "ok" });
  });
  await p2.getByRole("button", { name: "Autoriser" }).click();
  await expect.poll(() => callback).toContain("code=");
  const cb = new URL(callback);
  expect(cb.searchParams.get("state")).toBe("etat-123");
  const code = cb.searchParams.get("code")!;

  // 3. Échange du code (un mauvais verifier est refusé)
  const bad = await tokenRequest(page.request, { grant_type: "authorization_code", code, client_id, redirect_uri: redirect, code_verifier: "x".repeat(43) });
  expect(bad.status).toBe(400);
  // Le code a été consommé par la tentative ratée : on recommence l'autorisation, cette fois avec écriture
  callback = "";
  await p2.goto(`/oauth/autoriser?${qs}`);
  await p2.getByRole("checkbox", { name: /Autoriser aussi les modifications/ }).check();
  await p2.getByRole("button", { name: "Autoriser" }).click();
  await expect.poll(() => callback).toContain("code=");
  const code2 = new URL(callback).searchParams.get("code")!;
  const ok = await tokenRequest(page.request, { grant_type: "authorization_code", code: code2, client_id, redirect_uri: redirect, code_verifier: verifier });
  expect(ok.status).toBe(200);
  expect(ok.body.token_type).toBe("Bearer");
  expect(ok.body.scope).toBe("lecture ecriture");

  // 4. Le jeton d'accès ouvre le MCP, avec les outils d'écriture
  const client = await mcpClient(baseURL!, ok.body.access_token, await vercelCookie(page));
  const found = parse(await client.callTool({ name: "rechercher_taches", arguments: { recherche: m } }));
  expect(found.total).toBe(1);
  expect((await client.listTools()).tools.map((t) => t.name)).toContain("creer_tache");
  await client.close();

  // 5. Rafraîchissement avec rotation
  const ref = await tokenRequest(page.request, { grant_type: "refresh_token", refresh_token: ok.body.refresh_token, client_id });
  expect(ref.status).toBe(200);
  expect(ref.body.access_token).not.toBe(ok.body.access_token);
  expect(ref.body.scope).toBe("lecture ecriture");

  // 6. L'application apparaît dans « Connexion IA » et peut être révoquée
  await page.goto("/connexion-ia");
  await page.getByRole("button", { name: `Retirer l'accès Test MCP ${m}` }).click();
  await page.getByRole("button", { name: "Oui, retirer" }).click();
  await expect(page.getByRole("button", { name: `Retirer l'accès Test MCP ${m}` })).toHaveCount(0);
  await expect(mcpClient(baseURL!, ref.body.access_token, await vercelCookie(page))).rejects.toThrow();

  // 7. Refus : retour à l'application avec access_denied
  callback = "";
  await p2.goto(`/oauth/autoriser?${qs}`);
  await p2.getByRole("button", { name: "Refuser" }).click();
  await expect.poll(() => callback).toContain("error=access_denied");
  await ctx.close();
});

test("jeton en écriture : créer, modifier, terminer, déplacer, lier, photo — visible dans l'appli", async ({ page, baseURL }, info) => {
  const m = testMarker(info);
  const pumpId = await seed(page, m);

  await page.goto("/connexion-ia");
  await page.getByLabel("Nom du jeton").fill(`Jeton ${m}`);
  await page.getByLabel("Lecture et écriture").check();
  await page.getByRole("button", { name: "Créer un jeton" }).click();
  const token = (await page.getByTestId("nouveau-jeton").textContent())!.trim();
  await page.reload();
  await expect(page.getByText(`Jeton ${m}`).locator("..")).toContainText("lecture et écriture");

  const client = await mcpClient(baseURL!, token, await vercelCookie(page));
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    return parse(r);
  };

  // Objets : une racine de test, un enfant, puis déplacement de la pompe dessous
  const atelier = await call("creer_objet", { nom: `Atelier ${m}`, description: "## Outillage\n- **perceuse**" });
  const etabli = await call("creer_objet", { nom: `Établi ${m}`, parent_id: atelier.id, emplacement: "Mur est" });
  await call("modifier_objet", { id: etabli.id, nom: `Grand établi ${m}` });
  await call("deplacer_objet", { id: pumpId, nouveau_parent_id: atelier.id });
  const loop = await client.callTool({ name: "deplacer_objet", arguments: { id: atelier.id, nouveau_parent_id: etabli.id } });
  expect(loop.isError).toBe(true);

  // Tâche : création, modification, fin avec récurrence, lien
  const t = await call("creer_tache", {
    objet_id: etabli.id,
    titre: `Huiler ${m}`,
    description: "Huile de lin, **2 couches**",
    echeance: "2030-01-15",
    recurrence: "annuelle",
    responsable: "moi",
    heures_estimees: 1.5,
  });
  await call("modifier_tache", { id: t.id, priorite: "haute", valeur_estimee_eur: 30 });
  await call("ajouter_lien", { tache_id: t.id, url: "https://exemple.fr/huile", titre: `Fiche ${m}` });
  // Photo (PNG 1×1 rouge) ajoutée à la tâche et à l'atelier en un appel
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
  const ph = await call("ajouter_photo", { image_base64: PNG, tache_ids: [t.id], objet_ids: [atelier.id] });
  expect(ph.ajoutees).toBe(2);
  const done = await call("modifier_tache", { id: t.id, statut: "fait", heures_realisees: 2 });
  expect((done.occurrence_suivante as { id: string } | null)?.id).toBeTruthy();
  await client.close();

  // Vérification dans l'appli
  await page.goto(`/objets/${atelier.id}`);
  await expect(page.getByRole("heading", { level: 1, name: `Atelier ${m}` })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Outillage" })).toBeVisible();
  await expect(page.locator("strong", { hasText: "perceuse" })).toBeVisible();
  await expect(page.getByRole("link", { name: `Grand établi ${m}` }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: `Pompe ${m}` }).first()).toBeVisible();

  await page.goto(`/taches/${t.id}`);
  await expect(page.getByRole("heading", { level: 1, name: `Huiler ${m}` })).toBeVisible();
  await expect(page.locator("strong", { hasText: "2 couches" })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`Fiche ${m}`) })).toBeVisible();
  const img = page.locator('img[src^="/api/photos/"]').first();
  await expect(img).toBeVisible();
  expect((await page.request.get((await img.getAttribute("src"))!)).headers()["content-type"]).toContain("image/jpeg");
  // Occurrence suivante créée par la récurrence
  await page.goto(`/taches/${(done.occurrence_suivante as { id: string }).id}`);
  await expect(page.getByRole("heading", { level: 1, name: `Huiler ${m}` })).toBeVisible();
  await expect(page.getByLabel("Échéance")).toHaveValue("2031-01-15");
});
