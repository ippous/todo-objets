import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const globalForDb = globalThis as unknown as { __db?: Db };

function createDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL n'est pas défini");

  if (/\.neon\.tech/.test(url)) {
    // Neon : pilote WebSocket (supporte les transactions)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("@neondatabase/serverless") as typeof import("@neondatabase/serverless");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle } = require("drizzle-orm/neon-serverless") as typeof import("drizzle-orm/neon-serverless");
    return drizzle({ client: new Pool({ connectionString: url }), schema }) as unknown as Db;
  }

  // PostgreSQL classique (local, VPS)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg") as typeof import("pg");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require("drizzle-orm/node-postgres") as typeof import("drizzle-orm/node-postgres");
  return drizzle({ client: new Pool({ connectionString: url, max: 5 }), schema }) as unknown as Db;
}

export function getDb(): Db {
  if (!globalForDb.__db) globalForDb.__db = createDb();
  return globalForDb.__db;
}

export { schema };
