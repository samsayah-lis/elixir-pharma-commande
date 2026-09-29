// ── Commandes groupées : rappels quotidiens à Elixir (fonction planifiée) ─
// - clôture proche (J-2 et jour J) avec les pharmacies qui n'ont pas encore commandé
// - opération arrivée à échéance : clôturer puis créer le bon de commande au labo
// - livraison prévue dans les 2 jours et pas encore déclenchée
import { sb, today } from "./_gp.js";
import { sendMail, ADMIN_MAIL } from "./_gp-mail.js";

const SITE = "https://elixir-commande.expepharma.com/#admin";
const addDays = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400e3).toISOString().slice(0, 10);
const dfr = (d) => new Date(d + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

async function once(key, fn) {
  const [row] = await sb(`kv_store?key=eq.${encodeURIComponent(key)}&select=key`);
  if (row) return false;
  const r = await fn();
  if (r?.sent) await sb("kv_store?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates", body: { key, value: { at: new Date().toISOString() } } });
  return true;
}

export const handler = async () => {
  const t = today();
  const ops = await sb("gp_operations?status=in.(ouverte,cloturee,commandee)");
  const items = [];
  for (const op of ops || []) {
    if (op.status === "ouverte" && op.end_date && (op.end_date === t || op.end_date === addDays(t, 2))) {
      const [parts, orders] = await Promise.all([
        sb(`gp_participants?operation_id=eq.${op.id}&select=pharmacy_cip,pharmacy_name`),
        sb(`gp_orders?operation_id=eq.${op.id}&status=eq.confirmee&select=pharmacy_cip`),
      ]);
      const ok = new Set((orders || []).map(o => o.pharmacy_cip));
      const missing = (parts || []).filter(p => !ok.has(p.pharmacy_cip)).map(p => p.pharmacy_name || p.pharmacy_cip);
      items.push({ key: `gp_reminder:${op.id}:cloture:${t}`, subject: `Clôture ${op.end_date === t ? "aujourd'hui" : "dans 2 jours"} — ${op.name}`,
        html: `<p>L'opération <b>${op.name}</b> se clôture ${op.end_date === t ? "<b>aujourd'hui</b>" : `le ${dfr(op.end_date)}`}.</p>
          <p>${ok.size} commande(s) confirmée(s) sur ${(parts || []).length} pharmacie(s) participante(s).</p>
          ${missing.length ? `<p>Pas encore commandé : ${missing.join(", ")}.</p>` : ""}` });
    }
    if (op.status === "ouverte" && op.end_date && op.end_date < t) {
      items.push({ key: `gp_reminder:${op.id}:echeance`, subject: `À clôturer — ${op.name}`,
        html: `<p>L'opération <b>${op.name}</b> est arrivée à échéance le ${dfr(op.end_date)}. Clôturez-la puis créez le bon de commande au laboratoire.</p>` });
    }
    if (["cloturee", "commandee"].includes(op.status)) {
      const trig = await sb(`gp_triggers?operation_id=eq.${op.id}&select=slot_id`);
      const done = new Set((trig || []).map(x => x.slot_id));
      for (const s of op.delivery_slots || []) {
        if (!s.date || done.has(s.id) || s.date > addDays(t, 2)) continue;
        items.push({ key: `gp_reminder:${op.id}:slot:${s.id}:${t}`, subject: `Livraison à déclencher — ${op.name} (${s.label || dfr(s.date)})`,
          html: `<p>La livraison <b>${s.label || ""}</b> du ${dfr(s.date)} de l'opération <b>${op.name}</b> n'est pas encore déclenchée.</p>
            <p>Une fois le stock reçu, ouvrez l'opération dans l'admin et cliquez sur « Créer les commandes » pour cette date.</p>` });
      }
    }
  }
  let sent = 0;
  for (const it of items) {
    await once(it.key, () => sendMail({ to: ADMIN_MAIL, subject: `[Commandes groupées] ${it.subject}`, html: `${it.html}<p><a href="${SITE}">Ouvrir l'admin</a></p>` })) && sent++;
  }
  return { statusCode: 200, body: JSON.stringify({ reminders: items.length, sent }) };
};
