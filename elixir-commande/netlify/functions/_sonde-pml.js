// État indépendant du relais : une panne du portail ne doit pas bloquer sa file.
import { kvGet, kvSet, kvDel } from "./_lab-justif.js";
import { alerter } from "./_relais.js";
import { masquer, parisTexte } from "./_portail-pml.js";

const vide = () => ({ echecs: 0, premierEchecA: null, dernierEchecA: null, dernierMotif: null, alerteEnvoyee: false, dernierSuccesA: null });
const avertir = (action, e) => console.warn(`pml-sonde : ${action} : ${masquer(e.message || e).slice(0, 500)}`);

export async function sonder({ delaiMs = 10000 } = {}) {
  if (process.env.PML_SONDE === "off") return { desactivee: true };
  const url = (process.env.PML_PORTAIL_URL || "https://pml.elixirpharma.fr").replace(/\/+$/, "");
  const controleur = new AbortController(), minuterie = setTimeout(() => controleur.abort(), delaiMs);
  let ok = false, motif, alerte = null;
  try {
    const r = await fetch(`${url}/sante?detail`, { method: "GET", headers: { "Cache-Control": "no-cache" }, signal: controleur.signal });
    let corps;
    try { corps = await r.json(); }
    catch (e) { if (controleur.signal.aborted) throw e; motif = "réponse illisible"; }
    if (!motif) {
      ok = r.status === 200 && corps?.ok === true;
      if (!ok) {
        const controles = Object.entries(corps?.controles || {}).filter(([, v]) => v === false).map(([k]) => k);
        motif = `HTTP ${r.status}${controles.length ? ` — contrôles en échec : ${controles.join(", ")}` : r.status === 200 ? " — santé non confirmée" : ""}`;
      }
    }
  } catch (e) {
    motif = controleur.signal.aborted ? `délai dépassé (${delaiMs / 1000} s)` : `réseau : ${e.message || e}`;
  } finally { clearTimeout(minuterie); }
  if (motif) motif = masquer(motif).slice(0, 500);
  const maintenant = new Date().toISOString();
  let etat = { ...vide(), ...await kvGet("pmlr:sonde").catch(() => null) };
  if (!ok) {
    etat = { ...etat, echecs: etat.echecs + 1, premierEchecA: etat.premierEchecA || maintenant, dernierEchecA: maintenant, dernierMotif: motif };
    if (etat.echecs >= 2) {
      const texte = masquer(`Portail : ${url}. Premier échec : ${parisTexte(etat.premierEchecA)} (heure de Paris). ${etat.echecs} échecs de suite. Dernier motif : ${motif}. Les pharmacies ne peuvent plus envoyer de commandes au portail ; les commandes du site attendent dans la file du relais`);
      try {
        const envoyee = await alerter("sonde", "Portail PharmaML injoignable", texte, 1);
        alerte = envoyee ? "envoyee" : "retenue";
        if (envoyee) etat.alerteEnvoyee = true;
      } catch (e) { avertir("alerte impossible", e); etat.alerteEnvoyee = false; }
    }
  } else {
    if (etat.alerteEnvoyee) {
      const minutes = Math.max(0, Math.round((Date.parse(maintenant) - Date.parse(etat.premierEchecA)) / 60000));
      const texte = masquer(`Portail : ${url}. Rétabli le ${parisTexte(maintenant)} (heure de Paris). Durée de la panne : ${minutes} minutes.`);
      try {
        if (await alerter("sonde:retabli", "Portail PharmaML rétabli", texte, 0)) {
          alerte = "retabli"; etat.alerteEnvoyee = false;
          // La limite horaire concerne une même panne, pas une nouvelle panne après rétablissement.
          await kvDel("pmlr:alerte:sonde").catch(e => avertir("limite horaire non supprimée", e));
        }
        else alerte = "retenue";
      } catch (e) { avertir("rétablissement impossible", e); }
    }
    // Garder le début de panne tant que le rétablissement n'a pas pu être annoncé.
    etat = etat.alerteEnvoyee ? { ...etat, echecs: 0, dernierSuccesA: maintenant } : { ...vide(), dernierSuccesA: maintenant };
  }
  await kvSet("pmlr:sonde", etat).catch(e => avertir("état non enregistré", e));
  return { ok, ...(motif ? { motif } : {}), echecs: etat.echecs, alerte };
}
