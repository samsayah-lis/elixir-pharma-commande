// ── Commandes groupées : rappels quotidiens à Elixir (fonction planifiée) ─
// - clôture proche (J-2 et jour J) avec les pharmacies qui n'ont pas encore commandé
// - opération arrivée à échéance : clôturer puis créer le bon de commande au labo
// - livraison prévue dans les 2 jours dont des devis restent à créer
import { sb, sbAll, today } from "./_gp.js";
import { sendMail, ADMIN_MAIL } from "./_gp-mail.js";
import { kvExists, kvSet, kvDeleteOlder } from "./_kv.js";

const SITE = "https://elixir-commande.expepharma.com/#admin";
const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
const dfr = (d) => new Date(d + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function once(key, fn) {
  if (await kvExists(key)) return false;
  const r = await fn();
  if (r?.sent) await kvSet(key, { at: new Date().toISOString() });
  return !!r?.sent;
}

export const handler = async () => {
  const t = today();
  const ops = await sbAll("gp_operations?status=in.(ouverte,cloturee,commandee)");
  const items = [];
  for (const op of ops) {
    const [parts, orders] = await Promise.all([
      sbAll(`gp_participants?operation_id=eq.${op.id}&select=pharmacy_id,pharmacy_name`),
      sbAll(`gp_orders?operation_id=eq.${op.id}&status=eq.confirmee&select=pharmacy_id`),
    ]);
    const partIds = new Set(parts.map(p => p.pharmacy_id));
    const ok = new Set(orders.map(o => o.pharmacy_id).filter(id => partIds.has(id)));
    if (op.status === "ouverte" && op.end_date && (op.end_date === t || op.end_date === addDays(t, 2))) {
      const missing = parts.filter(p => !ok.has(p.pharmacy_id)).map(p => esc(p.pharmacy_name || p.pharmacy_id));
      items.push({ key: `gp_reminder:${op.id}:cloture:${t}`, subject: `Clôture ${op.end_date === t ? "aujourd'hui" : "dans 2 jours"} — ${op.name}`,
        html: `<p>L'opération <b>${esc(op.name)}</b> se clôture ${op.end_date === t ? "<b>aujourd'hui</b>" : `le ${dfr(op.end_date)}`}.</p>
          <p>${ok.size} commande(s) confirmée(s) sur ${parts.length} pharmacie(s) participante(s).</p>
          ${missing.length ? `<p>Pas encore commandé : ${missing.join(", ")}.</p>` : ""}` });
    }
    if (op.status === "ouverte" && op.end_date && op.end_date < t) {
      items.push({ key: `gp_reminder:${op.id}:echeance`, subject: `À clôturer — ${op.name}`,
        html: `<p>L'opération <b>${esc(op.name)}</b> est arrivée à échéance le ${dfr(op.end_date)}. Clôturez-la puis créez le bon de commande au laboratoire.</p>` });
    }
    if (["cloturee", "commandee"].includes(op.status)) {
      const [qty, trig] = await Promise.all([
        sbAll(`gp_order_lines?operation_id=eq.${op.id}&qty=gt.0&select=pharmacy_id,slot_id`),
        sbAll(`gp_triggers?operation_id=eq.${op.id}&odoo_sale_order_id=not.is.null&select=pharmacy_id,slot_id`),
      ]);
      const done = new Set(trig.map(x => `${x.slot_id}|${x.pharmacy_id}`));
      for (const s of op.delivery_slots || []) {
        if (!s.date || s.date > addDays(t, 2)) continue;
        const need = new Set(qty.filter(r => r.slot_id === s.id && ok.has(r.pharmacy_id)).map(r => r.pharmacy_id));
        const left = [...need].filter(id => !done.has(`${s.id}|${id}`)).length;
        if (!left) continue;
        items.push({ key: `gp_reminder:${op.id}:slot:${s.id}:${t}`, subject: `Livraison à déclencher — ${op.name} (${s.label || dfr(s.date)})`,
          html: `<p>La livraison <b>${esc(s.label || "")}</b> du ${dfr(s.date)} de l'opération <b>${esc(op.name)}</b> : ${left} devis pharmacie(s) restent à créer.</p>
            <p>Une fois le stock reçu, ouvrez l'opération dans l'admin et cliquez sur « Créer les commandes » pour cette date.</p>` });
      }
    }
  }
  // Ménage : suivis d'analyse IA de plus de 30 jours, fichiers d'analyse oubliés depuis plus d'un jour
  const d30 = new Date(Date.now() - 30 * 86400e3).toISOString(), d1 = new Date(Date.now() - 86400e3).toISOString();
  for (const [prefix, before] of [["gp_import:", d30], ["gp_quota:", d30], ["gp_trigger:", d30], ["gp_file:", d1]])
    await kvDeleteOlder(prefix, before).catch(e => console.error("gp-reminders", e));
  let sent = 0;
  for (const it of items) {
    if (await once(it.key, () => sendMail({ to: ADMIN_MAIL, subject: `[Commandes groupées] ${it.subject}`, html: `${it.html}<p><a href="${SITE}">Ouvrir l'admin</a></p>` }))) sent++;
  }
  return { statusCode: 200, body: JSON.stringify({ reminders: items.length, sent }) };
};
