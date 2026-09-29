// ── Commandes groupées : préparation d'un fichier pour l'analyse IA ─────
// Excel → texte CSV (toutes les feuilles) ; CSV/texte tels quels ; PDF en base64 ;
// photos réduites dans le navigateur (JPEG, 2000 px au plus) puis en base64.
import * as XLSX from "xlsx";

const MAX_PDF_BYTES = 4_000_000;          // → ≈ 5,33 M caractères en base64 (serveur : 5,5 M au plus)
const MAX_PDF_B64 = 5_500_000;
const MAX_IMAGE_B64 = 4_800_000;          // l'API refuse une image de plus de 5 Mo
const MAX_IMAGE_SIDE = 2000;
const JPEG_QUALITY = 0.85;
const MAX_SOURCE_BYTES = 30 * 1024 * 1024; // photo ou classeur à l'origine (au-delà, le navigateur peine)
export const MAX_TEXT = { lgo: 200_000, offre: 1_500_000 };
const MAX_WAIT_MS = 17 * 60 * 1000;         // un peu au-delà du seuil serveur (16 min) : le dernier statut dit « interrompue »
const IMAGE_MIMES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

const readAs = (file, how) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error("Lecture du fichier impossible"));
  r[how](file);
});
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const pad = (n) => String(n).padStart(2, "0");

// ── Excel ────────────────────────────────────────────────────────────────
// Deux pièges de SheetJS avec le format « Standard » / date :
//  - un CIP/EAN numérique sort en notation scientifique (« 3.40093E+12 ») → texte brut ;
//  - une date sort au format de l'Excel d'origine (« 9/29/26 ») → AAAA-MM-JJ.
// Les autres nombres gardent leur affichage (pourcentages, prix), d'où pas de rawNumbers.
function isoDateOf(serial, date1904, withTime) {
  const p = XLSX.SSF.parse_date_code(serial, { date1904 });
  if (!p) return null;
  const day = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  return withTime && (p.H || p.M) ? `${day} ${pad(p.H)}:${pad(p.M)}` : day;
}
export function fixSheetCells(ws, date1904 = false) {
  for (const addr of Object.keys(ws)) {
    if (addr[0] === "!") continue;
    const c = ws[addr];
    if (!c) continue;
    if (c.t === "n" && Number.isFinite(c.v)) {
      if (Number.isInteger(c.v) && Math.abs(c.v) >= 1e7) { c.w = String(c.v); continue; }
      const fmt = typeof c.z === "string" ? c.z : "";
      if (fmt && c.v >= 1 && XLSX.SSF.is_date(fmt)) {
        const iso = isoDateOf(c.v, date1904, /h/i.test(fmt.replace(/"[^"]*"/g, "")));
        if (iso) c.w = iso;
      }
    } else if (c.t === "d" && c.v instanceof Date && !isNaN(c.v)) {
      c.w = `${c.v.getFullYear()}-${pad(c.v.getMonth() + 1)}-${pad(c.v.getDate())}`;
    }
  }
  return ws;
}
export function workbookToText(data) {
  const wb = XLSX.read(data, { type: "array", dateNF: "yyyy-mm-dd", cellNF: true });
  const date1904 = !!wb.Workbook?.WBProps?.date1904;
  return wb.SheetNames
    .map(n => {
      const csv = XLSX.utils.sheet_to_csv(fixSheetCells(wb.Sheets[n], date1904), { FS: ";", blankrows: false, strip: true });
      return csv.trim() ? `### Feuille « ${n} »\n${csv}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

// ── Texte : UTF-8, sinon Windows-1252 (exports « ANSI » des LGO), UTF-16 si BOM ──
async function readText(file) {
  const buf = new Uint8Array(await readAs(file, "readAsArrayBuffer"));
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { return new TextDecoder("windows-1252").decode(buf); }
}

// ── Photos : réduction dans le navigateur ───────────────────────────────
async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* option refusée : sans option */ }
    try { return await createImageBitmap(file); } catch { /* repli sur <img> */ }
  }
  if (typeof Image === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("Votre navigateur ne sait pas préparer cette image : envoyez-la en PDF");
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Image illisible : envoyez une photo JPEG ou PNG"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function shrinkImage(file) {
  const src = await decodeImage(file);
  const w0 = src.naturalWidth || src.width, h0 = src.naturalHeight || src.height;
  if (!w0 || !h0) throw new Error("Image illisible : envoyez une photo JPEG ou PNG");
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Votre navigateur ne sait pas préparer cette image : envoyez-la en PDF");
  ctx.fillStyle = "#fff";                  // fond blanc : la transparence d'un PNG deviendrait noire en JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  if (typeof src.close === "function") src.close();
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  canvas.width = canvas.height = 0;        // libère la mémoire tout de suite (iPhone)
  if (!dataUrl.startsWith("data:image/jpeg")) throw new Error("Votre navigateur ne sait pas préparer cette image : envoyez-la en PDF");
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  if (!b64) throw new Error("Image illisible : envoyez une photo JPEG ou PNG");
  if (b64.length > MAX_IMAGE_B64) throw new Error("Photo trop lourde même après réduction : recadrez-la sur le tableau ou envoyez un PDF");
  return b64;
}

function checkText(text, kind) {
  if (!text || !text.trim()) throw new Error("Fichier vide");
  const max = MAX_TEXT[kind] || MAX_TEXT.offre;
  if (text.length > max) {
    throw new Error(`Fichier trop volumineux : ${text.length.toLocaleString("fr-FR")} caractères, ${max.toLocaleString("fr-FR")} au maximum pour ${kind === "lgo" ? "un bon de commande" : "une offre"}. Supprimez les feuilles ou colonnes inutiles.`);
  }
  return text;
}

export async function readForUpload(file, { kind = "offre" } = {}) {
  const name = file.name || "fichier";
  const ext = name.toLowerCase().split(".").pop();
  const type = file.type || "";
  if (["xlsx", "xls", "xlsm", "ods"].includes(ext)) {
    if (file.size > MAX_SOURCE_BYTES) throw new Error("Classeur trop lourd (30 Mo maximum)");
    const text = workbookToText(await readAs(file, "readAsArrayBuffer"));
    return { file_name: name, mime: "text/csv", text: checkText(text, kind) };
  }
  if (["csv", "txt", "tsv"].includes(ext) || type.startsWith("text/")) {
    return { file_name: name, mime: "text/plain", text: checkText(await readText(file), kind) };
  }
  if (ext === "pdf" || type === "application/pdf") {
    if (file.size > MAX_PDF_BYTES) throw new Error("PDF trop lourd (4 Mo maximum) : envoyez seulement les pages utiles");
    const dataUrl = String(await readAs(file, "readAsDataURL"));
    const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    if (!b64) throw new Error("PDF illisible");
    if (b64.length > MAX_PDF_B64) throw new Error("PDF trop lourd (4 Mo maximum) : envoyez seulement les pages utiles");
    return { file_name: name, mime: "application/pdf", data_base64: b64 };
  }
  const imageMime = Object.values(IMAGE_MIMES).includes(type) ? type : IMAGE_MIMES[ext];
  if (!imageMime) throw new Error("Format non pris en charge : PDF, Excel, CSV ou image (PNG, JPEG, WebP)");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Photo trop lourde (30 Mo maximum)");
  return { file_name: name, mime: "image/jpeg", data_base64: await shrinkImage(file) };
}

// ── Dépôt puis attente du résultat ──────────────────────────────────────
function waitingMessage(secs, kind) {
  const t = secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)} min ${pad(secs % 60)} s`;
  if (secs >= 300) return `Analyse en cours (${t}) : ce document demande plus de temps que d'habitude, merci de patienter (15 min au plus).`;
  return kind === "lgo"
    ? `Lecture du bon de commande par l'IA (${t}) : comptez environ une minute.`
    : `Lecture de l'offre par l'IA (${t}) : une offre longue peut demander plusieurs minutes.`;
}

// post(body) : POST JSON vers /.netlify/functions/gp-upload (authentification et identité
// ajoutées par l'appelant), renvoie la réponse JSON ou lève Error(message).
// onProgress(secondes, message) : appelé à chaque interrogation du statut.
// Renvoie le statut final + file_name (lgo : result.qty / unmatched / warnings ; offre : result + products).
export async function analyzeFile({ file, kind, opId, post, onProgress }) {
  if (typeof post !== "function") throw new Error("analyzeFile : fonction « post » manquante");
  if (kind !== "lgo" && kind !== "offre") throw new Error("Type d'analyse inconnu");
  const payload = await readForUpload(file, { kind });
  onProgress?.(0, "Envoi du fichier…");
  const up = await post({ action: "upload", kind, op_id: opId, ...payload });
  if (!up?.job) throw new Error("Le serveur n'a pas accepté le fichier : réessayez");
  const started = Date.now();
  let failures = 0;
  while (Date.now() - started < MAX_WAIT_MS) {
    await sleep(Date.now() - started < 60_000 ? 3000 : 5000);
    const secs = Math.round((Date.now() - started) / 1000);
    onProgress?.(secs, waitingMessage(secs, kind));
    let s;
    try {
      s = await post({ action: "status", job: up.job });
      failures = 0;
    } catch (e) {
      if (++failures >= 4) throw e;       // coupure réseau passagère : on réessaie
      continue;
    }
    if (s?.status === "termine") return { ...s, file_name: payload.file_name };
    if (s?.status === "erreur") throw new Error(s.error || "Analyse impossible");
  }
  throw new Error("L'analyse n'a pas abouti au bout de 15 minutes : réessayez plus tard, ou découpez le document en plusieurs fichiers.");
}
