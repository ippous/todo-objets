// Applique les migrations SQL du dossier ./drizzle, puis crée l'arborescence
// de départ si la base est vide. Lancé automatiquement avant chaque build :
// dev et prod ont chacun leur base.
import "dotenv/config";

/** Identifie la base sans exposer d'identifiant secret (ex. « ep-cool-name-123456 »). */
function describe(url: string) {
  try {
    const host = new URL(url).hostname;
    return host.split(".")[0].replace(/-pooler$/, "");
  } catch {
    return "?";
  }
}

async function main() {
  // Connexion directe (non mutualisée) recommandée pour les migrations
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    console.log("[migrate] DATABASE_URL absent : migrations ignorées");
    return;
  }
  console.log(`[migrate] base ${describe(url)} (env ${process.env.VERCEL_ENV ?? "local"}, branche ${process.env.VERCEL_GIT_COMMIT_REF ?? "-"})`);

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

  const { getDb } = await import("../src/db");
  const { seedInitialTree } = await import("../src/lib/seed");
  const created = await seedInitialTree(getDb());
  console.log(created ? "[seed] arborescence initiale créée" : "[seed] objets déjà présents");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[migrate] échec", err);
    process.exit(1);
  });
