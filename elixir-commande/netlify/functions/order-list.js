// Liste les commandes depuis Supabase — FIX SEC-05 : filtrage par pharmacie ; lot 0 (16/10/2026) : jeton obligatoire
// GET /order-list                         → admin : toutes ; pharmacie : les siennes (CIP du jeton)
// GET /order-list?source=ulabs            → filtre par source campagne (pharmacie : parmi les siennes seulement)
// GET /order-list?pharmacy_cip=XXX        → admin en saisie pour une pharmacie : ses commandes ; ignoré pour une pharmacie
// GET /order-list?source=ulabs&agrege=1   → barre de progression d'une campagne (tout jeton valide) : { cips } seulement,
//                                           les CIP distincts des commandes validées de la campagne, toutes pharmacies,
//                                           sans id, pharmacie, e-mail, quantité ni csv
// Sans jeton valide → 401 { error: "reconnexion" } ; jeton pharmacie sans CIP → 403 { error: "fiche" }.
// L'ancien accès sans jeton (?pharmacy_cip=, ?source= : commandes de toutes les pharmacies) est fermé.
import { verifyTokenAsync } from "./auth.js";
import { frise, etatCommandeDemande } from "./_lab-justif.js";
import { resumeTache } from "./_relais.js";
import { validCip } from "./_pharmacies.js";
import { getCors } from "./cors.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

export const handler = async (event) => {
  const cors = getCors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const json = (code, body) => ({ statusCode: code, headers: { ...cors, "Cache-Control": "no-store" }, body: JSON.stringify(body) });

  // Identité = jeton vérifié côté serveur (admin, ou pharmacie dont le CIP vient de l'e-mail vérifié du jeton)
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const user = token ? await verifyTokenAsync(token) : null;
  if (!user) return json(401, { error: "reconnexion", message: "Session expirée : reconnectez-vous pour voir vos commandes." });
  const isAdmin = user.isAdmin === true;
  if (!isAdmin && !validCip(user.cip)) return json(403, { error: "fiche", message: "Aucune pharmacie n'est rattachée à ce compte." });

  const params = event.queryStringParameters || {};

  // Barre de progression d'une campagne (palier en références distinctes) : les références validées par TOUTES les
  // pharmacies comptent, mais rien d'autre ne sort (ni commande, ni pharmacie, ni quantité). Sources de campagne seulement.
  if (params.agrege) {
    const source = String(params.source || "");
    if (!/^[a-z0-9_-]{1,40}$/i.test(source) || ["catalogue", "justificatif"].includes(source)) return json(400, { error: "source" });
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_orders?source=eq.${encodeURIComponent(source)}&select=items&limit=5000`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
      if (!res.ok) return json(500, { error: "lecture" });
      const cips = new Set();
      for (const r of await res.json()) {
        let it = r.items;
        if (typeof it === "string") { try { it = JSON.parse(it); } catch { it = []; } }
        for (const i of Array.isArray(it) ? it : []) { const c = String(i?.cip ?? "").trim(); if (/^\d{7,13}$/.test(c)) cips.add(c); }
      }
      return json(200, { cips: [...cips] });
    } catch {
      return json(500, { error: "lecture" });
    }
  }

  // Construction de l'URL Supabase avec filtres
  let url = `${SUPABASE_URL}/rest/v1/elixir_orders?select=*&order=date.desc`;

  // Si un filtre source est demandé (ex: campagne ulabs) : il restreint, il n'élargit jamais
  if (params.source) {
    url += `&source=eq.${encodeURIComponent(params.source)}`;
  }

  // Pharmacie : le CIP du JETON, toujours (un pharmacy_cip de la requête est ignoré).
  // Admin : toutes les commandes, ou celles d'une pharmacie (saisie pour une pharmacie).
  if (!isAdmin) {
    url += `&pharmacy_cip=eq.${encodeURIComponent(String(user.cip).trim())}`;
  } else if (params.pharmacy_cip) {
    url += `&pharmacy_cip=eq.${encodeURIComponent(params.pharmacy_cip)}`;
  }

  try {
    const res = await fetch(url, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Range": "0-1999"
      }
    });

    if (!res.ok) {
      const err = await res.text();
      return json(500, { error: err });
    }

    const rows = await res.json();

    // Commandes « sur justificatif labo » : où en est la transmission au laboratoire (kv lj:req:s-<id>-<labo>)
    const justif = {};
    const jIds = rows.filter(r => r.source === "justificatif").map(r => r.id).filter(id => /^\d+$/.test(String(id)));
    const reqs = [];   // demandes lues, pour leur suivi (étape mise à jour par Elixir)
    for (let i = 0; i < jIds.length; i += 40) {
      try {
        const or = jIds.slice(i, i + 40).map(id => `key.like.lj:req:s-${id}-*`).join(",");
        const kr = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?or=(${encodeURIComponent(or)})&select=key,value`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
        for (const row of kr.ok ? await kr.json() : []) {
          let v = row.value; if (typeof v === "string") { try { v = JSON.parse(v); } catch { continue; } }
          if (!v?.orderId) continue;
          const j = { lab: v.lab, statut: v.statut, envoyeLe: v.envoyeLe || null, ...(isAdmin ? { poNom: v.poNom || null, motif: v.motif || v.erreur || null } : {}) };
          (justif[v.orderId] ||= []).push(j);
          reqs.push({ v, j });
        }
      } catch { /* suivi indisponible : la commande s'affiche quand même */ }
    }
    // suivi (kv lj:suivi:<id demande>) : étape courante, message d'Elixir, date prévue (appelant toujours authentifié)
    if (reqs.length) try {
      const keys = reqs.map(x => `"lj:suivi:${x.v.id}"`).join(",");
      const kr = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=in.(${encodeURIComponent(keys)})&select=key,value`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
      const suivis = new Map();
      for (const row of kr.ok ? await kr.json() : []) { let v = row.value; if (typeof v === "string") { try { v = JSON.parse(v); } catch { continue; } } suivis.set(row.key.slice(9), v); }
      const parId = new Map(rows.map(r => [String(r.id), r]));
      for (const { v, j } of reqs) {
        const f = frise(v, suivis.get(v.id), etatCommandeDemande(v, parId.get(String(v.orderId))));
        j.suivi = { etape: f.etape, libelle: f.libelle, date: f.date, commentaire: f.commentaire, datePrevue: f.datePrevue };
      }
    } catch { /* suivi indisponible */ }

    // Admin : envois par le relais PharmaML (agent du Mac) de chaque commande (état, référence, message)
    const relais = {};
    if (isAdmin) try {
      const kr = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=like.${encodeURIComponent("pmlr:tache:")}*&select=value&order=updated_at.desc&limit=1500`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
      for (const row of kr.ok ? await kr.json() : []) {
        let v = row.value; if (typeof v === "string") { try { v = JSON.parse(v); } catch { continue; } }
        if (v?.orderId) (relais[v.orderId] ||= []).push(resumeTache(v));
      }
      for (const k of Object.keys(relais)) relais[k].sort((a, b) => String(a.creeA).localeCompare(String(b.creeA)));
    } catch { /* état du relais indisponible : la liste s'affiche quand même */ }
    // envoi automatique écarté avec un avis à montrer (commande identique à une autre : possible doublon)
    const avis = {};
    if (isAdmin) try {
      const kr = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=like.${encodeURIComponent("pmlr:avis:")}*&select=key,value&order=updated_at.desc&limit=500`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
      for (const row of kr.ok ? await kr.json() : []) { let v = row.value; if (typeof v === "string") { try { v = JSON.parse(v); } catch { continue; } } avis[row.key.slice("pmlr:avis:".length)] = v; }
    } catch { /* sans avis */ }

    const orders = rows.map(r => ({
      id: r.id,
      date: r.date,
      pharmacyName: r.pharmacy_name,
      pharmacyEmail: r.pharmacy_email,
      pharmacyCip: r.pharmacy_cip,
      isClient: r.is_client,
      items: r.items,
      totalHt: r.total_ht,
      nbLignes: r.nb_lignes,
      csv: r.csv,
      processed: r.processed,
      source: r.source || "catalogue",
      enteredBy: r.entered_by || null,
      ...(justif[String(r.id)] ? { justif: justif[String(r.id)] } : {}),
      ...(relais[String(r.id)] ? { relais: relais[String(r.id)] } : {}),
      ...(avis[String(r.id)] ? { avisAuto: avis[String(r.id)] } : {}),
    }));

    return json(200, { orders });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
