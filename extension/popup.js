import { callTool, CarnetError, loadSettings } from "./carnet.js";
import { fetchImage, ImageError, originPattern, prepareImage } from "./image.js";
import { ACCEPT, DocumentError, documentType, extensionOf, fileNameFromUrl, formatSize, looksLikeDocumentUrl, prepareDocument } from "./document.js";

const $ = (id) => document.getElementById(id);
const RECENTS_KEY = "recents";
const EXPANDED_KEY = "arbreOuvert";
const TAB_KEY = "ongletPopup";
const MAX_RECENTS = 8;
const PENDING_MAX_AGE = 2 * 60 * 1000;
const IN_WINDOW = new URLSearchParams(location.search).has("fenetre");
/** Modes qui créent un élément dans un objet (et non qui ajoutent à une cible). */
const CREATE_MODES = new Set(["tache", "objet"]);
const isCreateMode = (mode = state.mode) => CREATE_MODES.has(mode);

const state = {
  settings: null,
  mode: "lien", // "lien" | "photo" | "document" | "tache" | "objet" (création d'une tâche, d'un objet)
  attachMode: "lien", // dernier mode d'ajout (lien, photo, document), pour basculer sur un élément créé
  page: { url: "", title: "", windowId: undefined },
  linkable: false, // la page est une adresse http(s)
  photo: null, // { dataUrl, width, height, origine }
  doc: null, // { kind: "fichier", name, type, size, dataUrl } | { kind: "adresse", name, url }
  docTypes: null, // Promise<string[]> : types de documents de Carnet
  target: null, // { kind: "tache" | "objet", id, nom, chemin }
  created: null, // dernière tâche ou dernier objet créé : { kind, id, nom, chemin, url }
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
  const msg = err instanceof CarnetError || err instanceof ImageError || err instanceof DocumentError ? err.message : String(err?.message || err);
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
  if (target.kind === "objet") $("object-root").checked = false; // un parent choisi : plus de nouvel arbre
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
  const what = { lien: "le lien", photo: "la photo", document: "le document" }[state.mode];
  if (state.busy) return;
  if (state.added) {
    btn.disabled = true;
    btn.textContent = { lien: "Lien ajouté ✓", photo: "Photo ajoutée ✓", document: "Document ajouté ✓", tache: "Tâche créée ✓", objet: "Objet créé ✓" }[state.mode];
    return;
  }
  if (state.mode === "objet") {
    const root = $("object-root").checked;
    const missingObj = !$("object-name").value.trim() ? "Donne un nom à l'objet" : !root && t?.kind !== "objet" ? "Choisir l'objet parent" : "";
    btn.disabled = !!missingObj;
    btn.textContent = missingObj || (root ? "Créer l'objet (nouvel arbre)" : `Créer l'objet dans « ${t.nom} »`);
    return;
  }
  if (state.mode === "tache") {
    const missingTask = !$("task-title").value.trim() ? "Donne un titre à la tâche" : t?.kind !== "objet" ? "Choisir l'objet de la tâche" : "";
    btn.disabled = !!missingTask;
    btn.textContent = missingTask || `Créer la tâche dans « ${t.nom} »`;
    return;
  }
  const missing =
    state.mode === "photo" && !state.photo
      ? "Ajoute d'abord une image"
      : state.mode === "document" && !state.doc
        ? "Choisis d'abord un fichier"
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
    // En mode Tâche ou Objet, seule la cible « objet » a un sens : on ne cherche pas les tâches
    const onlyObjects = isCreateMode();
    const [objs, tasks] = await Promise.all([
      callTool("lister_objets", { recherche: q, limite: onlyObjects ? 30 : 8 }, state.settings),
      onlyObjects
        ? { taches: [] }
        : callTool("rechercher_taches", { recherche: q, statut: $("include-done").checked ? "toutes" : "ouvertes", tri: "echeance", limite: 40 }, state.settings),
    ]);
    if (seq !== searchSeq) return;
    const o = objs.objets ?? [];
    const t = tasks.taches ?? [];
    if (!o.length && !t.length)
      return fill(out, el("div", { class: "empty", text: onlyObjects ? "Aucun objet ne correspond." : "Aucune tâche ni aucun objet ne correspond." }));
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
  const onlyObjects = isCreateMode();
  const recents = (await loadRecents()).filter((r) => !onlyObjects || r.kind === "objet");
  if (!recents.length) {
    const hint = onlyObjects ? "Tape une partie du nom d'un objet, ou parcours l'arborescence." : "Tape une partie du nom d'une tâche ou d'un objet, ou parcours l'arborescence.";
    fill(out, el("div", { class: "empty", text: hint }));
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
  const creating = isCreateMode(mode);
  if (!creating) state.attachMode = mode;
  for (const b of document.querySelectorAll("[data-mode]")) b.setAttribute("aria-checked", String(b.dataset.mode === mode));
  $("link-card").hidden = mode !== "lien";
  $("photo-card").hidden = mode !== "photo";
  $("doc-card").hidden = mode !== "document";
  $("task-card").hidden = mode !== "tache";
  $("object-card").hidden = mode !== "objet";
  const wasCreating = document.body.classList.contains("mode-creation");
  document.body.classList.toggle("mode-creation", creating);
  $("include-done").closest("label").hidden = creating;
  $("description").placeholder =
    mode === "tache" ? "Description de la tâche (facultative)" : mode === "objet" ? "Description de l'objet (facultative)" : "Description (facultative)";
  $("search").placeholder =
    mode === "tache" ? "Nom de l'objet où créer la tâche…" : mode === "objet" ? "Nom de l'objet parent…" : "Nom d'une tâche ou d'un objet…";
  if (creating && state.target?.kind === "tache") {
    // Une tâche ne peut recevoir ni tâche ni objet : il faut choisir un objet
    state.target = null;
    for (const b of document.querySelectorAll("[data-target]")) b.setAttribute("aria-pressed", "false");
  }
  if (mode === "document") void loadDocTypes();
  if (wasCreating !== creating) void runSearch(); // résultats avec ou sans les tâches
  if (mode === "tache") $("task-title").focus();
  if (mode === "objet") $("object-name").focus();
  setStatus("");
  refreshFooter();
}

// ---------- Élément créé : basculer dessus ----------
/** Choisit l'élément créé comme cible, dans le mode indiqué (par défaut le dernier mode d'ajout). */
function switchTo(created, mode = state.attachMode) {
  setMode(mode);
  if (mode === "objet") $("object-root").checked = false;
  select(created);
  void rememberRecent(created);
  if (!isCreateMode(mode)) $("description").focus();
}

function showCreated(created) {
  const s = $("status");
  s.className = "status ok";
  const what = { lien: "un lien", photo: "une photo", document: "un document" }[state.attachMode];
  const btn = (text, title, onclick) => el("button", { type: "button", class: "secondary small", text, title, onclick });
  fill(
    s,
    `${created.kind === "tache" ? "Tâche" : "Objet"} « ${created.nom} » créé${created.kind === "tache" ? "e" : ""}`,
    created.parent ? ` dans « ${created.parent} »` : created.kind === "objet" ? " (nouvel arbre)" : "",
    ". ",
    created.url ? el("a", { href: created.url, target: "_blank", text: "Ouvrir" }) : null,
    el(
      "div",
      { class: "created-actions" },
      btn("Basculer dessus", `Choisir « ${created.nom} » comme cible pour y ajouter ${what}`, () => switchTo(created)),
      created.kind === "objet" ? btn("+ Tâche", `Créer une tâche dans « ${created.nom} »`, () => switchTo(created, "tache")) : null,
      created.kind === "objet" ? btn("+ Sous-objet", `Créer un objet sous « ${created.nom} »`, () => switchTo(created, "objet")) : null,
    ),
  );
}

/** L'arbre et les tâches en cache ne sont plus à jour : on les recharge (tout de suite si l'arbre est affiché). */
function invalidateTree(objectId) {
  if (objectId) state.tasksByObject.delete(objectId);
  state.treeLoaded = false;
  if (!$("panel-tree").hidden) void loadTree();
}

// ---------- Document ----------
/** Types de documents de Carnet, pour le sélecteur (« Autre » par défaut). */
async function loadDocTypes() {
  if (state.docTypes) return;
  state.docTypes = callTool("vue_ensemble", {}, state.settings)
    .then((r) => (r.types_documents ?? []).map((t) => t.nom))
    .catch(() => []);
  const names = await state.docTypes;
  if (!names.length) return;
  const select = $("doc-type");
  const current = select.value;
  fill(select, names.map((n) => el("option", { value: n, text: n })));
  select.value = names.includes(current) ? current : (names.find((n) => n.toLowerCase() === "autre") ?? names[0]);
}

function showDoc() {
  const d = state.doc;
  if (!d) {
    fill($("doc-preview"), el("span", { class: "preview-empty", text: "Glisse un fichier ici" }));
    fill($("doc-info"));
    return;
  }
  fill($("doc-preview"), (extensionOf(d.name) || "DOC").toUpperCase());
  fill(
    $("doc-info"),
    el("strong", { text: d.name, title: d.name }),
    el("span", { text: d.kind === "fichier" ? formatSize(d.size) : `Téléchargé par Carnet depuis ${new URL(d.url).host}` }),
  );
}

async function loadDocFile(file) {
  setMode("document");
  fill($("doc-info"), el("span", { text: "Préparation…" }));
  try {
    state.doc = await prepareDocument(file);
    state.added = false;
    setStatus("");
  } catch (e) {
    handleError(e);
  }
  showDoc();
  refreshFooter();
}

/** Document désigné par son adresse : Carnet le télécharge lui-même (25 Mo au plus). */
function loadDocUrl(url) {
  setMode("document");
  state.doc = { kind: "adresse", name: fileNameFromUrl(url), url };
  state.added = false;
  showDoc();
  setStatus(/^https:/i.test(url) ? "" : "Seules les adresses https peuvent être téléchargées par Carnet.", /^https:/i.test(url) ? "" : "err");
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
  const files = [...(e.clipboardData?.files ?? [])];
  const image = files.find((f) => f.type.startsWith("image/"));
  if (image && state.mode !== "document") {
    e.preventDefault();
    void loadPhotoBlob(image, "Image collée");
    return;
  }
  const doc = files.find((f) => documentType(f.name, f.type));
  if (!doc) return; // texte collé : comportement normal
  e.preventDefault();
  void loadDocFile(doc);
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
    const files = [...dt.files];
    // En mode Document, tout fichier devient un document ; sinon une image devient une photo
    const image = state.mode === "document" ? null : files.find((f) => f.type.startsWith("image/"));
    if (image) return void loadPhotoBlob(image, image.name);
    if (files[0]) return void loadDocFile(files[0]);
    const url = dt.getData("text/uri-list").split("\n").find((l) => l && !l.startsWith("#"));
    if (!url) return;
    if (state.mode === "document" || looksLikeDocumentUrl(url.trim())) loadDocUrl(url.trim());
    else void loadPhotoUrl(url.trim(), "Image déposée");
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
  if (state.busy || state.added) return;
  const objectAtRoot = state.mode === "objet" && $("object-root").checked;
  if (!t && !objectAtRoot) return;
  if (state.mode === "photo" && !state.photo) return;
  if (state.mode === "document" && !state.doc) return;
  if (state.mode === "lien" && !state.linkable) return;
  if (state.mode === "tache" && (t.kind !== "objet" || !$("task-title").value.trim())) return;
  if (state.mode === "objet" && ((!objectAtRoot && t.kind !== "objet") || !$("object-name").value.trim())) return;
  const btn = $("add");
  state.busy = true;
  btn.disabled = true;
  btn.textContent = "Envoi…";
  setStatus("");
  const owner = t?.kind === "tache" ? "tache" : "objet";
  const description = $("description").value.trim() || undefined;
  try {
    let page;
    if (state.mode === "tache") {
      const r = await callTool("creer_tache", { objet_id: t.id, titre: $("task-title").value.trim(), description }, state.settings);
      state.added = true;
      state.created = { kind: "tache", id: r.id, nom: r.titre, chemin: t.chemin, url: r.url, parent: t.nom };
      showCreated(state.created);
      // Prêt pour la suivante : on vide les champs (même objet par défaut)
      $("task-title").value = "";
      $("description").value = "";
      $("task-title").focus();
      invalidateTree(t.id);
      await rememberRecent(t);
      return;
    }
    if (state.mode === "objet") {
      const nom = $("object-name").value.trim();
      const parent = objectAtRoot ? null : t;
      const r = await callTool("creer_objet", { nom, parent_id: parent?.id, description }, state.settings);
      state.added = true;
      state.created = { kind: "objet", id: r.id, nom: r.nom, chemin: parent ? `${parent.chemin} › ${r.nom}` : r.nom, url: r.url, parent: parent?.nom };
      showCreated(state.created);
      $("object-name").value = "";
      $("description").value = "";
      $("object-name").focus();
      // Le parent est déplié pour montrer le nouvel objet dans l'arbre
      if (parent) {
        state.expanded.add(parent.id);
        void chrome.storage.local.set({ [EXPANDED_KEY]: [...state.expanded] });
        await rememberRecent(parent);
      }
      invalidateTree();
      return;
    }
    if (state.mode === "lien") {
      const titre = $("link-title").value.trim() || undefined;
      const r = await callTool("ajouter_lien", { [`${owner}_id`]: t.id, url: state.page.url, titre, description }, state.settings);
      page = r.page;
    } else if (state.mode === "photo") {
      const r = await callTool("ajouter_photo", { image_base64: state.photo.dataUrl, [`${owner}_ids`]: [t.id], description }, state.settings);
      if (!r.ajoutees) throw new CarnetError(r.erreurs?.[0]?.erreur ?? "La photo n'a pas été ajoutée.", "outil");
      page = r.photos?.[0]?.url;
    } else {
      const d = state.doc;
      const r = await callTool(
        "ajouter_document",
        {
          [`${owner}_id`]: t.id,
          ...(d.kind === "fichier" ? { nom_fichier: d.name, fichier_base64: d.dataUrl, format: d.type } : { url_source: d.url }),
          type_document: $("doc-type").value || undefined,
          description,
        },
        state.settings,
      );
      page = r.page;
    }
    state.added = true;
    setStatus(
      `${{ lien: "Lien ajouté", photo: "Photo ajoutée", document: "Document ajouté" }[state.mode]} ${t.kind === "tache" ? "à la tâche" : "à l'objet"} « ${t.nom} ».`,
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
  $("task-title").addEventListener("input", () => {
    state.added = false;
    refreshFooter();
  });
  $("object-name").addEventListener("input", () => {
    state.added = false;
    refreshFooter();
  });
  $("object-name").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (state.target?.kind === "objet" || $("object-root").checked) void submit();
    else $("search").focus();
  });
  $("object-root").addEventListener("change", () => {
    state.added = false;
    refreshFooter();
  });
  $("task-title").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (state.target?.kind === "objet") void submit();
    else $("search").focus();
  });
  $("link-title").addEventListener("input", () => {
    if (state.added && state.mode === "lien") {
      state.added = false;
      refreshFooter();
    }
  });
  // Une autre description : on peut renvoyer le même élément
  $("description").addEventListener("input", () => {
    if (state.added) {
      state.added = false;
      refreshFooter();
    }
  });
  $("doc-file").accept = ACCEPT;
  $("doc-file").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) void loadDocFile(f);
    e.target.value = "";
  });
  $("doc-page").hidden = !state.linkable;
  $("doc-page").addEventListener("click", () => loadDocUrl(state.page.url));
  $("capture").addEventListener("click", capturePage);
  $("file").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) void loadPhotoBlob(f, f.name);
    e.target.value = "";
  });
  document.addEventListener("paste", onPaste);
  setupDrop();

  // Un PDF (ou autre fichier) ouvert dans l'onglet est proposé comme document
  if (state.linkable && looksLikeDocumentUrl(url)) loadDocUrl(url);
  else setMode(state.linkable ? "lien" : "photo");
  await showRecents();
  showTab(stored[TAB_KEY] === "tree" ? "tree" : "search");

  if (pending?.kind === "image") await loadPhotoUrl(pending.srcUrl, "Image de la page");
  if (pending?.kind === "document") loadDocUrl(pending.linkUrl);
}

init().catch((e) => handleError(e));
