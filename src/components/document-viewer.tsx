"use client";

// Visionneuse de documents : chaque format est lu dans le navigateur à partir de
// /api/documents/[id] (session requise). Les bibliothèques lourdes ne sont chargées
// qu'au besoin.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ViewerKind } from "@/lib/document-types";
import { formatSize } from "@/lib/document-types";

type Props = { src: string; kind: ViewerKind; contentType: string; filename: string };

const MAX_ROWS = 500;
const MAX_TEXT = 2_000_000;

export function DocumentViewer({ src, kind, contentType, filename }: Props) {
  if (kind === "none") return <NoPreview src={src} />;
  return (
    <section aria-label={`Aperçu de ${filename}`} className="grid gap-2">
      {kind === "pdf" && <PdfView src={src} />}
      {kind === "image" && <ImageView src={src} filename={filename} />}
      {kind === "text" && <TextView src={src} json={contentType === "application/json"} />}
      {kind === "csv" && <CsvView src={src} />}
      {kind === "docx" && <DocxView src={src} />}
      {kind === "xlsx" && <XlsxView src={src} />}
      {kind === "odt" && <OdfView src={src} sheet={false} />}
      {kind === "ods" && <OdfView src={src} sheet />}
      {kind === "pptx" && <PptxView src={src} />}
      {kind === "zip" && <ZipView src={src} />}
    </section>
  );
}

// ---------- Commun ----------

function NoPreview({ src, reason }: { src: string; reason?: string }) {
  return (
    <div className="grid justify-items-start gap-3 rounded-xl bg-surface p-6">
      <p className="font-bold">Aperçu indisponible pour ce format.</p>
      <p className="text-muted">{reason ?? "Télécharge le fichier pour l'ouvrir avec l'application adaptée."}</p>
      <a href={`${src}?telecharger=1`} className="btn btn-primary">
        Télécharger
      </a>
    </div>
  );
}

function Loading() {
  return (
    <p role="status" className="rounded-xl bg-surface p-6 text-muted">
      Chargement de l&apos;aperçu…
    </p>
  );
}

/** Charge le fichier puis le transforme ; gère chargement et erreur. */
function useLoaded<T>(src: string, as: "text" | "buffer", transform: (data: string | ArrayBuffer) => Promise<T> | T) {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  const fn = useRef(transform);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(src, { credentials: "same-origin" });
        if (!res.ok) throw new Error(res.status === 401 ? "Session expirée : reconnecte-toi." : "Fichier introuvable.");
        const raw = as === "text" ? await res.text() : await res.arrayBuffer();
        const data = await fn.current(raw);
        if (alive) setState({ data });
      } catch (err) {
        console.error("[viewer]", err);
        if (alive) setState({ error: (err as Error).message || "Lecture impossible." });
      }
    })();
    return () => {
      alive = false;
    };
  }, [src, as]);
  return state;
}

function Loaded<T>({ state, src, children }: { state: { data?: T; error?: string }; src: string; children: (d: T) => ReactNode }) {
  if (state.error) return <NoPreview src={src} reason={`Le fichier n'a pas pu être lu (${state.error}).`} />;
  if (state.data === undefined) return <Loading />;
  return <>{children(state.data)}</>;
}

function Table({ rows, caption }: { rows: string[][]; caption?: string }) {
  const shown = rows.slice(0, MAX_ROWS);
  const width = Math.max(0, ...shown.map((r) => r.length));
  if (!shown.length) return <p className="rounded-xl bg-surface p-4 text-muted">Feuille vide.</p>;
  const [head, ...body] = shown;
  return (
    <div className="max-h-[70vh] overflow-auto rounded-xl bg-surface">
      <table className="num w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="sticky top-0 bg-moss-soft">
          <tr>
            {Array.from({ length: width }, (_, i) => (
              <th key={i} scope="col" className="border-b border-line px-3 py-2 text-left font-bold">
                {head[i] ?? ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="odd:bg-paper/40">
              {Array.from({ length: width }, (_, j) => (
                <td key={j} className="border-b border-line px-3 py-1.5 align-top whitespace-pre-wrap">
                  {r[j] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX_ROWS && (
        <p className="p-3 text-sm text-muted">
          {MAX_ROWS} premières lignes sur {rows.length}. Télécharge le fichier pour tout voir.
        </p>
      )}
    </div>
  );
}

function Tabs({ names, children }: { names: string[]; children: (i: number) => ReactNode }) {
  const [current, setCurrent] = useState(0);
  return (
    <div className="grid gap-2">
      {names.length > 1 && (
        <div role="tablist" aria-label="Feuilles" className="flex flex-wrap gap-1">
          {names.map((n, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === current}
              className={`rounded-md px-3 py-1.5 text-sm font-bold ${i === current ? "bg-moss-soft text-moss" : "text-muted hover:text-ink"}`}
              onClick={() => setCurrent(i)}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      <div role={names.length > 1 ? "tabpanel" : undefined}>{children(current)}</div>
    </div>
  );
}

// ---------- PDF (pdf.js : fonctionne aussi sur mobile, où les PDF intégrés ne s'affichent pas) ----------

function PdfView({ src }: { src: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const res = await fetch(src, { credentials: "same-origin" });
        if (!res.ok) throw new Error("Fichier introuvable.");
        const task = pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) });
        destroy = () => void task.destroy();
        const pdf = await task.promise;
        if (cancelled || !box.current) return;
        setPages(pdf.numPages);
        const container = box.current;
        container.replaceChildren();
        const width = container.clientWidth || 800;
        const ratio = window.devicePixelRatio || 1;
        for (let n = 1; n <= pdf.numPages && !cancelled; n++) {
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = "100%";
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `Page ${n} sur ${pdf.numPages}`);
          canvas.className = "rounded-lg bg-white shadow-sm";
          container.appendChild(canvas);
          await page.render({ canvas, viewport }).promise;
        }
      } catch (err) {
        console.error("[viewer pdf]", err);
        if (!cancelled) setError((err as Error).message || "Lecture impossible.");
      }
    })();
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [src]);

  if (error) return <NoPreview src={src} reason={`Le PDF n'a pas pu être affiché (${error}).`} />;
  return (
    <>
      {pages === null && <Loading />}
      {pages !== null && (
        <p className="text-sm text-muted">
          {pages} page{pages > 1 ? "s" : ""}
        </p>
      )}
      <div ref={box} data-testid="pdf-pages" className="grid gap-3" />
    </>
  );
}

// ---------- Images ----------

function ImageView({ src, filename }: { src: string; filename: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <NoPreview src={src} reason="Ton navigateur ne sait pas afficher ce format d'image (HEIC, par exemple)." />;
  return (
    <a href={src} target="_blank" rel="noopener" className="block rounded-xl bg-surface p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={filename} className="mx-auto max-h-[75vh] w-auto rounded-lg" onError={() => setFailed(true)} />
    </a>
  );
}

// ---------- Texte, Markdown, JSON ----------

function TextView({ src, json }: { src: string; json: boolean }) {
  const state = useLoaded(src, "text", (raw) => {
    let text = (raw as string).slice(0, MAX_TEXT);
    if (json) {
      try {
        text = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* JSON invalide : affiché tel quel */
      }
    }
    return { text, truncated: (raw as string).length > MAX_TEXT };
  });
  return (
    <Loaded state={state} src={src}>
      {(d) => (
        <>
          <pre className="max-h-[75vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface p-4 font-mono text-sm">
            {d.text}
          </pre>
          {d.truncated && <p className="text-sm text-muted">Texte tronqué. Télécharge le fichier pour tout voir.</p>}
        </>
      )}
    </Loaded>
  );
}

// ---------- CSV ----------

/** Lecteur CSV minimal : guillemets, séparateur « , » ou « ; » détecté sur la 1re ligne. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : first.includes("\t") && !first.includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function CsvView({ src }: { src: string }) {
  const state = useLoaded(src, "text", (raw) => parseCsv(raw as string));
  return <Loaded state={state} src={src}>{(rows) => <Table rows={rows} />}</Loaded>;
}

// ---------- Word (.docx) ----------

/** Ne garde que des liens web dans le HTML produit. */
function safeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  doc.querySelectorAll("script,iframe,object,embed,style").forEach((e) => e.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const a of [...el.attributes]) {
      if (a.name.startsWith("on")) el.removeAttribute(a.name);
      if (a.name === "href" && !/^(https?:|mailto:|#)/i.test(a.value)) el.removeAttribute("href");
      if (a.name === "src" && !/^data:image\//i.test(a.value)) el.removeAttribute("src");
    }
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
  });
  return doc.body.firstElementChild?.innerHTML ?? "";
}

function DocxView({ src }: { src: string }) {
  const state = useLoaded(src, "buffer", async (buf) => {
    const mammoth = (await import("mammoth")).default;
    const r = await mammoth.convertToHtml({ arrayBuffer: buf as ArrayBuffer });
    return safeHtml(r.value);
  });
  return (
    <Loaded state={state} src={src}>
      {(html) =>
        html.trim() ? (
          <article className="doc-preview rounded-xl bg-surface p-6" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="rounded-xl bg-surface p-6 text-muted">Document vide.</p>
        )
      }
    </Loaded>
  );
}

// ---------- Excel (.xlsx) ----------

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toLocaleDateString("fr-FR");
  if (typeof v === "number") return v.toLocaleString("fr-FR");
  if (typeof v === "boolean") return v ? "VRAI" : "FAUX";
  return String(v);
}

function XlsxView({ src }: { src: string }) {
  const state = useLoaded(src, "buffer", async (buf) => {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    const sheets = await readXlsxFile(new Blob([buf as ArrayBuffer]));
    return sheets.map((s) => ({ name: s.sheet, rows: s.data.map((r) => r.map(cellText)) }));
  });
  return (
    <Loaded state={state} src={src}>
      {(sheets) => <Tabs names={sheets.map((s) => s.name)}>{(i) => <Table rows={sheets[i].rows} caption={sheets[i].name} />}</Tabs>}
    </Loaded>
  );
}

// ---------- OpenDocument (.odt, .ods) ----------

const ODF = {
  text: "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
  table: "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
};

async function zipXml(buf: ArrayBuffer, path: string): Promise<Document> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file(path);
  if (!file) throw new Error(`${path} absent`);
  return new DOMParser().parseFromString(await file.async("string"), "application/xml");
}

function odfText(el: Element): string {
  let out = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent;
    else if (n.nodeType === Node.ELEMENT_NODE) {
      const e = n as Element;
      if (e.localName === "s") out += " ".repeat(Number(e.getAttributeNS(ODF.text, "c") ?? 1));
      else if (e.localName === "tab") out += "\t";
      else if (e.localName === "line-break") out += "\n";
      else out += odfText(e);
    }
  });
  return out;
}

function OdfView({ src, sheet }: { src: string; sheet: boolean }) {
  const state = useLoaded(src, "buffer", async (buf) => {
    const xml = await zipXml(buf as ArrayBuffer, "content.xml");
    if (!sheet) {
      const blocks = [...xml.getElementsByTagNameNS(ODF.text, "*")].filter((e) => e.localName === "h" || e.localName === "p");
      return { paras: blocks.filter((b) => !b.parentElement || b.parentElement.namespaceURI !== ODF.text || b.parentElement.localName !== "p").map((b) => ({ h: b.localName === "h", t: odfText(b) })) };
    }
    const sheets = [...xml.getElementsByTagNameNS(ODF.table, "table")].map((t) => {
      const rows: string[][] = [];
      for (const r of [...t.getElementsByTagNameNS(ODF.table, "table-row")]) {
        const reps = Math.min(Number(r.getAttributeNS(ODF.table, "number-rows-repeated") ?? 1), 50);
        const cells: string[] = [];
        for (const c of [...r.children].filter((c) => c.localName === "table-cell" || c.localName === "covered-table-cell")) {
          const n = Math.min(Number(c.getAttributeNS(ODF.table, "number-columns-repeated") ?? 1), 100);
          const text = [...c.getElementsByTagNameNS(ODF.text, "p")].map(odfText).join("\n");
          for (let k = 0; k < n; k++) cells.push(text);
        }
        while (cells.length && !cells[cells.length - 1]) cells.pop();
        for (let k = 0; k < reps; k++) rows.push(cells);
      }
      while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
      return { name: t.getAttributeNS(ODF.table, "name") ?? "Feuille", rows };
    });
    return { sheets };
  });
  return (
    <Loaded state={state} src={src}>
      {(d) =>
        "sheets" in d && d.sheets ? (
          <Tabs names={d.sheets.map((s) => s.name)}>{(i) => <Table rows={d.sheets![i].rows} caption={d.sheets![i].name} />}</Tabs>
        ) : (
          <article className="doc-preview grid gap-2 rounded-xl bg-surface p-6">
            {d.paras?.map((p, i) =>
              p.h ? (
                <h2 key={i} className="text-lg font-bold">
                  {p.t}
                </h2>
              ) : (
                <p key={i} className="whitespace-pre-wrap">
                  {p.t}
                </p>
              ),
            )}
          </article>
        )
      }
    </Loaded>
  );
}

// ---------- PowerPoint (.pptx) : texte de chaque diapositive ----------

function PptxView({ src }: { src: string }) {
  const state = useLoaded(src, "buffer", async (buf) => {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buf as ArrayBuffer);
    const files = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    const slides: string[][] = [];
    for (const p of files) {
      const xml = new DOMParser().parseFromString(await zip.file(p)!.async("string"), "application/xml");
      const paras = [...xml.getElementsByTagName("a:p")].map((para) =>
        [...para.getElementsByTagName("a:t")].map((t) => t.textContent ?? "").join(""),
      );
      slides.push(paras.filter((t) => t.trim()));
    }
    return slides;
  });
  return (
    <Loaded state={state} src={src}>
      {(slides) => (
        <div className="grid gap-3">
          <p className="text-sm text-muted">Texte des {slides.length} diapositives (sans la mise en page ni les images).</p>
          <ol className="grid gap-3">
            {slides.map((s, i) => (
              <li key={i} className="rounded-xl bg-surface p-4">
                <p className="text-sm font-bold text-muted">Diapositive {i + 1}</p>
                {s.length ? (
                  s.map((t, j) => (
                    <p key={j} className={j === 0 ? "font-bold" : ""}>
                      {t}
                    </p>
                  ))
                ) : (
                  <p className="text-muted">(sans texte)</p>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Loaded>
  );
}

// ---------- ZIP : liste du contenu ----------

function ZipView({ src }: { src: string }) {
  const state = useLoaded(src, "buffer", async (buf) => {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buf as ArrayBuffer);
    return Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => ({
        name: f.name,
        // Taille décompressée quand l'archive la fournit
        size: (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? null,
        date: f.date,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  });
  return (
    <Loaded state={state} src={src}>
      {(files) => (
        <div className="grid gap-2">
          <p className="text-sm text-muted">
            {files.length} fichier{files.length > 1 ? "s" : ""} dans l&apos;archive. Télécharge-la pour les extraire.
          </p>
          <ul className="max-h-[70vh] overflow-auto rounded-xl bg-surface px-4">
            {files.map((f) => (
              <li key={f.name} className="num flex justify-between gap-3 border-b border-line py-2 text-sm last:border-b-0">
                <span className="break-all">{f.name}</span>
                <span className="shrink-0 text-muted">{f.size !== null ? formatSize(f.size) : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Loaded>
  );
}
