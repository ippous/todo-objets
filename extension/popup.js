import { callTool, CarnetError, loadSettings } from "./carnet.js";
import { fetchImage, ImageError, originPattern, prepareImage } from "./image.js";

const $ = (id) => document.getElementById(id);
const RECENTS_KEY = "recents";
const EXPANDED_KEY = "arbreOuvert";
const TAB_KEY = "ongletPopup";
const MAX_RECENTS = 8;
const PENDING_MAX_AGE = 2 * 60 * 1000;
const IN_WINDOW = new URLSearchParams(location.search).has("fenetre");

const state = {
  settings: null,
  mode: "lien", // "lien" | "photo"
  page: { url: "", title: "", windowId: undefined },
  linkable: false, // la page est une adresse http(s)
  photo: null, // { dataUrl, width, height, origine }
  target: null, // { kind: "tache" | "objet", id, nom, chemin }
  busy: false,
  added: false,
  treeLoaded: false,
  expanded: new Set(),
  tasksByObject: new Map(), // objet_id → Promise<tâches directes ouvertes>
};

// ---------- Petits utilitaires DOM ----------
function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c) n.append(c);
  return n;
}
/** replaceChildren en ignorant les valeurs nulles. */
const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter(Boolean));
const svg = (markup, size = 12) => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 16 16");
  s.setAttribute("width", String(size));
  s.setAttribute("height", String(size));
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = markup;
  return s;
};
const chevron = () => svg('<path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>');
const fmtDate = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "");
const keyOf = (t) => `${t.kind}:${t.id}`;

function setStatus(text, kind = "", link) {
  const s = $("status");
  s.className = `status ${kind}`;
  fill(s, text);
  if (link) s.append(" ", el("a", { href: link.href, target: "_blank", text: link.text }));
}

function block(message, detail, withSettings = true) {
  $("main").hidden = true;
  $("footer").hidden = true;
  $("modes").hidden = true;
  const b = $("blocker");
  b.hidden = false;
  fill(
    b,
    el("p", { text: message }),
    detail ? el("p", { class: "muted", text: detail }) : null,
    withSettings ? el("button", { class: "primary", type: "button", text: "Ouvrir les réglages", onclick: () => chrome.runtime.openOptionsPage() }) : null,
  );
}

function handleError(err, where) {
  if (err instanceof CarnetError && (err.kind === "auth" || err.kind === "config")) {
    block(err.message, "Crée un jeton personnel « Lecture et écriture » dans Carnet › Connexion IA, puis colle-le dans les réglages.");
    return;
  }
  const msg = err instanceof CarnetError || err instanceof ImageError ? err.message : String(err?.message || err);
  if (where) fill(where, el("div", { class: "error", text: msg }));
  else setStatus(msg, "err");
}

// ---------- Cible : tâche ou objet ----------
function targetButton(target, { title, path, meta, metaClass = "", done = false }) {
  const icon =
    target.kind === "objet"
      ? svg('<rect x="2.5" y="2.5" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/>', 14)
      : el("span", { class: "dot" });
  return el(
    "button",
    {
      type: "button",
      class: `task ${target.kind}${done ? " done" : ""}`,
      "data-target": keyOf(target),
      "aria-pressed": state.target && keyOf(state.target) === keyOf(target) ? "true" : "false",
      title: path ? `${title}\n${path}` : title,
      onclick: () => select(target),
      ondblclick: () => {
        select(target);
        void submit();
      },
    },
    el("span", { class: "t-icon", "aria-hidden": "true" }, icon),
    el("span", { class: "t-main" }, el("span", { class: "t-title", text: title }), path ? el("span", { class: "t-path", text: path }) : null),
    meta ? el("span", { class: `t-meta ${metaClass}`, text: meta }) : null,
  );
}

function taskButton(t, { showPath = true } = {}) {
  const done = t.statut === "fait";
  const late = t.en_retard;
  const meta = done ? "fait" : late ? `en retard · ${fmtDate(t.echeance)}` : t.echeance ? fmtDate(t.echeance) : t.statut === "en cours" ? "en cours" : "";
  return targetButton(
    { kind: "tache", id: t.id, nom: t.titre, chemin: t.objet?.chemin ?? "" },
    { title: t.titre, path: showPath ? t.objet?.chemin : "", meta, metaClass: late ? "late" : "", done },
  );
}

function objectButton(o) {
  const parent = o.chemin?.includes(" › ") ? o.chemin.slice(0, o.chemin.lastIndexOf(" › ")) : "";
  return targetButton({ kind: "objet", id: o.id, nom: o.nom, chemin: o.chemin ?? o.nom }, { title: o.nom, path: parent, meta: o.type ?? "" });
}

function select(target) {
  state.target = target;
  state.added = false;
  const k = keyOf(target);
  for (const b of document.querySelectorAll("[data-target]")) b.setAttribute("aria-pressed", b.dataset.target === k ? "true" : "false");
  setStatus("");
  refreshFooter();
}

function refreshFooter() {
  const t = state.target;
  const tg = $("target");
  if (t) fill(tg, el("span", { class: "kind", text: t.kind === "tache" ? "Tâche" : "Objet" }), " ", t.chemin || t.nom);
  else fill(tg);
  tg.title = t?.chemin ?? "";

  const btn = $("add");
  const what = state.mode === "photo" ? "la photo" : "le lien";
  if (state.busy) return;
  if (state.added) {
    btn.disabled = true;
    btn.textContent = state.mode === "photo" ? "Photo ajoutée ✓" : "Lien ajouté ✓";
    return;
  }
  const missing =
    state.mode === "photo" && !state.photo
      ? "Ajoute d'abord une image"
      : state.mode === "lien" && !state.linkable
        ? "Cette page ne peut pas devenir un lien"
        : !t
          ? "Choisir une tâche ou un objet"
          : "";
  btn.disabled = !!missing;
  btn.textContent = missing || `Ajouter ${what} à « ${t.nom} »`;
}

// ---------- Recherche ----------
let searchSeq = 0;
let searchTimer;

async function runSearch() {
  const q = $("search").value.trim();
  const out = $("search-results");
  const seq = ++searchSeq;
  if (!q) return showRecents();
  fill(out, el("div", { class: "loading", text: "Recherche…" }));
  try {
    const [objs, tasks] = await Promise.all([
      callTool("lister_objets", { recherche: q, limite: 8 }, state.settings),
      callTool("rechercher_taches", { recherche: q, statut: $("include-done").checked ? "toutes" : "ouvertes", tri: "echeance", limite: 40 }, state.settings),
    ]);
    if (seq !== searchSeq) return;
    const o = objs.objets ?? [];
    const t = tasks.taches ?? [];
    if (!o.length && !t.length) return fill(out, el("div", { class: "empty", text: "Aucune tâche ni aucun objet ne correspond." }));
    fill(
      out,
      t.length ? el("div", { class: "list-head", text: "Tâches" }) : null,
      t.map((x) => taskButton(x)),
      tasks.tronque ? el("div", { class: "empty", text: `${tasks.total} tâches : affine la recherche.` }) : null,
      o.length ? el("div", { class: "list-head", text: "Objets" }) : null,
      o.map(objectButton),
      objs.tronque ? el("div", { class: "empty", text: `${objs.total} objets : affine la recherche.` }) : null,
    );
  } catch (e) {
    if (seq === searchSeq) handleError(e, out);
  }
}

async function loadRecents() {
  const { [RECENTS_KEY]: raw = [] } = await chrome.storage.local.get(RECENTS_KEY);
  // Anciennes entrées (v0.1) : tâches seulement, avec « titre »
  return raw.map((r) => ({ kind: r.kind ?? "tache", id: r.id, nom: r.nom ?? r.titre, chemin: r.chemin ?? "" })).filter((r) => r.id && r.nom);
}

async function showRecents() {
  const out = $("search-results");
  const recents = await loadRecents();
  if (!recents.length) {
    fill(out, el("div", { class: "empty", text: "Tape une partie du nom d'une tâche ou d'un objet, ou parcours l'arborescence." }));
    return;
  }
  fill(
    out,
    el("div", { class: "list-head", text: "Utilisés récemment" }),
    recents.map((r) =>
      r.kind === "objet" ? objectButton({ id: r.id, nom: r.nom, chemin: r.chemin }) : taskButton({ id: r.id, titre: r.nom, objet: { chemin: r.chemin } }),
    ),
  );
}

async function rememberRecent(target) {
  const recents = await loadRecents();
  const next = [target, ...recents.filter((r) => keyOf(r) !== keyOf(target))].slice(0, MAX_RECENTS);
  await chrome.storage.local.set({ [RECENTS_KEY]: next });
}

// ---------- Arborescence ----------
async function loadTree() {
  if (state.treeLoaded) return;
  state.treeLoaded = true;
  const box = $("tree");
  fill(box, el("div", { class: "loading", text: "Chargement de l'arbre…" }));
  try {
    const r = await callTool("lister_objets", { limite: 1000 }, state.settings);
    const objets = r.objets ?? [];
    const ids = new Set(objets.map((o) => o.id));
    const children = new Map();
    for (const o of objets) {
      const k = o.parent_id ?? "";
      if (!children.has(k)) children.set(k, []);
      children.get(k).push(o);
    }
    const roots = objets.filter((o) => !o.parent_id || !ids.has(o.parent_id));
    if (!roots.length) return fill(box, el("div", { class: "empty", text: "Aucun objet." }));
    fill(
      box,
      el("ul", { role: "tree" }, roots.map((o) => treeNode(o, children))),
      r.tronque ? el("div", { class: "empty", text: "Arbre tronqué : utilise la recherche." }) : null,
    );
  } catch (e) {
    state.treeLoaded = false;
    handleError(e, box);
  }
}

function treeNode(o, children) {
  const kids = children.get(o.id) ?? [];
  const canOpen = kids.length > 0 || o.taches_ouvertes > 0;
  const tasksBox = el("div", { class: "node-tasks", hidden: true });
  const sub = kids.length ? el("ul", { role: "group", hidden: true }, kids.map((k) => treeNode(k, children))) : null;
  const twisty = el("button", {
    type: "button",
    class: `twisty${canOpen ? "" : " leaf"}`,
    "aria-expanded": "false",
    "aria-label": `Déplier ${o.nom}`,
    tabindex: canOpen ? null : "-1",
  });
  twisty.append(chevron());

  const toggle = async (force) => {
    if (!canOpen) return;
    const open = force ?? twisty.getAttribute("aria-expanded") !== "true";
    twisty.setAttribute("aria-expanded", String(open));
    tasksBox.hidden = !open;
    if (sub) sub.hidden = !open;
    if (open) state.expanded.add(o.id);
    else state.expanded.delete(o.id);
    void chrome.storage.local.set({ [EXPANDED_KEY]: [...state.expanded] });
    if (open) await fillTasks(o, tasksBox);
  };
  twisty.addEventListener("click", () => toggle());

  const target = { kind: "objet", id: o.id, nom: o.nom, chemin: o.chemin ?? o.nom };
  const name = el("button", {
    type: "button",
    class: "node-name",
    text: o.nom,
    title: `${o.chemin ?? o.nom}\nCliquer pour choisir cet objet`,
    "data-target": keyOf(target),
    "aria-pressed": state.target && keyOf(state.target) === keyOf(target) ? "true" : "false",
    onclick: () => {
      select(target);
      void toggle(true);
    },
    ondblclick: () => {
      select(target);
      void submit();
    },
  });

  const li = el(
    "li",
    { role: "treeitem" },
    el(
      "div",
      { class: "node-row" },
      twisty,
      name,
      o.taches_ouvertes ? el("span", { class: "node-count", title: "Tâches ouvertes (avec les sous-objets)", text: String(o.taches_ouvertes) }) : null,
    ),
    tasksBox,
    sub,
  );
  if (state.expanded.has(o.id)) void toggle(true);
  return li;
}

async function fillTasks(o, box) {
  if (box.dataset.filled) return;
  box.dataset.filled = "1";
  if (!o.taches_ouvertes) return; // aucune tâche ouverte dans la branche
  fill(box, el("div", { class: "empty", text: "…" }));
  try {
    if (!state.tasksByObject.has(o.id)) {
      state.tasksByObject.set(
        o.id,
        callTool("rechercher_taches", { objet_id: o.id, statut: "ouvertes", tri: "echeance", limite: 200 }, state.settings).then((r) =>
          (r.taches ?? []).filter((t) => t.objet?.id === o.id),
        ),
      );
    }
    const direct = await state.tasksByObject.get(o.id);
    fill(box, direct.map((t) => taskButton(t, { showPath: false })));
  } catch (e) {
    state.tasksByObject.delete(o.id);
    delete box.dataset.filled;
    handleError(e, box);
  }
}

// ---------- Onglets et modes ----------
function showTab(name) {
  const tree = name === "tree";
  $("tab-search").setAttribute("aria-selected", String(!tree));
  $("tab-tree").setAttribute("aria-selected", String(tree));
  $("panel-search").hidden = tree;
  $("panel-tree").hidden = !tree;
  void chrome.storage.local.set({ [TAB_KEY]: name });
  if (tree) void loadTree();
  else $("search").focus();
}

function setMode(mode) {
  state.mode = mode;
  state.added = false;
  for (const b of document.querySelectorAll("[data-mode]")) b.setAttribute("aria-checked", String(b.dataset.mode === mode));
  $("link-card").hidden = mode !== "lien";
  $("photo-card").hidden = mode !== "photo";
  setStatus("");
  refreshFooter();
}

// ---------- Photo ----------
function showPhoto() {
  const p = state.photo;
  const box = $("preview");
  if (!p) {
    fill(box, el("span", { class: "preview-empty", text: "Colle (Ctrl+V) ou glisse une image ici" }));
    fill($("photo-info"));
    return;
  }
  fill(box, el("img", { src: p.dataUrl, alt: "Aperçu de la photo" }));
  fill($("photo-info"), el("strong", { text: p.origine }), el("span", { text: `${p.width} × ${p.height} px` }));
}

async function loadPhotoBlob(blob, origine) {
  setMode("photo");
  fill($("photo-info"), el("span", { text: "Préparation…" }));
  try {
    const img = await prepareImage(blob);
    state.photo = { ...img, origine };
    state.added = false;
    showPhoto();
    setStatus("");
  } catch (e) {
    showPhoto();
    handleError(e);
  }
  refreshFooter();
}

async function capturePage() {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(state.page.windowId ?? null, { format: "png" });
    await loadPhotoBlob(await (await fetch(dataUrl)).blob(), "Capture de la page");
  } catch (e) {
    setMode("photo");
    setStatus(`Capture impossible : ${e?.message || e}`, "err");
  }
}

/** Image d'une page (menu contextuel ou glisser-déposer depuis le web). */
async function loadPhotoUrl(url, origine) {
  setMode("photo");
  fill($("photo-info"), el("span", { text: "Téléchargement…" }));
  try {
    await loadPhotoBlob(await fetchImage(url), origine);
  } catch (e) {
    showPhoto();
    if (e?.needsPermission) askSitePermission(url, origine);
    else handleError(e);
  }
}

function askSitePermission(url, origine) {
  const host = new URL(url).host;
  const s = $("status");
  s.className = "status";
  fill(
    s,
    el("span", { text: `Pour lire cette image, Carnet doit pouvoir accéder à ${host}. ` }),
    el("button", {
      type: "button",
      class: "linkish",
      text: "Autoriser ce site",
      onclick: async () => {
        // Doit rester dans le geste de l'utilisateur : pas d'await avant la demande
        const ok = await chrome.permissions.request({ origins: [originPattern(url)] }).catch(() => false);
        if (ok) await loadPhotoUrl(url, origine);
        else setStatus("Accès refusé : enregistre l'image puis utilise « Fichier… ».", "err");
      },
    }),
  );
}

function onPaste(e) {
  const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
  if (!file) return; // texte collé : comportement normal
  e.preventDefault();
  void loadPhotoBlob(file, "Image collée");
}

function setupDrop() {
  let depth = 0;
  const hint = $("drop-hint");
  const hasImage = (dt) => dt && [...dt.types].some((t) => t === "Files" || t === "text/uri-list");
  document.addEventListener("dragenter", (e) => {
    if (!hasImage(e.dataTransfer)) return;
    depth++;
    hint.hidden = false;
  });
  document.addEventListener("dragleave", () => {
    if (--depth <= 0) {
      depth = 0;
      hint.hidden = true;
    }
  });
  document.addEventListener("dragover", (e) => {
    if (hasImage(e.dataTransfer)) e.preventDefault();
  });
  document.addEventListener("drop", (e) => {
    depth = 0;
    hint.hidden = true;
    const dt = e.dataTransfer;
    if (!hasImage(dt)) return;
    e.preventDefault();
    const file = [...dt.files].find((f) => f.type.startsWith("image/"));
    if (file) return void loadPhotoBlob(file, file.name);
    const url = dt.getData("text/uri-list").split("\n").find((l) => l && !l.startsWith("#"));
    if (url) void loadPhotoUrl(url.trim(), "Image déposée");
  });
}

/** Image envoyée par le menu contextuel (« Ajouter cette image à Carnet »). */
async function takePending() {
  const { pending } = await chrome.storage.session.get("pending");
  if (!pending || Date.now() - pending.at > PENDING_MAX_AGE) return null;
  await chrome.storage.session.remove("pending");
  return pending;
}

// ---------- Envoi ----------
async function submit() {
  const t = state.target;
  if (!t || state.busy || state.added) return;
  if (state.mode === "photo" && !state.photo) return;
  if (state.mode === "lien" && !state.linkable) return;
  const btn = $("add");
  state.busy = true;
  btn.disabled = true;
  btn.textContent = "Envoi…";
  setStatus("");
  const owner = t.kind === "tache" ? "tache" : "objet";
  try {
    let page;
    if (state.mode === "lien") {
      const titre = $("link-title").value.trim() || undefined;
      const r = await callTool("ajouter_lien", { [`${owner}_id`]: t.id, url: state.page.url, titre }, state.settings);
      page = r.page;
    } else {
      const r = await callTool("ajouter_photo", { image_base64: state.photo.dataUrl, [`${owner}_ids`]: [t.id] }, state.settings);
      if (!r.ajoutees) throw new CarnetError(r.erreurs?.[0]?.erreur ?? "La photo n'a pas été ajoutée.", "outil");
      page = r.photos?.[0]?.url;
    }
    state.added = true;
    setStatus(
      `${state.mode === "photo" ? "Photo ajoutée" : "Lien ajouté"} ${t.kind === "tache" ? "à la tâche" : "à l'objet"} « ${t.nom} ».`,
      "ok",
      page ? { href: page, text: "Ouvrir" } : undefined,
    );
    await rememberRecent(t);
  } catch (e) {
    if (e instanceof CarnetError && e.kind === "droits")
      setStatus("Ce jeton est en lecture seule : crée un jeton « Lecture et écriture » dans Carnet › Connexion IA.", "err");
    else handleError(e);
  } finally {
    state.busy = false;
    refreshFooter();
  }
}

// ---------- Démarrage ----------
async function init() {
  $("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
  state.settings = await loadSettings();
  if (!state.settings.token) {
    block("Carnet n'est pas encore configuré.", "Il faut un jeton personnel « Lecture et écriture » (Carnet › Connexion IA).");
    return;
  }

  const pending = await takePending();
  let tab = pending?.page;
  if (!tab && !IN_WINDOW) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? "";
  state.linkable = /^https?:\/\//i.test(url);
  state.page = { url, title: tab?.title || url, windowId: tab?.windowId };

  if (state.linkable) {
    $("link-title").value = state.page.title.slice(0, 200);
    $("page-url").textContent = url;
    $("page-url").title = url;
    const fav = tab.favIconUrl;
    if (fav && /^(https?:|data:)/.test(fav)) $("favicon").src = fav;
    else $("favicon").hidden = true;
  } else {
    $("link-title").disabled = true;
    $("link-title").value = "Page non ajoutable comme lien";
    $("page-url").textContent = "Seules les adresses web (http, https) peuvent devenir des liens. Passe en mode Photo.";
    $("favicon").hidden = true;
  }
  // La capture ne vise que l'onglet sur lequel l'extension a été ouverte
  // (Chrome refuse de capturer ses pages internes et celles du Web Store)
  $("capture").hidden = IN_WINDOW || !/^(https?|file):/i.test(url) || /^https:\/\/chromewebstore\.google\.com/i.test(url);

  $("main").hidden = false;
  $("footer").hidden = false;
  $("modes").hidden = false;

  const stored = await chrome.storage.local.get([EXPANDED_KEY, TAB_KEY]);
  state.expanded = new Set(stored[EXPANDED_KEY] ?? []);

  for (const b of document.querySelectorAll("[data-mode]")) b.addEventListener("click", () => setMode(b.dataset.mode));
  $("tab-search").addEventListener("click", () => showTab("search"));
  $("tab-tree").addEventListener("click", () => showTab("tree"));
  $("search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 250);
  });
  $("search").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    clearTimeout(searchTimer);
    const first = $("search-results").querySelector("[data-target]");
    if (first && state.target && keyOf(state.target) === first.dataset.target) void submit();
    else if (first) first.click();
    else void runSearch();
  });
  $("include-done").addEventListener("change", runSearch);
  $("add").addEventListener("click", submit);
  $("link-title").addEventListener("input", () => {
    if (state.added && state.mode === "lien") {
      state.added = false;
      refreshFooter();
    }
  });
  $("capture").addEventListener("click", capturePage);
  $("file").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) void loadPhotoBlob(f, f.name);
    e.target.value = "";
  });
  document.addEventListener("paste", onPaste);
  setupDrop();

  setMode(state.linkable ? "lien" : "photo");
  await showRecents();
  showTab(stored[TAB_KEY] === "tree" ? "tree" : "search");

  if (pending?.kind === "image") await loadPhotoUrl(pending.srcUrl, "Image de la page");
}

init().catch((e) => handleError(e));
