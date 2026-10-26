import type { Metadata, Viewport } from "next";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Carnet", template: "%s · Carnet" },
  description: "Tâches rattachées aux objets, classés en arborescences",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Carnet", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef1ec" },
    { media: "(prefers-color-scheme: dark)", color: "#141a17" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
