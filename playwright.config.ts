import { defineConfig, devices } from "@playwright/test";

// Parcours de bout en bout. Cible : E2E_BASE_URL (dev déployé ou serveur local).
// Connexion via la connexion de test (E2E_EMAIL + E2E_SECRET = DEV_LOGIN_SECRET).
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    screenshot: "only-on-failure",
    launchOptions: process.env.CHROMIUM_PATH
      ? {
          executablePath: process.env.CHROMIUM_PATH,
          args: ["--no-sandbox", "--disable-gpu"],
        }
      : undefined,
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
});
