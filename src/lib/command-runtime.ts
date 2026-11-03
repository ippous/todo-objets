// Exécution des commandes de saisie dans le navigateur, isolée dans un Web Worker :
// pas d'accès à la page (DOM, cookies via document), réseau coupé, arrêt forcé après 2 s.
// Les commandes sont écrites par les administrateurs ; cette isolation limite les dégâts d'une erreur.
import { listCommandsForEditorAction } from "@/app/command-actions";

export type CommandDef = { name: string; description: string | null; code: string };
export type CommandContext = { titre?: string | null; objet?: string | null };
export type RunResult = { ok: true; value: string; ms: number } | { ok: false; error: string; ms: number };

export const COMMAND_TIMEOUT_MS = 2000;
const RESULT_MAX = 5000;

const WORKER_SOURCE = `
const AsyncFunction = (async () => {}).constructor;
self.onmessage = async (e) => {
  const { code, ctx } = e.data;
  // Réseau et chargement de scripts coupés pour le code de la commande
  for (const k of ["fetch", "XMLHttpRequest", "importScripts", "WebSocket", "EventSource", "indexedDB", "caches"]) {
    for (let o = Object.getPrototypeOf(self); o; o = Object.getPrototypeOf(o)) {
      if (Object.prototype.hasOwnProperty.call(o, k)) { try { delete o[k]; } catch {} }
    }
    try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); } catch {}
  }
  try {
    const value = await new AsyncFunction("ctx", '"use strict";\\n' + code)(Object.freeze(ctx));
    self.postMessage({ ok: true, value: value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value) });
  } catch (err) {
    self.postMessage({ ok: false, error: (err && err.name ? err.name + " : " : "") + String(err && err.message !== undefined ? err.message : err) });
  }
};`;

let workerUrl: string | null = null;

/** Exécute le code d'une commande et renvoie son texte, ou l'erreur. */
export function runCommandCode(code: string, name: string, context: CommandContext = {}): Promise<RunResult> {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return Promise.resolve({ ok: false, error: "Exécution impossible ici", ms: 0 });
  }
  workerUrl ??= URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  const ctx = { maintenant: new Date().toISOString(), titre: context.titre ?? null, objet: context.objet ?? null, commande: name };
  const started = performance.now();
  return new Promise((resolve) => {
    const worker = new Worker(workerUrl!);
    const done = (r: { ok: true; value: string } | { ok: false; error: string }) => {
      clearTimeout(timer);
      worker.terminate();
      const ms = Math.round(performance.now() - started);
      resolve(r.ok ? { ok: true, value: r.value.slice(0, RESULT_MAX), ms } : { ok: false, error: r.error, ms });
    };
    const timer = setTimeout(() => done({ ok: false, error: `Délai dépassé (${COMMAND_TIMEOUT_MS / 1000} s)` }), COMMAND_TIMEOUT_MS);
    worker.onmessage = (e) => done(e.data);
    worker.onerror = (e) => {
      e.preventDefault();
      done({ ok: false, error: e.message || "Erreur de syntaxe" });
    };
    worker.postMessage({ code, ctx });
  });
}

// ---------- Liste des commandes, chargée une fois par page ----------

let cache: Promise<CommandDef[]> | null = null;

export function getCommands(): Promise<CommandDef[]> {
  cache ??= listCommandsForEditorAction().catch(() => {
    cache = null;
    return [];
  });
  return cache;
}

/** À appeler après une modification des commandes. */
export function forgetCommands() {
  cache = null;
}

/** Exécute une commande par son nom. */
export async function runCommand(name: string, context: CommandContext = {}): Promise<RunResult> {
  const cmd = (await getCommands()).find((c) => c.name === name.toLowerCase());
  if (!cmd) return { ok: false, error: `Commande « ${name} » introuvable`, ms: 0 };
  return runCommandCode(cmd.code, cmd.name, context);
}

/** Remplit les commandes @@ d'un contenu affiché (hors éditeur). */
export function fillLiveCommands(root: HTMLElement, context: CommandContext = {}) {
  root.querySelectorAll<HTMLElement>("span[data-commande]").forEach((el) => {
    const name = el.dataset.commande ?? "";
    el.classList.add("commande-live");
    el.title = `@@${name} : recalculé à chaque affichage`;
    void runCommand(name, context).then((r) => {
      if (r.ok) el.textContent = r.value;
      else {
        el.textContent = `@@${name} ⚠`;
        el.title = r.error;
      }
    });
  });
}
