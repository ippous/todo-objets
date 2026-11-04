import "server-only";
// Pièces jointes du chat : images et documents envoyés à l'assistant, gardés 7 jours,
// lisibles par le modèle et rattachables à une tâche ou un objet (outil joindre_piece).
import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "@/db";
import { chatAttachments, type ChatAttachment } from "@/db/schema";
import { DOCUMENT_TYPES, documentType, safeFileName } from "./document-types";
import { DomainError } from "./repo";
import { read, remove, save, storagePrefix } from "./storage";

/** Envoi direct au serveur : la requête est limitée à 4,5 Mo par Vercel. */
export const PIECE_MAX_BYTES = 4 * 1024 * 1024;
export const PIECE_KEEP_DAYS = 7;
export const PIECES_PER_MESSAGE = 6;

export type PieceInfo = { id: string; name: string; type: string; size: number };
export const pieceInfo = (p: ChatAttachment): PieceInfo => ({ id: p.id, name: p.filename, type: p.contentType, size: p.size });

/** Enregistre une pièce jointe (formats de documents de Carnet). */
export async function savePiece(db: Db, userId: string, file: { name: string; type: string; bytes: Uint8Array }): Promise<ChatAttachment> {
  const name = (file.name || "piece").trim().slice(0, 200);
  const type = documentType(name, file.type);
  if (!type) throw new DomainError(`Format non accepté : « ${name} » (${[...new Set(Object.values(DOCUMENT_TYPES))].join(", ")})`);
  if (file.bytes.byteLength === 0) throw new DomainError("Fichier vide");
  if (file.bytes.byteLength > PIECE_MAX_BYTES) throw new DomainError(`« ${name} » dépasse 4 Mo : ajoute-le depuis la fiche de la tâche ou de l'objet`);
  const pathname = `${storagePrefix}/assistant/${userId}/${randomUUID()}/${safeFileName(name)}`;
  await save(pathname, file.bytes, type);
  const [row] = await db
    .insert(chatAttachments)
    .values({ userId, pathname, filename: name, contentType: type, size: file.bytes.byteLength })
    .returning();
  return row;
}

/** Pièces de cet utilisateur parmi `ids` (les autres sont ignorées). */
export async function getPieces(db: Db, userId: string, ids: string[]): Promise<ChatAttachment[]> {
  const clean = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!clean.length) return [];
  return db.select().from(chatAttachments).where(and(eq(chatAttachments.userId, userId), inArray(chatAttachments.id, clean)));
}

export async function readPiece(p: ChatAttachment): Promise<Buffer | null> {
  const stream = await read(p.pathname);
  if (!stream) return null;
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Efface les pièces de plus de 7 jours (appelé par la tâche planifiée des rappels). */
export async function deleteExpiredPieces(db: Db, now = new Date()): Promise<number> {
  const limit = new Date(now.getTime() - PIECE_KEEP_DAYS * 86_400_000);
  const old = await db.delete(chatAttachments).where(lt(chatAttachments.createdAt, limit)).returning({ pathname: chatAttachments.pathname });
  await remove(old.map((o) => o.pathname));
  return old.length;
}

const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TEXT_MAX = 50_000;

/** Ce que le modèle peut lire d'une pièce : image, PDF, texte extrait, ou rien (seulement le nom). */
export type PieceContent =
  | { kind: "image"; mediaType: string; data: string }
  | { kind: "pdf"; data: string }
  | { kind: "text"; text: string }
  | { kind: "none" };

export async function pieceContent(p: ChatAttachment): Promise<PieceContent> {
  const bytes = await readPiece(p);
  if (!bytes) return { kind: "none" };
  if (p.contentType.startsWith("image/") && p.contentType !== "image/heic") return { kind: "image", mediaType: p.contentType, data: bytes.toString("base64") };
  if (p.contentType === "application/pdf") return { kind: "pdf", data: bytes.toString("base64") };
  try {
    if (TEXT_TYPES.has(p.contentType)) return { kind: "text", text: bytes.toString("utf8").slice(0, TEXT_MAX) };
    if (p.contentType === DOCX) {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer: bytes });
      return { kind: "text", text: value.slice(0, TEXT_MAX) };
    }
    if (p.contentType === XLSX) {
      const { default: readXlsxFile } = await import("read-excel-file/node");
      const sheets = await readXlsxFile(bytes);
      const text = sheets
        .map((s) => `# ${s.sheet}\n${(s.data as unknown[][]).map((r) => r.map((c) => (c == null ? "" : String(c))).join(" ; ")).join("\n")}`)
        .join("\n\n");
      return { kind: "text", text: text.slice(0, TEXT_MAX) };
    }
  } catch {
    /* contenu illisible : on ne donne que le nom */
  }
  return { kind: "none" };
}
