// Crée l'arborescence de départ (uniquement si la base ne contient aucun objet).
import "dotenv/config";
import { getDb } from "../src/db";
import { seedInitialTree } from "../src/lib/seed";

seedInitialTree(getDb())
  .then((done) => {
    console.log(done ? "[seed] arborescence initiale créée" : "[seed] des objets existent déjà : rien à faire");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[seed] échec", err);
    process.exit(1);
  });
