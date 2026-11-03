import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db";
import {
  aiComplete,
  AiError,
  decryptSecret,
  encryptSecret,
  getAiSettings,
  parseJsonReply,
  resolveProvider,
  saveAiProvider,
  setDefaultAiProvider,
} from "@/lib/ai";
import {
  addSubtask,
  createTodo,
  createType,
  deleteType,
  DomainError,
  findTaskTypeByName,
  listObjects,
  listTodos,
  listTypes,
  setTaskTypeIcon,
} from "@/lib/repo";
import { seedInitialTree } from "@/lib/seed";
import { completeDescription, completeObjectDescription, proposeObjectTasks, proposeSubtasks } from "@/lib/task-assistant";
import { addPhoto, getObject, listPhotos, setObjectDescription } from "@/lib/repo";
import { createTestDb } from "./helpers";

let db: Db;
let objectId: string;

beforeEach(async () => {
  process.env.AUTH_SECRET = "secret-de-test-pour-le-chiffrement-0123456789";
  db = await createTestDb();
  await seedInitialTree(db);
  objectId = (await listObjects(db))[0].id;
});

afterEach(() => vi.unstubAllGlobals());

/** Réponse d'API simulée. */
const reply = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const anthropicText = (text: string) => reply({ content: [{ type: "text", text }] });
const openaiText = (text: string) => reply({ choices: [{ message: { content: text } }] });

describe("types de tâche", () => {
  it("reprennent les anciennes catégories, avec icône, et se gèrent comme les autres types", async () => {
    const types = await listTypes(db, "tache");
    expect(types.map((t) => [t.name, t.icon])).toEqual([
      ["Administratif", "file-text"],
      ["Entretien", "wrench"],
      ["Travaux", "hammer"],
    ]);
    const jardin = await createType(db, "tache", "Jardin", "sprout");
    await setTaskTypeIcon(db, jardin.id, "leaf");
    const t = await createTodo(db, { objectId, title: "Tailler la haie", typeId: jardin.id });
    const [row] = await listTodos(db, { typeId: jardin.id });
    expect(row).toMatchObject({ id: t.id, typeName: "Jardin", typeIcon: "leaf" });
    await expect(deleteType(db, "tache", jardin.id)).rejects.toThrow(/1 tâche l'utilise/);
    await expect(createType(db, "tache", "entretien")).rejects.toBeInstanceOf(DomainError);
    expect((await findTaskTypeByName(db, "TRAVAUX"))?.name).toBe("Travaux");
  });
});

describe("réglages IA", () => {
  it("chiffre les clés et ne les expose jamais", async () => {
    const enc = encryptSecret("sk-ant-0123456789abcdefghij");
    expect(enc).not.toContain("0123456789");
    expect(decryptSecret(enc)).toBe("sk-ant-0123456789abcdefghij");

    expect((await getAiSettings(db)).defaultProvider).toBeNull();
    await expect(resolveProvider(db)).rejects.toBeInstanceOf(AiError);

    await saveAiProvider(db, "openai", { model: "gpt-5.5", apiKey: "sk-proj-abcdefghijklmnopqrstuvwxyz" });
    await saveAiProvider(db, "anthropic", { model: "", apiKey: "sk-ant-abcdefghijklmnopqrstuvwxyz", makeDefault: true });
    const view = await getAiSettings(db);
    expect(view.defaultProvider).toBe("anthropic");
    expect(view.providers.anthropic).toEqual({ model: "claude-sonnet-5-5", configured: true, keyHint: "…wxyz" });
    expect(JSON.stringify(view)).not.toContain("abcdefgh");

    // Champ vide : la clé est gardée ; chaîne vide : elle est retirée
    await saveAiProvider(db, "openai", { model: "gpt-5-mini" });
    expect((await resolveProvider(db, "openai")).apiKey).toBe("sk-proj-abcdefghijklmnopqrstuvwxyz");
    await setDefaultAiProvider(db, "openai");
    expect((await getAiSettings(db)).defaultProvider).toBe("openai");
    await saveAiProvider(db, "openai", { model: "gpt-5-mini", apiKey: "" });
    expect((await getAiSettings(db)).defaultProvider).toBe("anthropic");
    await expect(saveAiProvider(db, "openai", { model: "x y" })).rejects.toBeInstanceOf(AiError);
    await expect(saveAiProvider(db, "openai", { model: "gpt", apiKey: "court" })).rejects.toBeInstanceOf(AiError);
  });

  it("appelle Claude et ChatGPT avec le bon format et traduit les erreurs", async () => {
    const a = anthropicText("Bonjour");
    expect(await aiComplete({ provider: "anthropic", model: "m", apiKey: "k" }, { system: "s", prompt: "p" }, a)).toBe("Bonjour");
    const [url, init] = a.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k");
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "m", system: "s", messages: [{ role: "user", content: "p" }] });

    const o = openaiText("Salut");
    expect(await aiComplete({ provider: "openai", model: "g", apiKey: "k2" }, { system: "s", prompt: "p" }, o)).toBe("Salut");
    const [ourl, oinit] = o.mock.calls[0] as unknown as [string, RequestInit];
    expect(ourl).toBe("https://api.openai.com/v1/chat/completions");
    expect((oinit.headers as Record<string, string>).authorization).toBe("Bearer k2");

    await expect(
      aiComplete({ provider: "openai", model: "g", apiKey: "k" }, { system: "s", prompt: "p" }, reply({ error: { message: "x" } }, 401)),
    ).rejects.toThrow(/refuse la clé/);
    expect(parseJsonReply<{ a: number }>('Voici :\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });
});

describe("aides IA sur une tâche", () => {
  beforeEach(async () => {
    await saveAiProvider(db, "anthropic", { model: "claude-sonnet-5-5", apiKey: "sk-ant-abcdefghijklmnopqrstuvwxyz" });
  });

  it("complète la description en HTML nettoyé, à partir du brouillon et des sous-tâches", async () => {
    const t = await createTodo(db, { objectId, title: "Repeindre le portail" });
    await addSubtask(db, t.id, "Poncer", undefined, { estHours: 2 });
    const fetchMock = anthropicText('```html\n<p>Objectif : <strong>protéger</strong></p><script>alert(1)</script>\n```');
    vi.stubGlobal("fetch", fetchMock);
    const r = await completeDescription(db, t.id, { title: "Repeindre le portail en vert", description: "<p>Rouille</p>" });
    expect(r.html).toBe("<p>Objectif : <strong>protéger</strong></p>");
    const prompt = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).messages[0].content;
    expect(prompt).toContain("Repeindre le portail en vert");
    expect(prompt).toContain("Rouille");
    expect(prompt).toContain("[ ] Poncer (prévu 2 h)");
  });

  it("propose des sous-tâches sans doublon et des tâches voisines", async () => {
    const t = await createTodo(db, { objectId, title: "Repeindre le portail" });
    await addSubtask(db, t.id, "Poncer");
    vi.stubGlobal(
      "fetch",
      anthropicText(
        JSON.stringify({
          sous_taches: [{ titre: "poncer" }, { titre: "Appliquer l'antirouille", heures: "1,5" }, { titre: "Peindre", heures: -3 }, "Nettoyer"],
          taches_similaires: [{ titre: "Repeindre le portail" }, { titre: "Huiler les gonds", description: "Avant l'hiver", heures: 0.5 }],
        }),
      ),
    );
    const r = await proposeSubtasks(db, t.id, { title: "", description: null });
    expect(r.subtasks).toEqual([
      { title: "Appliquer l'antirouille", estHours: 1.5 },
      { title: "Peindre", estHours: null },
      { title: "Nettoyer", estHours: null },
    ]);
    expect(r.tasks).toEqual([{ title: "Huiler les gonds", description: "Avant l'hiver", estHours: 0.5 }]);
  });
});

describe("description d'objet", () => {
  beforeEach(async () => {
    await saveAiProvider(db, "anthropic", { model: "claude-sonnet-5-5", apiKey: "sk-ant-abcdefghijklmnopqrstuvwxyz" });
  });

  it("garde les images du texte hors galerie et jamais en vignette", async () => {
    const owner = { objectId };
    const inline = await addPhoto(db, owner, { pathname: "local/objets/x/a.jpg", thumbPathname: "local/objets/x/a-v.jpg", inline: true });
    expect(inline.isCover).toBe(false);
    const gallery = await addPhoto(db, owner, { pathname: "local/objets/x/b.jpg", thumbPathname: "local/objets/x/b-v.jpg" });
    expect(gallery.isCover).toBe(true);
    expect((await listPhotos(db, owner)).map((p) => p.id)).toEqual([gallery.id]);
    await setObjectDescription(db, objectId, "<p>Neuf</p>");
    expect((await getObject(db, objectId))?.description).toBe("<p>Neuf</p>");
  });

  it("met à niveau le texte en conservant images et @@, et propose des tâches nouvelles", async () => {
    const img = '<img src="/api/photos/0e3b9a3c-1111-4222-8333-944455556666" data-photo="0e3b9a3c-1111-4222-8333-944455556666" alt="" />';
    vi.stubGlobal("fetch", anthropicText('<h3>État</h3><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Pneus</p></li></ul>'));
    const r = await completeObjectDescription(db, objectId, {
      title: "",
      description: `<p>Vieux ${img} <span data-commande="date">@@date</span></p>`,
    });
    expect(r.html).toContain('data-type="taskItem"');
    expect(r.html).toContain('data-photo="0e3b9a3c-1111-4222-8333-944455556666"');
    expect(r.html).toContain('<span data-commande="date">@@date</span>');

    await createTodo(db, { objectId, title: "Vidanger le moteur" });
    vi.stubGlobal(
      "fetch",
      anthropicText(JSON.stringify({ taches: [{ titre: "vidanger le moteur" }, { titre: "Graisser", description: "Rotules", heures: 0.5 }] })),
    );
    const p = await proposeObjectTasks(db, objectId, { title: "", description: null });
    expect(p.tasks).toEqual([{ title: "Graisser", description: "Rotules", estHours: 0.5 }]);
  });
});
