import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { auditLog, type User } from "@/db/schema";
import { runChat, type ChatEvent } from "@/lib/chat";
import { createTodo, createUser, listObjects, listTodos } from "@/lib/repo";
import { seedInitialTree } from "@/lib/seed";
import { createTestDb } from "./helpers";

let db: Db;
let user: User;
let objectId: string;

beforeEach(async () => {
  db = await createTestDb();
  await seedInitialTree(db);
  user = await createUser(db, { email: "eric@x.fr", name: "Eric", role: "admin" });
  objectId = (await listObjects(db))[0].id;
});

type Call = { url: string; body: Record<string, unknown> };

/** Faux fournisseur : renvoie les réponses prévues, dans l'ordre, et garde les requêtes. */
function fakeFetch(replies: Record<string, unknown>[]) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const r = replies.shift();
    return new Response(JSON.stringify(r ?? { error: { message: "plus de réponse" } }), { status: r ? 200 : 500 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const run = async (provider: "anthropic" | "openai", replies: Record<string, unknown>[], allowDelete = false) => {
  const events: ChatEvent[] = [];
  const f = fakeFetch(replies);
  await runChat(db, {
    user,
    origin: "https://carnet.test",
    target: { provider, model: "m", apiKey: "k" },
    history: [{ role: "user", text: "Quelles tâches parlent de clôture ?" }],
    allowDelete,
    emit: (e) => events.push(e),
    fetchImpl: f.impl,
  });
  return { events, calls: f.calls };
};

describe("chat de Carnet", () => {
  it("Claude : appelle un outil de Carnet puis répond, avec les outils et l'historique", async () => {
    await createTodo(db, { objectId, title: "Réparer la clôture" });
    const { events, calls } = await run("anthropic", [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "rechercher_taches", input: { recherche: "clôture" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Une tâche : Réparer la clôture." }] },
    ]);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    const tools = (calls[0].body.tools as { name: string; input_schema: Record<string, unknown> }[]).map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["rechercher_taches", "creer_tache", "modifier_tache"]));
    expect(tools).not.toContain("supprimer_tache");
    expect((calls[0].body.tools as { input_schema: Record<string, unknown> }[])[0].input_schema.$schema).toBeUndefined();
    expect(String(calls[0].body.system)).toContain("Eric");
    // Le résultat de l'outil est renvoyé au modèle
    const second = calls[1].body.messages as { role: string; content: unknown }[];
    expect(JSON.stringify(second.at(-1))).toContain("Réparer la clôture");
    expect(events.map((e) => e.type)).toEqual(["tool", "tool_result", "text", "done"]);
    expect(events[1]).toMatchObject({ ok: true, summary: "1 tâche" });
  });

  it("ChatGPT : appels de fonctions, écriture avec l'origine MCP · Chat Carnet", async () => {
    const { events, calls } = await run("openai", [
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: "c1", type: "function", function: { name: "creer_tache", arguments: JSON.stringify({ objet_id: objectId, titre: "Vidanger le tracteur" }) } },
              ],
            },
          },
        ],
      },
      { choices: [{ message: { content: "C'est fait." } }] },
    ]);
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect((calls[0].body.messages as { role: string }[])[0].role).toBe("system");
    expect((calls[1].body.messages as { role: string }[]).some((m) => m.role === "tool")).toBe(true);
    expect((await listTodos(db, {})).map((t) => t.title)).toContain("Vidanger le tracteur");
    const log = (await db.select().from(auditLog)).find((l) => l.action === "creation");
    expect([log?.source, log?.client]).toEqual(["mcp", "Chat Carnet"]);
    expect(events.at(-2)).toEqual({ type: "text", text: "C'est fait." });
  });

  it("suppressions seulement si autorisées ; erreur d'outil renvoyée au modèle", async () => {
    const { calls } = await run("anthropic", [{ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }], true);
    expect((calls[0].body.tools as { name: string }[]).map((t) => t.name)).toContain("supprimer_tache");
    const { events } = await run("anthropic", [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "obtenir_tache", input: { id: "00000000-0000-0000-0000-000000000000" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Introuvable." }] },
    ]);
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ ok: false });
  });

  it("clé refusée : message clair", async () => {
    const impl = (async () => new Response(JSON.stringify({ error: { message: "bad" } }), { status: 401 })) as unknown as typeof fetch;
    await expect(
      runChat(db, {
        user,
        origin: "https://carnet.test",
        target: { provider: "anthropic", model: "m", apiKey: "k" },
        history: [{ role: "user", text: "Bonjour" }],
        emit: () => {},
        fetchImpl: impl,
      }),
    ).rejects.toThrow("refuse la clé");
  });
});

describe("contexte de page", () => {
  it("décrit la tâche ou l'objet affiché, ignore une adresse douteuse", async () => {
    const { describePage } = await import("@/lib/chat");
    const id = "3b23c320-47b0-458a-8781-e35132a9c29d";
    expect(describePage(`/taches/${id}`, "https://c.test")).toContain(`tâche ${id}`);
    expect(describePage(`/objets/${id}/modifier`, "https://c.test")).toContain(`objet ${id}`);
    expect(describePage("/taches", "https://c.test")).toContain("liste des tâches");
    expect(describePage("/x<script>", "https://c.test")).toBeNull();
    expect(describePage(null, "https://c.test")).toBeNull();
  });
});
