import { z } from "zod";
import { CATEGORIES, PRIORITIES, RECURRENCES, ROLES, STATUSES } from "@/db/schema";

export type ActionState = { error?: string; ok?: boolean };

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

/** Accepte « 1,5 » comme « 1.5 ». Vide → null. */
export const optionalNumber = (fd: FormData, k: string) => {
  const raw = str(fd, k).replace(/\s/g, "").replace(",", ".");
  return raw === "" ? null : Number(raw);
};

export const optionalText = (fd: FormData, k: string) => str(fd, k) || null;

export const parseTags = (raw: string) =>
  [...new Set(raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);

const amount = z.number().finite().min(0, "Les montants et durées ne peuvent pas être négatifs").max(1e9).nullable();
const uuidOrNull = z.string().uuid().nullable();

export const objectSchema = z.object({
  name: z.string().min(1, "Le nom est obligatoire").max(120),
  type: z.string().max(60).nullable(),
  description: z.string().max(4000).nullable(),
  location: z.string().max(200).nullable(),
  tags: z.array(z.string().max(40)),
});

export function readObject(fd: FormData) {
  return objectSchema.safeParse({
    name: str(fd, "name"),
    type: optionalText(fd, "type"),
    description: optionalText(fd, "description"),
    location: optionalText(fd, "location"),
    tags: parseTags(str(fd, "tags")),
  });
}

export const todoSchema = z.object({
  objectId: z.string().uuid("Choisis un objet"),
  title: z.string().min(1, "Le titre est obligatoire").max(200),
  description: z.string().max(8000).nullable(),
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  status: z.enum(STATUSES),
  estHours: amount,
  actualHours: amount,
  estValueEur: amount,
  actualValueEur: amount,
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide").nullable(),
  recurrence: z.enum(RECURRENCES),
  assigneeId: uuidOrNull,
  tags: z.array(z.string().max(40)),
});

export function readTodo(fd: FormData) {
  return todoSchema.safeParse({
    objectId: str(fd, "objectId"),
    title: str(fd, "title"),
    description: optionalText(fd, "description"),
    category: str(fd, "category") || "entretien",
    priority: str(fd, "priority") || "moyenne",
    status: str(fd, "status") || "a_faire",
    estHours: optionalNumber(fd, "estHours"),
    actualHours: optionalNumber(fd, "actualHours"),
    estValueEur: optionalNumber(fd, "estValueEur"),
    actualValueEur: optionalNumber(fd, "actualValueEur"),
    dueDate: optionalText(fd, "dueDate"),
    recurrence: str(fd, "recurrence") || "aucune",
    assigneeId: optionalText(fd, "assigneeId"),
    tags: parseTags(str(fd, "tags")),
  });
}

export const userSchema = z.object({
  email: z.string().email("Adresse e-mail invalide"),
  name: z.string().min(1, "Le nom est obligatoire").max(80),
  role: z.enum(ROLES),
  weeklyHoursAvailable: amount,
  skills: z.string().max(500).nullable(),
});

export function readUser(fd: FormData) {
  return userSchema.safeParse({
    email: str(fd, "email"),
    name: str(fd, "name"),
    role: str(fd, "role") || "membre",
    weeklyHoursAvailable: optionalNumber(fd, "weeklyHoursAvailable"),
    skills: optionalText(fd, "skills"),
  });
}

export const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Données invalides";
export { str };
