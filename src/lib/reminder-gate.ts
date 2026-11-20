// Veille de la base entre deux rappels.
//
// La route d'envoi est appelée toutes les 5 minutes. Si chaque appel interrogeait la base, Neon ne
// se mettrait jamais en veille (elle s'endort après 5 minutes sans requête) et le temps de calcul
// gratuit (100 CU-h par mois) serait épuisé vers le 20 du mois.
//
// Après chaque passage, la route note ici l'instant du prochain rappel (borné à VEILLE_MAX). Tant
// qu'il n'est pas atteint, les appels suivants répondent sans toucher à la base. Toute écriture sur
// une tâche ou un schéma efface la note (`invaliderProchainRappel`) : le passage suivant recalcule.
//
// Stockage : sur Vercel, le Runtime Cache (partagé entre les fonctions d'une région, effacement par
// étiquette propagé à toutes les régions). Ailleurs (local, VPS, tests), une note en mémoire du
// processus, posée sur globalThis : Next charge ce module dans plusieurs paquets (actions, routes),
// et chacun aurait sinon sa propre copie. En cas d'erreur, on considère qu'il n'y a pas de note :
// la route interroge la base, comme avant.
import { getCache } from "@vercel/functions";

const CLE = "rappels:prochain";
const ETIQUETTE = "rappels";

/** Au plus 3 h sans regarder la base : filet si une modification n'a pas effacé la note. */
export const VEILLE_MAX_MS = 3 * 60 * 60 * 1000;

type Store = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, opts: { ttl: number; tags: string[] }): Promise<void>;
  delete(key: string): Promise<void>;
  expireTag(tag: string): Promise<void>;
};

const memoire = globalThis as unknown as { __rappelsProchain?: Map<string, { value: unknown; until: number }> };

function storeMemoire(): Store {
  const m = (memoire.__rappelsProchain ??= new Map());
  return {
    async get(key) {
      const e = m.get(key);
      return e && e.until > Date.now() ? e.value : null;
    },
    async set(key, value, { ttl }) {
      m.set(key, { value, until: Date.now() + ttl * 1000 });
    },
    async delete(key) {
      m.delete(key);
    },
    async expireTag() {
      m.clear();
    },
  };
}

const cache = (): Store => (process.env.VERCEL ? getCache({ namespace: "carnet" }) : storeMemoire());

/** Instant jusqu'auquel la base peut dormir, ou null s'il est inconnu. */
export async function lireProchainRappel(): Promise<Date | null> {
  try {
    const v = (await cache().get(CLE)) as { at?: unknown } | null;
    return v && typeof v.at === "number" ? new Date(v.at) : null;
  } catch (err) {
    console.error("cache des rappels (lecture)", err);
    return null;
  }
}

/** Note le prochain rappel (null : aucun de prévu), borné à VEILLE_MAX_MS après `now`. */
export async function noterProchainRappel(prochain: Date | null, now: Date): Promise<Date> {
  const max = now.getTime() + VEILLE_MAX_MS;
  const at = Math.min(prochain ? prochain.getTime() : max, max);
  try {
    const ttl = Math.max(60, Math.ceil((at - now.getTime()) / 1000));
    await cache().set(CLE, { at }, { ttl, tags: [ETIQUETTE] });
  } catch (err) {
    console.error("cache des rappels (écriture)", err);
  }
  return new Date(at);
}

/** Une tâche ou un schéma a changé : le prochain passage interrogera la base. */
export async function invaliderProchainRappel(): Promise<void> {
  try {
    const c = cache();
    await Promise.all([c.delete(CLE), c.expireTag(ETIQUETTE)]);
  } catch (err) {
    console.error("cache des rappels (effacement)", err);
  }
}
