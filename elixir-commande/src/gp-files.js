// ── Commandes groupées : préparation d'un fichier pour l'analyse IA ─────
// Excel → texte CSV (toutes les feuilles) ; CSV/texte tels quels ; PDF et images en base64.
import * as XLSX from "xlsx";

const MAX_BYTES = 4 * 1024 * 1024;

const readAs = (file, how) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error("Lecture du fichier impossible"));
  r[how](file);
});

export async function readForUpload(file) {
  const name = file.name || "fichier";
  const ext = name.toLowerCase().split(".").pop();
  if (["xlsx", "xls", "xlsm", "ods"].includes(ext)) {
    const wb = XLSX.read(await readAs(file, "readAsArrayBuffer"), { type: "array" });
    const text = wb.SheetNames.map(n => `### Feuille « ${n} »\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: ";", blankrows: false })}`).join("\n\n");
    return { file_name: name, mime: "text/csv", text };
  }
  if (["csv", "txt", "tsv"].includes(ext) || file.type.startsWith("text/")) {
    return { file_name: name, mime: "text/plain", text: await readAs(file, "readAsText") };
  }
  const mime = ext === "pdf" ? "application/pdf" : file.type;
  if (!["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(mime)) throw new Error("Format non pris en charge : PDF, Excel, CSV ou image (PNG, JPEG)");
  if (file.size > MAX_BYTES) throw new Error("Fichier trop lourd (4 Mo maximum)");
  const dataUrl = await readAs(file, "readAsDataURL");
  return { file_name: name, mime, data_base64: String(dataUrl).split(",")[1] };
}

// Dépose le fichier puis attend le résultat de l'analyse (≈ 30 s à 2 min)
export async function analyzeFile({ file, kind, opId, headers = {}, identity = {}, onProgress }) {
  const payload = await readForUpload(file);
  const call = async (body) => {
    const r = await fetch("/.netlify/functions/gp-upload", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ ...identity, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
    return j;
  };
  const { job } = await call({ action: "upload", kind, op_id: opId, ...payload });
  const started = Date.now();
  while (Date.now() - started < 8 * 60 * 1000) {
    await new Promise(res => setTimeout(res, 3000));
    onProgress?.(Math.round((Date.now() - started) / 1000));
    const s = await call({ action: "status", job });
    if (s.status === "termine") return { ...s, file_name: payload.file_name };
    if (s.status === "erreur") throw new Error(s.error || "Analyse impossible");
  }
  throw new Error("L'analyse prend trop de temps, réessayez");
}
