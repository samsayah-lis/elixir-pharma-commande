import { verifyAdmin } from "./auth.js";
import { getCors } from "./cors.js";
import { refusActionSection } from "../../src/components/sections-produits.js";
// Crée ou met à jour un produit dans Supabase avec historique
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "POST only" }) };

  const auth = await verifyAdmin(event);
  if (auth.error) return auth.error;

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON invalide" }) }; }

  const { product, action, author } = body;
  if (!product?.cip) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "cip manquant" }) };

  // Ajout / retrait de produits d'une section (admin, onglet ✏️ Modifier, actions section_* : docs/sections-admin.md) :
  // garde-fous de l'admin vérifiés ici aussi (page restée ouverte, campagne activée depuis) — sections exclues (menus promo,
  // campagnes actives, outils), un CIP = une section, colis de la Sélection Stratège. Les autres actions sont inchangées.
  if (typeof action === "string" && action.startsWith("section_")) {
    const H = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };
    const [rp, rc] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/elixir_products?cip=eq.${encodeURIComponent(product.cip)}&select=section,active`, { headers: H }),
      fetch(`${SUPABASE_URL}/rest/v1/elixir_campaigns?active=eq.true&select=id`, { headers: H }),
    ]);
    if (!rp.ok || !rc.ok) return { statusCode: 503, headers: cors, body: JSON.stringify({ error: "Produit ou campagnes illisibles : rien n'a été modifié, réessayez" }) };
    const [lp, lc] = [await rp.json().catch(() => null), await rc.json().catch(() => null)];
    if (!Array.isArray(lp) || !Array.isArray(lc)) return { statusCode: 503, headers: cors, body: JSON.stringify({ error: "Produit ou campagnes illisibles : rien n'a été modifié, réessayez" }) };
    const actuelle = lp[0] || null;
    const campagnes = lc.map(c => String(c?.id));
    const refus = refusActionSection({ action, product, actuelle, campagnes });
    if (refus) return { statusCode: refus.statut, headers: cors, body: JSON.stringify({ error: refus.error }) };
  }

  const now = new Date().toISOString();
  const oldCip = product.old_cip; // si changement de CIP
  const lookupCip = oldCip || product.cip;

  // Récupère l'historique existant si c'est une mise à jour
  let history = [];
  if (action !== "create") {
    const existing = await fetch(
      `${SUPABASE_URL}/rest/v1/elixir_products?cip=eq.${encodeURIComponent(lookupCip)}&select=history`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await existing.json();
    if (rows?.[0]?.history) {
      try { history = JSON.parse(rows[0].history); } catch {}
    }
  }

  const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
  const cipChange = !!oldCip && oldCip !== product.cip;
  // Changement de CIP : la ligne est renommée sur place (PATCH), jamais supprimée puis recréée — la photo
  // (image_url) et les colonnes non envoyées sont conservées ; refusé si le nouveau CIP existe déjà
  // (sinon l'upsert écrasait l'autre produit).
  if (cipChange) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/elixir_products?cip=eq.${encodeURIComponent(product.cip)}&select=cip,name,active`, { headers: SB });
    if (!r.ok) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: await r.text() }) };
    const deja = (await r.json())?.[0];
    if (deja) return { statusCode: 409, headers: cors, body: JSON.stringify({ error: `Le CIP ${product.cip} est déjà utilisé par « ${deja.name} »${deja.active === false ? " (produit désactivé)" : ""}` }) };
    history.push({ action: "cip_changed", date: now, author: author || "admin", changes: { old_cip: oldCip, new_cip: product.cip } });
  }

  // Ajoute l'entrée d'historique
  history.push({
    action: action || "update",
    date: now,
    author: author || "admin",
    changes: product._changes || null,
  });

  // Création : toutes les colonnes (absentes = vides). Mise à jour : seules les colonnes ENVOYÉES sont écrites
  // (avant, chaque modification remettait à vide « Prix carton », palier, etc. quand l'admin ne les envoyait pas).
  const CHAMPS = ["name", "section", "pv", "pct", "pn", "remise_eur", "colis", "carton", "note", "active", "source"];
  const row = { cip: product.cip };
  for (const k of CHAMPS) {
    if (action === "create") row[k] = product[k] ?? (k === "active" ? true : k === "source" ? "admin" : null);
    else if (product[k] !== undefined) row[k] = product[k];
  }
  // Laboratoire (Centrale OTC : fabricant Medipim ou saisie de l'admin, docs/labo-otc.md) : colonne labo, à créer par
  // ALTER TABLE public.elixir_products ADD COLUMN IF NOT EXISTS labo TEXT; écrite SEULEMENT quand elle est envoyée
  // (création comprise) : une modification sans laboratoire ne touche jamais la colonne, présente ou non.
  if (product.labo !== undefined) {
    const l = typeof product.labo === "string" ? product.labo.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    row.labo = l || null;
  }
  row.history = JSON.stringify(history);
  row.updated_at = now;
  if (action === "create") row.created_at = now;

  // Mise à jour = PATCH de la ligne existante (un upsert partiel échoue : la ligne proposée à l'insertion
  // doit déjà respecter les NOT NULL, nom compris). Ligne absente → insertion, si le nom est fourni.
  const erreur = async (r) => {
    const err = await r.text();
    console.error("[products-upsert] Supabase error:", err);
    // colonne labo pas encore créée (PostgREST : PGRST204 « Could not find the 'labo' column… » ; Postgres : 42703)
    if ("labo" in row && /labo/i.test(err) && /PGRST204|42703|schema cache|does not exist/i.test(err)) {
      return { statusCode: 409, headers: cors, body: JSON.stringify({ code: "labo_colonne_absente",
        error: "Laboratoire non enregistré : la colonne « labo » n'existe pas encore dans Supabase (table elixir_products). "
          + "À exécuter une fois dans l'éditeur SQL : ALTER TABLE public.elixir_products ADD COLUMN IF NOT EXISTS labo TEXT; — rien n'a été modifié." }) };
    }
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err }) };
  };
  if (action !== "create") {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_products?cip=eq.${encodeURIComponent(lookupCip)}`, {
      method: "PATCH", headers: { ...SB, "Prefer": "return=representation" }, body: JSON.stringify(row),
    });
    if (!res.ok) return erreur(res);
    const maj = await res.json().catch(() => []);
    if (Array.isArray(maj) && maj.length) return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
    if (cipChange || !row.name) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: `produit ${lookupCip} introuvable` }) };
    row.created_at = now;
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_products`, {
    method: "POST", headers: { ...SB, "Prefer": "resolution=merge-duplicates" }, body: JSON.stringify(row),
  });
  if (!res.ok) return erreur(res);

  return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
};
