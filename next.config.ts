import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // L'application est entièrement privée et dynamique (session obligatoire) :
  // pas de Cache Components, chaque page est rendue à la requête.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
