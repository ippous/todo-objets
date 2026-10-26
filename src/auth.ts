import "server-only";
import { timingSafeEqual } from "node:crypto";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { getDb } from "@/db";
import { ensureAdmins, getUserByEmail } from "@/lib/repo";

const adminEmails = () =>
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

/** Une adresse peut se connecter si elle est autorisée et active, ou listée dans ADMIN_EMAILS. */
async function isAllowed(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  const db = getDb();
  if (adminEmails().includes(normalized)) await ensureAdmins(db, [normalized]);
  const user = await getUserByEmail(db, normalized);
  return Boolean(user?.active);
}

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

const providers: NextAuthConfig["providers"] = [];

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google);
}

// Connexion de test, réservée à l'environnement de dev : n'existe que si
// DEV_LOGIN_SECRET est défini (jamais en production).
export const devLoginEnabled = Boolean(process.env.DEV_LOGIN_SECRET) && process.env.VERCEL_ENV !== "production";
if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev-login",
      name: "Connexion de test",
      credentials: { email: {}, secret: {} },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const secret = String(credentials?.secret ?? "");
        if (!safeEqual(secret, process.env.DEV_LOGIN_SECRET!)) return null;
        if (!(await isAllowed(email))) return null;
        return { email, name: email.split("@")[0] };
      },
    }),
  );
}

export const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/connexion", error: "/connexion" },
  trustHost: true,
  callbacks: {
    async signIn({ user, profile, account }) {
      if (account?.provider === "google" && profile && profile.email_verified !== true) return false;
      return isAllowed(user.email);
    },
  },
});
