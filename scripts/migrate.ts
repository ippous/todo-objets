// Applique les migrations SQL du dossier ./drizzle sur DATABASE_URL.
// Lancé automatiquement avant chaque build (dev et prod ont chacun leur base).
import "dotenv/config";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[migrate] DATABASE_URL absent : migrations ignorées");
    return;
  }
  if (/\.neon\.tech/.test(url)) {
    const { Pool } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-serverless");
    const { migrate } = await import("drizzle-orm/neon-serverless/migrator");
    const pool = new Pool({ connectionString: url });
    await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
    await pool.end();
  } else {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: url });
    await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
    await pool.end();
  }
  console.log("[migrate] base à jour");
}

main().catch((err) => {
  console.error("[migrate] échec", err);
  process.exit(1);
});
