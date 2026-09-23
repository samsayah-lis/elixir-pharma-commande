// ── Sonde de joignabilité PharmaML depuis Netlify (diagnostic, lecture seule) ──
// Ne transmet JAMAIS d'identifiants ni de commande : GET nus sur la page
// d'accueil et sur commandes.php, pour comparer avec l'agent local (IP du Mac).
import { isCronAuthorized, verifyAdmin } from "./auth.js";
import { getCors } from "./cors.js";

const PHARMAML_URL = (process.env.PHARMAML_URL || "https://pharmaml.elixirpharma.fr").replace(/\/$/, "");

async function probe(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect: "manual", headers: { Accept: "*/*" }, signal: AbortSignal.timeout(7000) });
    const body = await r.text();
    return { url, status: r.status, type: r.headers.get("content-type"), location: r.headers.get("location"),
             ms: Date.now() - t0, head: body.replace(/\s+/g, " ").slice(0, 120) };
  } catch (e) { return { url, error: e.message, ms: Date.now() - t0 }; }
}

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (!isCronAuthorized(event)) { const a = await verifyAdmin(event); if (a.error) return a.error; }
  const [egress, ...results] = await Promise.all([
    fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(6000) }).then(r => r.json()).catch(() => null),
    probe(PHARMAML_URL + "/"),
    probe(PHARMAML_URL + "/commandes.php"),
  ]);
  return { statusCode: 200, headers: { ...cors, "Cache-Control": "no-store" },
           body: JSON.stringify({ egress_ip: egress?.ip || null, results }) };
};
