import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Db } from "@/db";
import * as schema from "@/db/schema";

/** Base PostgreSQL en mémoire avec les vraies migrations appliquées. */
export async function createTestDb(): Promise<Db> {
  const client = new PGlite();
  const dir = join(process.cwd(), "drizzle");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const statements = readFileSync(join(dir, file), "utf8").split("--> statement-breakpoint");
    for (const stmt of statements) if (stmt.trim()) await client.exec(stmt);
  }
  return drizzle({ client, schema }) as unknown as Db;
}
