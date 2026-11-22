// Entrée serveur signée du veilleur : uniquement les appareils de l'appli Admin.
import { configPush, creerStockPush, creerLimiteur, estApercu, charge, envoyerAAppareils } from "./_push.js";
import { verifierSignature } from "./_push-messages.js";

export const CORPS_MAX = 2048;
export const SECRET_MIN = 32;

export function creerHandler(deps = {}) {
  let stockDefaut;
  const limite = deps.limite || creerLimiteur();
  const maintenant = deps.maintenant || (() => new Date());
  const journal = deps.journal || ((o) => console.log(JSON.stringify(o)));
  const rep = (statusCode, body, headers = {}) => {
    journal({ evt: "push_alerte_admin", code: body.error || (body.apercu ? "apercu" : body.aucun ? "aucun" : "ok"), envoyes: body.envoyes || 0, echecs: body.echecs || 0 });
    return { statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers }, body: JSON.stringify(body) };
  };
  const quota = (s) => rep(429, { error: "quota" }, { "Retry-After": String(s) });
  return async (event) => {
    if (event.httpMethod !== "POST") return rep(405, { error: "methode" }, { Allow: "POST" });
    const brut = event.isBase64Encoded ? Buffer.from(String(event.body || ""), "base64") : Buffer.from(String(event.body || ""));
    if (brut.length > CORPS_MAX) return rep(413, { error: "trop_long" });
    const corps = brut.toString("utf8");
    const secret = String((deps.secret !== undefined ? deps.secret : process.env.PUSH_ALERTE_ADMIN_SECRET) || "");
    if (secret.length < SECRET_MIN) return rep(503, { error: "configuration" });
    const h = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v ?? "")]));
    const ip = (h["x-nf-client-connection-ip"] || h["client-ip"] || h["x-forwarded-for"] || "?").split(",")[0].trim().slice(0, 64);
    const attenteIp = limite(`ip|${ip}`, 120, 60);
    if (attenteIp) return quota(attenteIp);
    const sig = verifierSignature({ corps, horodatage: h["x-elixir-horodatage"], signature: h["x-elixir-signature"], secret, maintenant: maintenant().getTime() });
    if (!sig.ok) return rep(401, { error: sig.raison });
    const attente = limite("global", 30, 3600);
    if (attente) return quota(attente);
    let b;
    try { b = JSON.parse(corps); } catch { return rep(400, { error: "json" }); }
    const texte = (v, max) => typeof v === "string" && v.trim().length > 0 && [...v].length <= max;
    if (!b || typeof b !== "object" || Array.isArray(b) || Object.keys(b).some((k) => !["titre", "corps", "tag"].includes(k))
      || !texte(b.corps, 240) || (b.titre !== undefined && !texte(b.titre, 80))
      || (b.tag !== undefined && (typeof b.tag !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(b.tag))))
      return rep(400, { error: "requete" });
    if (estApercu(event)) return rep(200, { apercu: true });
    try {
      const conf = deps.config ? deps.config() : configPush();
      if (!conf.ok || !conf.cles) return rep(503, { error: "configuration" });
      const stock = deps.stock || (stockDefaut ||= creerStockPush());
      // Filtrage en base ; garde supplémentaire pour ne jamais servir une pharmacie.
      const lignes = (await stock.abonnements.admins()).filter((l) => l.role === "admin");
      if (!lignes.length) return rep(200, { ok: true, envoyes: 0, aucun: true });
      const notification = charge({ titre: b.titre ?? "Elixir Admin : alerte", corps: b.corps, tag: b.tag, url: "/admin" }, maintenant().getTime(), { admin: true });
      const { envoyes, echecs, retires } = await envoyerAAppareils(lignes, notification,
        { cles: conf.cles, urgence: "high", ttl: 6 * 3600, sujet: b.tag },
        // Les erreurs internes peuvent contenir des données du stock : journal à champs fixes seulement.
        { stock, transport: deps.transport, hotesEssai: deps.hotesEssai, maintenant, journal: () => {} });
      return rep(200, { ok: true, envoyes, echecs, retires });
    } catch (e) {
      return rep(503, { error: e?.code === "configuration" ? "configuration" : "indisponible" });
    }
  };
}

export const handler = creerHandler();
