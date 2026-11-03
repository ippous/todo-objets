import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db";
import { saveAiProvider } from "@/lib/ai";
import { aiWriteCommand, createCommand, deleteCommand, listCommands, updateCommand } from "@/lib/commands";
import { DomainError } from "@/lib/repo";
import { richTextToPlain, sanitizeRichText } from "@/lib/rich-text";
import { createTestDb } from "./helpers";

let db: Db;

beforeEach(async () => {
  process.env.AUTH_SECRET = "secret-de-test-pour-le-chiffrement-0123456789";
  db = await createTestDb();
});
afterEach(() => vi.unstubAllGlobals());

describe("commandes de saisie", () => {
  it("fournit date et heure, se créent, se modifient et se suppriment", async () => {
    expect((await listCommands(db)).map((c) => c.name)).toEqual(["date", "heure"]);
    const c = await createCommand(db, { name: "  Semaine ", description: " N° de semaine ", code: "return 45;" });
    expect(c).toMatchObject({ name: "semaine", description: "N° de semaine" });
    await expect(createCommand(db, { name: "SEMAINE", description: null, code: "return 1" })).rejects.toThrow(/existe déjà/);
    await expect(createCommand(db, { name: "été", description: null, code: "return 1" })).rejects.toBeInstanceOf(DomainError);
    await expect(createCommand(db, { name: "vide", description: null, code: "  " })).rejects.toBeInstanceOf(DomainError);
    await updateCommand(db, c.id, { name: "sem", description: null, code: "return 46;" });
    expect((await listCommands(db)).find((x) => x.id === c.id)).toMatchObject({ name: "sem", code: "return 46;" });
    await deleteCommand(db, c.id);
    expect(await listCommands(db)).toHaveLength(2);
  });

  it("gardent les @@ dans les descriptions, sans attribut indésirable", () => {
    const html = sanitizeRichText('<p>Le <span data-commande="Date" onclick="x()">@@date</span> <span data-commande="a b">x</span></p>');
    expect(html).toBe('<p>Le <span data-commande="date">@@date</span> <span>x</span></p>');
    expect(richTextToPlain(html)).toContain("@@date");
  });

  it("demandent le code à l'IA, sans bloc de code autour", async () => {
    await saveAiProvider(db, "openai", { model: "gpt-5.5", apiKey: "sk-proj-abcdefghijklmnopqrstuvwxyz" });
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: "```js\nreturn 'semaine ' + 45;\n```" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const code = await aiWriteCommand(db, { name: "semaine", request: "", code: "return x", error: "Erreur : ReferenceError : x is not defined" });
    expect(code).toBe("return 'semaine ' + 45;");
    const prompt = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).messages[1].content;
    expect(prompt).toContain("x is not defined");
    expect(prompt).toContain("ctx");
    await expect(aiWriteCommand(db, { name: "x", request: " " })).rejects.toBeInstanceOf(DomainError);
  });
});
