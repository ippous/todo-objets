// Logique d'arbre pure (sans base de données), testée unitairement.

export type TreeObject = {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  type?: string | null;
};

export type Stats = {
  openCount: number;
  estHours: number;
  estValueEur: number;
};

export type TreeNode<T extends TreeObject = TreeObject> = T & {
  depth: number;
  children: TreeNode<T>[];
  own: Stats;
  total: Stats;
};

export const emptyStats = (): Stats => ({ openCount: 0, estHours: 0, estValueEur: 0 });

function addStats(a: Stats, b: Stats): Stats {
  return {
    openCount: a.openCount + b.openCount,
    estHours: round2(a.estHours + b.estHours),
    estValueEur: round2(a.estValueEur + b.estValueEur),
  };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

function sortSiblings<T extends TreeObject>(a: TreeNode<T>, b: TreeNode<T>) {
  return a.position - b.position || a.name.localeCompare(b.name, "fr");
}

/**
 * Construit la forêt (plusieurs racines possibles) et cumule les statistiques
 * de chaque nœud avec celles de tous ses descendants.
 * Un objet dont le parent est introuvable est traité comme une racine.
 */
export function buildForest<T extends TreeObject>(
  objects: T[],
  ownStats: Map<string, Stats> = new Map(),
): TreeNode<T>[] {
  const nodes = new Map<string, TreeNode<T>>();
  for (const o of objects) {
    const own = ownStats.get(o.id) ?? emptyStats();
    nodes.set(o.id, { ...o, depth: 0, children: [], own, total: own });
  }
  const roots: TreeNode<T>[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const visit = (node: TreeNode<T>, depth: number, seen: Set<string>): Stats => {
    if (seen.has(node.id)) return emptyStats(); // protection contre une boucle en base
    seen.add(node.id);
    node.depth = depth;
    node.children.sort(sortSiblings);
    let total = node.own;
    for (const child of node.children) total = addStats(total, visit(child, depth + 1, seen));
    node.total = total;
    return total;
  };
  roots.sort(sortSiblings);
  const seen = new Set<string>();
  for (const root of roots) visit(root, 0, seen);
  return roots;
}

/** Parcours en profondeur (ordre d'affichage). */
export function flatten<T extends TreeObject>(forest: TreeNode<T>[]): TreeNode<T>[] {
  const out: TreeNode<T>[] = [];
  const walk = (n: TreeNode<T>) => {
    out.push(n);
    n.children.forEach(walk);
  };
  forest.forEach(walk);
  return out;
}

/** Identifiants de l'objet et de tous ses descendants. */
export function subtreeIds(objects: TreeObject[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const o of objects) {
    if (!o.parentId) continue;
    const list = childrenOf.get(o.parentId) ?? [];
    list.push(o.id);
    childrenOf.set(o.parentId, list);
  }
  const result = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return result;
}

/** Vrai si placer `objectId` sous `newParentId` créerait une boucle. */
export function wouldCreateCycle(objects: TreeObject[], objectId: string, newParentId: string | null): boolean {
  if (!newParentId) return false;
  return subtreeIds(objects, objectId).has(newParentId);
}

/** Chemin depuis la racine jusqu'à l'objet (inclus). */
export function pathTo<T extends TreeObject>(objects: T[], id: string): T[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const path: T[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

/**
 * Regroupe des tâches par objet racine (couloirs du tableau), dans l'ordre de l'arbre.
 * Les racines sans tâche sont omises ; un objet introuvable compte comme sa propre racine.
 */
export function groupByRoot<T extends { objectId: string }>(
  objects: TreeObject[],
  items: T[],
): { root: { id: string; name: string }; items: T[] }[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const lanes = new Map<string, T[]>();
  for (const item of items) {
    const rootId = pathTo(objects, item.objectId)[0]?.id ?? item.objectId;
    const list = lanes.get(rootId) ?? [];
    list.push(item);
    lanes.set(rootId, list);
  }
  const order = buildForest(objects).map((n) => n.id);
  const rank = (id: string) => order.indexOf(id) + 1 || order.length + 1;
  return [...lanes.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([id, list]) => ({ root: { id, name: byId.get(id)?.name ?? "?" }, items: list }));
}

/** Valeur par heure estimée (€/h), null si non calculable. */
export function valuePerHour(estValueEur: number | null | undefined, estHours: number | null | undefined) {
  if (estValueEur == null || estHours == null || estHours <= 0) return null;
  return round2(estValueEur / estHours);
}

export type Recurrence = "aucune" | "mensuelle" | "saisonniere" | "annuelle";

/**
 * Prochaine échéance d'une tâche récurrente.
 * Base : l'échéance précédente si elle existe, sinon la date de réalisation.
 * Mensuelle : +1 mois, saisonnière : +3 mois, annuelle : +1 an.
 */
export function nextDueDate(previousDue: string | null, doneOn: string, recurrence: Recurrence): string | null {
  const months = { aucune: 0, mensuelle: 1, saisonniere: 3, annuelle: 12 }[recurrence];
  if (!months) return null;
  const base = previousDue ?? doneOn;
  const [y, m, d] = base.split("-").map(Number);
  const targetMonthIndex = m - 1 + months;
  const ty = y + Math.floor(targetMonthIndex / 12);
  const tm = targetMonthIndex % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const td = Math.min(d, lastDay);
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
}
