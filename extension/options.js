import { callTool, CarnetError, DEFAULT_SERVER, loadSettings, normalizeServer, saveSettings } from "./carnet.js";

const $ = (id) => document.getElementById(id);

function show(kind, ...parts) {
  const r = $("result");
  r.hidden = false;
  r.className = `result ${kind}`;
  r.replaceChildren(...parts);
}

async function init() {
  const s = await loadSettings();
  $("token").value = s.token;
  $("server").value = s.server === DEFAULT_SERVER ? "" : s.server;
  updateHelpLink();

  $("server").addEventListener("input", updateHelpLink);
  $("show").addEventListener("click", () => {
    const t = $("token");
    const hidden = t.type === "password";
    t.type = hidden ? "text" : "password";
    $("show").textContent = hidden ? "Masquer le jeton" : "Afficher le jeton";
  });

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const settings = { server: normalizeServer($("server").value || DEFAULT_SERVER), token: $("token").value.trim() };
    if (!/^https?:\/\/[^/]+/i.test(settings.server)) return show("err", "Adresse de Carnet invalide.");
    await saveSettings(settings);
    show("", "Test de la connexion…");
    try {
      const v = await callTool("vue_ensemble", {}, settings);
      const strong = (t) => Object.assign(document.createElement("strong"), { textContent: t });
      if (v.droits === "lecture et écriture") {
        show("ok", "Connecté en tant que ", strong(v.utilisateur_connecte ?? "?"), " — droits : lecture et écriture. Tout est prêt.");
      } else {
        show(
          "warn",
          "Connecté en tant que ",
          strong(v.utilisateur_connecte ?? "?"),
          `, mais le jeton est en ${v.droits ?? "lecture seule"} : l'ajout de liens sera refusé. Crée un jeton « Lecture et écriture ».`,
        );
      }
    } catch (err) {
      show("err", err instanceof CarnetError ? err.message : String(err));
    }
  });
}

function updateHelpLink() {
  const server = normalizeServer($("server").value || DEFAULT_SERVER);
  $("connexion-ia").href = `${server}/connexion-ia`;
}

void init();
