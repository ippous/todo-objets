import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { reminderDeliveries, todos, type PushSubscriptionRow } from "@/db/schema";
import {
  createReminderScheme,
  deleteReminderScheme,
  getDefaultSchemeId,
  listPushSubscriptions,
  listReminderSchemes,
  runReminders,
  savePushSubscription,
  setDefaultScheme,
  setNotifyPrefs,
  updateReminderScheme,
  type ReminderMessage,
  type Senders,
} from "@/lib/reminder-repo";
import { dueReminders, fireTimes, formatOffsets, parisToUtc, parseOffsets } from "@/lib/reminders";
import { createTodo, createUser, DomainError, getTodo, listObjects, setTodoStatus } from "@/lib/repo";
import { describeDetails, listAudit } from "@/lib/audit";
import { seedInitialTree } from "@/lib/seed";
import { createTestDb } from "./helpers";

const iso = (d: Date) => d.toISOString();

describe("décalages", () => {
  it("lit J / H / M, trie du plus éloigné au plus proche et refuse l'incompris", () => {
    const r = parseOffsets("M-10 / j-1, H3 ; J-10");
    expect("offsets" in r && formatOffsets(r.offsets)).toBe("J-10 / J-1 / H-3 / M-10");
    expect(parseOffsets("J-10 / J-10 / J-1")).toEqual({ offsets: [{ n: 10, unit: "j" }, { n: 1, unit: "j" }] });
    expect("error" in parseOffsets("")).toBe(true);
    expect("error" in parseOffsets("S-2")).toBe(true);
    expect("error" in parseOffsets("H-0")).toBe(true);
    expect(parseOffsets("J-0")).toEqual({ offsets: [{ n: 0, unit: "j" }] });
  });
});

describe("instants des rappels", () => {
  it("convertit l'heure de Paris, en hiver comme en été", () => {
    expect(iso(parisToUtc("2026-01-15", "14:30"))).toBe("2026-01-15T13:30:00.000Z");
    expect(iso(parisToUtc("2026-07-15", "14:30"))).toBe("2026-07-15T12:30:00.000Z");
    // Lendemain du passage à l'heure d'été (29 mars 2026)
    expect(iso(parisToUtc("2026-03-29", "09:00"))).toBe("2026-03-29T07:00:00.000Z");
    expect(iso(parisToUtc("2026-03-28", "09:00"))).toBe("2026-03-28T08:00:00.000Z");
  });

  it("avec une heure : échéance moins le décalage, à la même heure pour J", () => {
    const f = fireTimes("2026-11-20", "14:30:00", [
      { n: 10, unit: "j" },
      { n: 1, unit: "j" },
      { n: 3, unit: "h" },
      { n: 10, unit: "m" },
    ]);
    expect(f.map((x) => [x.label, iso(x.at)])).toEqual([
      ["J-10", "2026-11-10T13:30:00.000Z"],
      ["J-1", "2026-11-19T13:30:00.000Z"],
      ["H-3", "2026-11-20T10:30:00.000Z"],
      ["M-10", "2026-11-20T13:20:00.000Z"],
    ]);
  });

  it("sans heure : J à 8 h, H et M ignorés", () => {
    const f = fireTimes("2026-11-20", null, [
      { n: 2, unit: "j" },
      { n: 0, unit: "j" },
      { n: 3, unit: "h" },
    ]);
    expect(f.map((x) => [x.label, iso(x.at)])).toEqual([
      ["J-2", "2026-11-18T07:00:00.000Z"],
      ["J-0", "2026-11-20T07:00:00.000Z"],
    ]);
  });

  it("n'envoie que le plus récent des rappels en attente, et rien après l'échéance", () => {
    const fires = fireTimes("2026-11-20", "14:30", [
      { n: 10, unit: "j" },
      { n: 5, unit: "j" },
      { n: 1, unit: "j" },
    ]);
    const deadline = parisToUtc("2026-11-20", "14:30");
    const r = dueReminders(fires, deadline, new Date("2026-11-16T00:00:00Z"), new Set());
    expect(r.send?.label).toBe("J-5");
    expect(r.skip.map((x) => x.label)).toEqual(["J-10"]);
    expect(dueReminders(fires, deadline, new Date("2026-11-16T00:00:00Z"), new Set(["j10", "j5"])).send).toBeNull();
    expect(dueReminders(fires, deadline, new Date("2026-11-21T00:00:00Z"), new Set()).send).toBeNull();
    // Tâche modifiée après l'instant du dernier rappel en attente : tout est sauté
    const late = dueReminders(fires, deadline, new Date("2026-11-16T00:00:00Z"), new Set(), new Date("2026-11-15T20:00:00Z"));
    expect(late.send).toBeNull();
    expect(late.skip.map((x) => x.label)).toEqual(["J-10", "J-5"]);
  });
});

describe("schémas et envois", () => {
  let db: Db;
  let objectId: string;
  let userId: string;
  let schemeId: string;
  let sent: { channel: string; to: string; msg: ReminderMessage }[];
  let senders: Senders;

  beforeEach(async () => {
    db = await createTestDb();
    await seedInitialTree(db);
    objectId = (await listObjects(db))[0].id;
    userId = (await createUser(db, { email: "marie@example.com", name: "Marie", role: "membre", weeklyHoursAvailable: null, skills: null })).id;
    schemeId = (await createReminderScheme(db, { name: "Test", offsets: [{ n: 2, unit: "j" }, { n: 1, unit: "j" }, { n: 3, unit: "h" }] })).id;
    sent = [];
    senders = {
      email: async (to, msg) => void sent.push({ channel: "email", to: to.email, msg }),
      push: async (sub: PushSubscriptionRow, msg) => {
        if (sub.endpoint.includes("expire")) return "gone";
        sent.push({ channel: "push", to: sub.label, msg });
        return "ok";
      },
    };
  });

  const task = async (dueDate: string, dueTime: string | null, extra: Record<string, unknown> = {}) => {
    const t = await createTodo(db, { objectId, title: "Contrôle technique", dueDate, dueTime, reminderSchemeId: schemeId, assigneeId: userId, ...extra });
    await db.update(todos).set({ updatedAt: new Date("2026-11-01T00:00:00Z") }).where(eq(todos.id, t.id));
    return t;
  };
  const run = (now: string) => runReminders(db, { now: new Date(now), senders, origin: "https://carnet.test" });

  it("les deux schémas de départ existent, « Standard » par défaut", async () => {
    const fresh = await createTestDb();
    const list = await listReminderSchemes(fresh);
    expect(list.map((s) => [s.name, formatOffsets(s.offsets), s.isDefault])).toEqual([
      ["Standard", "J-10 / J-5 / J-2 / J-1", true],
      ["Rendez-vous", "J-10 / J-1 / H-3 / M-10", false],
    ]);
  });

  it("gère les schémas : nom unique, un seul par défaut, suppression qui retire les rappels", async () => {
    await expect(createReminderScheme(db, { name: "test", offsets: [{ n: 1, unit: "j" }] })).rejects.toThrow(DomainError);
    const other = await createReminderScheme(db, { name: "Autre", offsets: [{ n: 1, unit: "j" }], isDefault: true });
    expect(await getDefaultSchemeId(db)).toBe(other.id);
    await setDefaultScheme(db, schemeId);
    expect(await getDefaultSchemeId(db)).toBe(schemeId);
    await updateReminderScheme(db, schemeId, { name: "Test renommé", offsets: [{ n: 1, unit: "h" }, { n: 3, unit: "j" }] });
    expect(formatOffsets((await listReminderSchemes(db)).find((s) => s.id === schemeId)!.offsets)).toBe("J-3 / H-1");

    const t = await task("2026-11-20", null);
    expect((await listReminderSchemes(db)).find((s) => s.id === schemeId)!.usage).toBe(1);
    await deleteReminderScheme(db, schemeId);
    expect((await getTodo(db, t.id))!.reminderSchemeId).toBeNull();
  });

  it("envoie chaque rappel une fois, par e-mail et sur chaque appareil, au responsable", async () => {
    await savePushSubscription(db, userId, { endpoint: "https://push.test/a", keys: { p256dh: "k", auth: "a" } }, "Chrome sur Android");
    const t = await task("2026-11-20", "14:30");

    expect((await run("2026-11-18T13:00:00Z")).envoyes).toBe(0); // avant J-2 (13:30 UTC)
    const r = await run("2026-11-18T13:31:00Z");
    expect(r.envoyes).toBe(1);
    expect(sent.map((s) => [s.channel, s.to])).toEqual([
      ["email", "marie@example.com"],
      ["push", "Chrome sur Android"],
    ]);
    expect(sent[0].msg.title).toBe("Rappel J-2 · Contrôle technique");
    expect(sent[0].msg.body).toContain("20 nov. 2026 à 14:30 (dans 2 jours)");
    expect(sent[0].msg.url).toBe(`https://carnet.test/taches/${t.id}`);

    // Rejoué : rien de plus
    expect((await run("2026-11-18T13:40:00Z")).envoyes).toBe(0);
    expect(sent).toHaveLength(2);

    // H-3 le jour même
    await run("2026-11-20T10:31:00Z");
    expect(sent.at(-1)!.msg.title).toBe("Rappel H-3 · Contrôle technique");
    // Après l'échéance : plus rien
    expect((await run("2026-11-20T14:00:00Z")).envoyes).toBe(0);
  });

  it("ne rattrape que le dernier rappel manqué et ignore ceux d'avant la création", async () => {
    const first = await task("2026-11-20", "14:30");
    const r = await run("2026-11-20T10:31:00Z"); // J-2, J-1 et H-3 sont passés
    expect(r.envoyes).toBe(1);
    expect(r.sautes).toBe(2);
    expect(sent.map((s) => s.msg.title)).toEqual(["Rappel H-3 · Contrôle technique"]);

    // Historique de la tâche : un rappel envoyé, deux remplacés par le plus récent
    const hist = (await listAudit(db, { todoId: first.id })).filter((e) => e.action === "rappel");
    expect(hist).toHaveLength(3);
    expect(hist.every((e) => e.source === "systeme" && e.userName === "Rappels")).toBe(true);
    const texts = hist.map((e) => describeDetails(e).join(" | "));
    expect(texts).toContainEqual(expect.stringMatching(/^H-3 envoyé \| e-mail à Marie \| Prévu le .+ \| Échéance du 20 nov\. 2026 à 14:30$/));
    expect(texts.filter((t) => t.startsWith("J-1 non envoyé (remplacé par un rappel plus récent)") || t.startsWith("J-2 non envoyé (remplacé par un rappel plus récent)"))).toHaveLength(2);

    // Tâche créée après J-1 : J-1 n'est pas envoyé
    const late = await task("2026-11-25", null);
    await db.update(todos).set({ updatedAt: new Date("2026-11-24T09:00:00Z") }).where(eq(todos.id, late.id));
    sent = [];
    const r2 = await run("2026-11-24T09:01:00Z");
    expect(sent).toHaveLength(0);
    expect(r2.sautes).toBe(2);
    const lateHist = (await listAudit(db, { todoId: late.id })).filter((e) => e.action === "rappel");
    expect(lateHist.map((e) => describeDetails(e)[0])).toEqual([
      expect.stringContaining("non envoyé (prévu avant la création ou la dernière modification de la tâche)"),
      expect.stringContaining("non envoyé (prévu avant la création ou la dernière modification de la tâche)"),
    ]);
  });

  it("réarme les rappels quand l'échéance change, et s'arrête quand la tâche est faite", async () => {
    const t = await task("2026-11-20", null);
    await run("2026-11-19T07:01:00Z");
    expect(sent.map((s) => s.msg.title)).toEqual(["Rappel J-1 · Contrôle technique"]);

    await db.update(todos).set({ dueDate: "2026-11-27", updatedAt: new Date("2026-11-19T08:00:00Z") }).where(eq(todos.id, t.id));
    await run("2026-11-25T07:01:00Z");
    expect(sent).toHaveLength(2);

    await setTodoStatus(db, t.id, "fait");
    await run("2026-11-26T07:01:00Z");
    expect(sent).toHaveLength(2);
  });

  it("respecte les préférences, prévient le créateur sans responsable, retire les abonnements expirés", async () => {
    const creator = (await createUser(db, { email: "eric@example.com", name: "Eric", role: "admin", weeklyHoursAvailable: null, skills: null })).id;
    await savePushSubscription(db, creator, { endpoint: "https://push.test/expire", keys: { p256dh: "k", auth: "a" } }, "Vieux PC");
    await setNotifyPrefs(db, creator, { email: false });
    await task("2026-11-20", null, { assigneeId: null, createdById: creator });
    const r = await run("2026-11-19T07:01:00Z");
    expect(r.sans_canal).toBe(1); // e-mail coupé, seul appareil expiré
    expect(await listPushSubscriptions(db, creator)).toHaveLength(0);
    const rows = await db.select().from(reminderDeliveries);
    expect(rows.find((d) => d.outcome !== "saute")!.userId).toBe(creator);

    await setNotifyPrefs(db, userId, { email: false, push: false });
    sent = [];
    await task("2026-11-21", null);
    const r2 = await run("2026-11-20T07:01:00Z");
    expect(r2.sans_canal).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it("l'occurrence suivante d'une tâche récurrente garde l'heure et le schéma", async () => {
    const t = await task("2026-11-20", "14:30", { recurrence: "mensuelle" });
    const next = await setTodoStatus(db, t.id, "fait", { today: "2026-11-20" });
    const n = (await getTodo(db, next!))!;
    expect([n.dueDate, n.dueTime?.slice(0, 5), n.reminderSchemeId]).toEqual(["2026-12-20", "14:30", schemeId]);
  });

  it("une heure sans date est refusée par la base", async () => {
    await expect(createTodo(db, { objectId, title: "X", dueTime: "10:00" })).rejects.toThrow();
  });
});
