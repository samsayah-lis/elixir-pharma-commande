// ── Commandes groupées : e-mails (Resend, expéditeur pharmacien@elixirpharma.fr) ──
import { IMMEDIATE_SLOT } from "../../src/gp-pricing.js";

const FROM = process.env.GP_MAIL_FROM || "Elixir Pharma <pharmacien@elixirpharma.fr>";
export const ADMIN_MAIL = process.env.GP_ADMIN_MAIL || "pharmacien@elixirpharma.fr";

export async function sendMail({ to, subject, html, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "RESEND_API_KEY absent des variables Netlify" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: Array.isArray(to) ? to : [to], subject, html, reply_to: replyTo || ADMIN_MAIL }),
    });
    const body = await res.json().catch(() => ({}));
    return res.ok ? { sent: true, id: body.id } : { sent: false, reason: body.message || `HTTP ${res.status}` };
  } catch (e) {
    // une panne d'envoi ne doit pas faire échouer l'enregistrement de la commande
    return { sent: false, reason: `envoi impossible (${e.message})` };
  }
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const dfr = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";

// E-mail de confirmation de (pré)commande envoyé à la pharmacie
export function confirmationEmail({ op, summary, bySlot, freeBySlot = {}, stockByLine }) {
  const hasSlots = (op.delivery_slots || []).length > 0;
  const slots = [{ id: IMMEDIATE_SLOT, label: hasSlots ? "Livraison immédiate (en stock)" : "Quantité" },
    ...(op.delivery_slots || []).map(s => ({ id: s.id, label: `${s.label ? s.label + " — " : ""}${dfr(s.date)}` }))];
  const usedSlots = slots.filter(s => summary.rows.some(r => (bySlot[r.line.id]?.[s.id] || 0) > 0));
  const hasPre = summary.rows.some(r => !stockByLine[r.line.id] || usedSlots.some(s => s.id !== IMMEDIATE_SLOT && (bySlot[r.line.id]?.[s.id] || 0) > 0));
  const kind = hasPre ? "précommande" : "commande";
  const th = "text-align:left;padding:6px 8px;border-bottom:2px solid #cfd8dc;font-size:12px;color:#455a64";
  const td = "padding:6px 8px;border-bottom:1px solid #eceff1;font-size:13px";
  const rows = summary.rows.map(r => `<tr>
      <td style="${td}">${esc(r.line.name)}<br><span style="color:#78909c;font-size:11px">CIP ${esc(r.line.cip)}</span></td>
      ${usedSlots.map(s => { const q = bySlot[r.line.id]?.[s.id] || 0, f = freeBySlot[r.line.id]?.[s.id] || 0; return `<td style="${td};text-align:right">${q ? q : ""}${f ? `<br><span style="color:#15803d;font-size:11px">+${f} UG</span>` : ""}</td>`; }).join("")}
      <td style="${td};text-align:right">${eur(r.gross)}</td>
      <td style="${td};text-align:right">${eur(r.unitNet)}</td>
      <td style="${td};text-align:right"><b>${eur(r.totalNet)}</b></td></tr>`).join("");
  const t = summary.totals;
  const line = (label, v, strong) => `<tr><td style="padding:3px 8px">${label}</td><td style="padding:3px 8px;text-align:right">${strong ? "<b>" : ""}${v}${strong ? "</b>" : ""}</td></tr>`;
  const collectif = op.tier_mode !== "individuel";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1c2b33;max-width:720px">
  <p>Bonjour,</p>
  <p>Nous confirmons la réception de votre <b>${kind}</b> pour l'opération <b>${esc(op.name)}</b>${op.supplier_name ? ` (${esc(op.supplier_name)})` : ""}.</p>
  <table style="border-collapse:collapse;width:100%;margin:12px 0">
    <thead><tr><th style="${th}">Produit</th>${usedSlots.map(s => `<th style="${th};text-align:right">${esc(s.label)}</th>`).join("")}
      <th style="${th};text-align:right">Prix brut HT</th><th style="${th};text-align:right">Prix net HT</th><th style="${th};text-align:right">Total net HT</th></tr></thead>
    <tbody>${rows}</tbody></table>
  <table style="border-collapse:collapse;margin-left:auto;font-size:13px">
    ${line("Montant brut HT", eur(t.gross))}
    ${t.invoiceDiscount > 0.004 ? line("Remises sur facture", "− " + eur(t.invoiceDiscount)) : ""}
    ${t.rfaValue > 0.004 ? line("Remise de fin d'année (avancée sur facture)", "− " + eur(t.rfaValue)) : ""}
    ${t.coop > 0.004 ? line("Coopération commerciale", "− " + eur(t.coop)) : ""}
    ${line(`Frais de traitement (${String(t.feePct).replace(".", ",")} %)`, "+ " + eur(t.fee))}
    ${line("Total HT", eur(t.totalHT), true)}
  </table>
  ${t.freeUnits ? `<p style="font-size:13px">Unités : ${t.units} facturées <b>+ ${t.freeUnits} gratuites</b> = ${t.receivedUnits} reçues (valeur des gratuites : ${eur(t.ugValue)}).${collectif ? " Vous gardez au moins vos propres gratuités ; la part des gratuités gagnées en plus par le groupe peut évoluer jusqu'à la clôture." : ""}</p>` : ""}
  ${collectif ? `<p style="font-size:12px;color:#546e7a">Les paliers de remise s'appliquent au total du groupe : les prix indiqués correspondent au palier atteint à ce jour et peuvent encore s'améliorer d'ici la clôture${op.end_date ? ` du ${dfr(op.end_date)}` : ""}.</p>` : ""}
  ${hasPre ? `<p style="font-size:12px;color:#546e7a">Les produits en précommande vous seront livrés aux dates indiquées, après réception du stock chez Elixir Pharma.</p>` : ""}
  <p>Vous pouvez modifier votre ${kind} jusqu'à la clôture de l'opération depuis votre espace de commande Elixir.</p>
  <p>L'équipe Elixir Pharma</p></div>`;
  const subject = `Confirmation de votre ${kind} — ${op.name}`;
  return { subject, html, kind };
}

// E-mail d'annulation : la pharmacie a retiré toutes ses quantités
export function cancellationEmail({ op }) {
  return { subject: `Annulation de votre commande — ${op.name}`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#1c2b33;max-width:720px">
  <p>Bonjour,</p>
  <p>Votre commande pour l'opération <b>${esc(op.name)}</b>${op.supplier_name ? ` (${esc(op.supplier_name)})` : ""} est annulée : vous avez retiré toutes vos quantités.</p>
  <p>Vous pouvez de nouveau commander jusqu'à la clôture${op.end_date ? ` du ${dfr(op.end_date)}` : ""} depuis votre espace de commande Elixir.</p>
  <p>L'équipe Elixir Pharma</p></div>` };
}
