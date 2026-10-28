import { callTool, CarnetError, loadSettings } from "./carnet.js";

const $ = (id) => document.getElementById(id);
const RECENTS_KEY = "recents";
const EXPANDED_KEY = "arbreOuvert";
const TAB_KEY = "ongletPopup";
const MAX_RECENTS = 6;

const state = {
  settings: null,
  page: { url: "", title: "" },
  selected: null, // { id, titre, chemin }
  treeLoaded: false,
  expanded: new Set(),
  tasksByObject: new Map(), // objet_id → Promise<tâches directes>
  added: false,
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
const chevron = () => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 16 16");
  s.setAttribute("width", "12");
  s.setAttribute("height", "12");
  s.innerHTML = '<path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  return s;
};
/** replaceChildren en ignorant les valeurs nulles. */
const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter(Boolean));
const fmtDate = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "");

function setStatus(text, kind = "", link) {
  const s = $("status");
  s.className = `status ${kind}`;
  fill(s, text);
  if (link) s.append(" ", el("a", { href: link.href, target: "_blank", text: link.text }));
}

function block(message, detail, withSettings = true) {
  $("main").hidden = true;
  $("footer").hidden = true;
  const b = $("blocker");
  b.hidden = false;
  fill(b, 
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
  const msg = err instanceof CarnetError ? err.message : String(err?.message || err);
  if (where) fill(where, el("div", { class: "error", text: msg }));
  else setStatus(msg, "err");
}

// ---------- Lignes de tâche ----------
function taskButton(t, { showPath = true } = {}) {
  const late = t.en_retard;
  const done = t.statut === "fait";
  const meta = done ? "fait" : late ? `en retard · ${fmtDate(t.echeance)}` : t.echeance ? fmtDate(t.echeance) : t.statut === "en cours" ? "en cours" : "";
  const b = el(
    "button",
    {
      type: "button",
      class: `task${done ? " done" : ""}`,
      "data-task": t.id,
      "aria-pressed": state.selected?.id === t.id ? "true" : "false",
      title: t.objet?.chemin ? `${t.titre}\n${t.objet.chemin}` : t.titre,
      onclick: () => select({ id: t.id, titre: t.titre, chemin: t.objet?.chemin ?? "" }),
      ondblclick: () => {
        select({ id: t.id, titre: t.titre, chemin: t.objet?.chemin ?? "" });
        addLink();
      },
    },
    el("span", { class: "dot", "aria-hidden": "true" }),
    el(
      "span",
      { class: "t-main" },
      el("span", { class: "t-title", text: t.titre }),
      showPath && t.objet?.chemin ? el("span", { class: "t-path", text: t.objet.chemin }) : null,
    ),
    meta ? el("span", { class: `t-meta${late ? " late" : ""}`, text: meta }) : null,
  );
  return b;
}

function select(task) {
  if (state.added) resetAdded();
  state.selected = task;
  for (const b of document.querySelectorAll("[data-task]")) b.setAttribute("aria-pressed", b.dataset.task === task.id ? "true" : "false");
  const btn = $("add");
  btn.disabled = false;
  btn.textContent = `Ajouter à « ${task.titre} »`;
  btn.title = task.chemin ? `${task.titre} — ${task.chemin}` : task.titre;
  setStatus("");
}

function resetAdded() {
  state.added = false;
  $("add").disabled = !state.selected;
  if (state.selected) $("add").textContent = `Ajouter à « ${state.selected.titre} »`;
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
    const r = await callTool(
      "rechercher_taches",
      { recherche: q, statut: $("include-done").checked ? "toutes" : "ouvertes", tri: "echeance", limite: 40 },
      state.settings,
    );
    if (seq !== searchSeq) return;
    if (!r.taches?.length) return fill(out, el("div", { class: "empty", text: "Aucune tâche ne correspond." }));
    fill(out, 
      ...r.taches.map((t) => taskButton(t)),
      r.tronque ? el("div", { class: "empty", text: `${r.total} résultats : affine la recherche.` }) : null,
    );
  } catch (e) {
    if (seq === searchSeq) handleError(e, out);
  }
}

async function showRecents() {
  const out = $("search-results");
  const { [RECENTS_KEY]: recents = [] } = await chrome.storage.local.get(RECENTS_KEY);
  if (!recents.length) {
    fill(out, el("div", { class: "empty", text: "Tape une partie du nom de la tâche, ou parcours l'arborescence." }));
    return;
  }
  fill(out, 
    el("div", { class: "list-head", text: "Utilisées récemment" }),
    ...recents.map((r) => taskButton({ id: r.id, titre: r.titre, objet: { chemin: r.chemin } })),
  );
}

async function rememberRecent(task) {
  const { [RECENTS_KEY]: recents = [] } = await chrome.storage.local.get(RECENTS_KEY);
  const next = [task, ...recents.filter((r) => r.id !== task.id)].slice(0, MAX_RECENTS);
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
    const children = new Map();
    for (const o of objets) {
      const k = o.parent_id ?? "";
      if (!children.has(k)) children.set(k, []);
      children.get(k).push(o);
    }
    const roots = objets.filter((o) => !o.parent_id || !objets.some((p) => p.id === o.parent_id));
    if (!roots.length) return fill(box, el("div", { class: "empty", text: "Aucun objet." }));
    fill(box, 
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
    "aria-label": `Ouvrir ${o.nom}`,
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

  const li = el(
    "li",
    { role: "treeitem" },
    el(
      "div",
      { class: "node-row" },
      twisty,
      el("button", { type: "button", class: "node-name", text: o.nom, title: o.chemin, onclick: () => toggle() }),
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
  // Seulement s'il y a des tâches ouvertes dans la branche
  if (!o.taches_ouvertes) return;
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
    fill(box, ...direct.map((t) => taskButton(t, { showPath: false })));
  } catch (e) {
    state.tasksByObject.delete(o.id);
    delete box.dataset.filled;
    handleError(e, box);
  }
}

// ---------- Onglets ----------
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

// ---------- Ajout du lien ----------
async function addLink() {
  if (!state.selected || state.added) return;
  const btn = $("add");
  const task = state.selected;
  btn.disabled = true;
  btn.textContent = "Ajout…";
  setStatus("");
  try {
    const titre = $("link-title").value.trim() || undefined;
    const r = await callTool("ajouter_lien", { tache_id: task.id, url: state.page.url, titre }, state.settings);
    state.added = true;
    btn.textContent = "Lien ajouté ✓";
    setStatus(`Ajouté à « ${task.titre} ».`, "ok", r.page ? { href: r.page, text: "Ouvrir la tâche" } : undefined);
    await rememberRecent(task);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = `Ajouter à « ${task.titre} »`;
    if (e instanceof CarnetError && e.kind === "droits")
      setStatus("Ce jeton est en lecture seule : crée un jeton « Lecture et écriture » dans Carnet › Connexion IA.", "err");
    else handleError(e);
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

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? "";
  if (!/^https?:\/\//i.test(url)) {
    block("Cette page ne peut pas être ajoutée.", "Seules les adresses web (http ou https) peuvent devenir des liens Carnet.", false);
    return;
  }
  state.page = { url, title: tab.title || url };
  $("link-title").value = state.page.title.slice(0, 200);
  $("page-url").textContent = url;
  $("page-url").title = url;
  const fav = tab.favIconUrl;
  if (fav && /^(https?:|data:)/.test(fav)) $("favicon").src = fav;
  else $("favicon").hidden = true;

  $("main").hidden = false;
  $("footer").hidden = false;

  const stored = await chrome.storage.local.get([EXPANDED_KEY, TAB_KEY]);
  state.expanded = new Set(stored[EXPANDED_KEY] ?? []);

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
    const first = $("search-results").querySelector("[data-task]");
    if (first && state.selected?.id === first.dataset.task) addLink();
    else if (first) first.click();
    else runSearch();
  });
  $("include-done").addEventListener("change", runSearch);
  $("add").addEventListener("click", addLink);
  $("link-title").addEventListener("input", () => {
    if (state.added) resetAdded();
  });

  await showRecents();
  showTab(stored[TAB_KEY] === "tree" ? "tree" : "search");
}

init().catch((e) => handleError(e));
