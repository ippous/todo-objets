import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Carnet",
    short_name: "Carnet",
    description: "Tâches rattachées aux objets, classés en arborescences",
    start_url: "/",
    display: "standalone",
    background_color: "#eef1ec",
    theme_color: "#2f5d3a",
    lang: "fr",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
