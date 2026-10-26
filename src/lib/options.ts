import type { ObjectRow } from "@/db/schema";
import { buildForest, flatten, subtreeIds } from "./tree";

export type ObjectOption = { id: string; label: string; depth: number };

/** Options d'objets dans l'ordre de l'arbre, indentées selon la profondeur. */
export function objectOptions(objs: ObjectRow[], exclude?: string): ObjectOption[] {
  const excluded = exclude ? subtreeIds(objs, exclude) : new Set<string>();
  return flatten(buildForest(objs))
    .filter((n) => !excluded.has(n.id))
    .map((n) => ({ id: n.id, depth: n.depth, label: `${"   ".repeat(n.depth)}${n.depth ? "└ " : ""}${n.name}` }));
}
