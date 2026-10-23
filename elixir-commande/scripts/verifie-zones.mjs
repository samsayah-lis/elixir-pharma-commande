// ── Refonte charte : garde-fou des zones protégées (docs/refonte-charte.md, § 4) ──
// node scripts/verifie-zones.mjs [--ref master]   (ou : npm run zones)
// Compare, entre la référence (master par défaut) et l'arbre de travail, octet pour octet :
//  • les zones de logique protégées, retrouvées par leur contenu (noms de fonctions), jamais par numéro de ligne ;
//  • les fichiers intouchables (lab-justif-client, gp-pricing, product-groups, netlify/functions/**) ;
//  • les clés de stockage (appels localStorage / sessionStorage get/set/removeItem, liste triée).
// Sortie 0 : tout est identique ; 1 : au moins un écart ; 2 : erreur (zone introuvable dans la référence…).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const REF = args.includes("--ref") ? args[args.indexOf("--ref") + 1] : "master";

// ── Zones protégées ──
// de : première ligne de la zone ; puis (facultatif) : repère situé dans la zone, après « de » ;
// fin : "bloc" = fin du bloc ouvert par la ligne « puis » (ou « de ») — première ligne suivante à la même
// indentation qui commence par } ou ) — sinon expression de la dernière ligne (première trouvée après le repère).
const ZONES = [
  { fichier: "src/App.jsx", nom: "panier persistant et contingentement (cartKeys … quotaDay)",
    de: /^\/\/ Panier persisté :/, puis: /^const quotaDay = /, fin: "bloc" },
  { fichier: "src/App.jsx", nom: "quantités et ajout au panier (getStepMin, setQty, setItemQty, addItemToCart)",
    // repère : signature d'origine ou celle du lot E2 (option ouvrirPanier)
    de: /^  const getStepMin = \(catKey, p\) => \{$/, puis: /^  const addItemToCart = \(item(, \{ ouvrirPanier = true \} = \{\})?\) => \{$/, fin: "bloc" },
  { fichier: "src/App.jsx", nom: "panier calculé, contingentement, signature du catalogue, adresse ↔ menu",
    de: /^  const cartItems = useMemo\(\(\) => \{$/, puis: /^    window\.addEventListener\("popstate", onPop\);$/, fin: /^  \}, \[\]\);$/ },
  { fichier: "src/App.jsx", nom: "copie du bon de commande (handleCopy)",
    de: /^  const handleCopy = \(\) => \{$/, fin: "bloc" },
  { fichier: "src/App.jsx", nom: "identification de la pharmacie (handleEmailLookup … handleOnboarding)",
    de: /^  const handleEmailLookup = async \(\) => \{$/, puis: /^  const handleOnboarding = \(\) => \{$/, fin: "bloc" },
  { fichier: "src/App.jsx", nom: "envoi de la commande (expandSupplierGroups, handleSend, sendOrder)",
    de: /^  const expandSupplierGroups = async \(items\) => \{$/, puis: /^  const sendOrder = async \(\) => \{$/, fin: "bloc" },
  { fichier: "src/App.jsx", nom: "confirmation de la commande groupée U-Labs (calculs et confirmOrder)",
    de: /\{\/\* Bouton confirmation commande groupée U-Labs \*\/\}/, puis: /^\s*const confirmOrder = async \(\) => \{$/, fin: "bloc" },
  { fichier: "src/tiers.jsx", nom: "paliers de quantité (applyTiers)",
    de: /^import React from "react";$/, puis: /^export function applyTiers\(/, fin: "bloc" },
  // lot 10 (admin) : accès, publication de la configuration et connexion — interdits du plan (§ 3, lot 10)
  { fichier: "src/AdminPanel.jsx", nom: "admin : appels authentifiés et rafraîchissement du jeton (adminFetch)",
    de: /^  const adminFetch = useCallback\(async \(url, options = \{\}\) => \{$/, fin: "bloc" },
  { fichier: "src/AdminPanel.jsx", nom: "admin : publication de la configuration (publier … saveDisplayConfig)",
    de: /^  const publier = \(key, value, \{ forcer = false \} = \{\}\) => \{$/, puis: /^  const saveDisplayConfig = \(newConfig\) => \{$/, fin: "bloc" },
  { fichier: "src/AdminPanel.jsx", nom: "admin : version en ligne, publication choisie et connexion (chargerConfigServeur … handleLogin)",
    de: /^  const chargerConfigServeur = async \(\) => \{$/, puis: /^  const handleLogin = async \(\) => \{$/, fin: "bloc" },
];

// Fichiers et dossiers dont aucune ligne ne doit changer
const FICHIERS = ["src/lab-justif-client.js", "src/gp-pricing.js", "src/product-groups.js"];
const DOSSIERS = ["netlify/functions"];

// Écarts autorisés explicitement par un lot (docs/refonte-charte.md) : remplacement exact appliqué au texte
// de la référence avant comparaison ; tout autre écart reste signalé. Une entrée par changement validé :
// { zone: "<début du nom de la zone>", avant: "…", apres: "…", lot: "E2", motif: "…" }
// Écarts validés par rapport à master. Vide depuis la mise en ligne de la refonte (16/10/2026) : master contient
// désormais les lots 1, E2 et 8 ; y inscrire un nouvel écart volontaire, avec sa zone, son motif, son avant et son après.
// Écarts en cours : le second correctif de sécurité du 19/10/2026 et sa relecture finale, appliqués seulement si la
// référence ne contient pas encore ces correctifs (LOTS.securite : master local d'avant, pas origin/master) ; la mention
// « Pér. » de la Péremption courte (attente : "peremptionMention", LOTS.peremptionMention), tant que la référence ne
// contient pas ce lot ; la règle panier de la Péremption courte (21/10/2026, attente : "peremptionPanier",
// LOTS.peremptionPanier), appliquée après le lot 0. Un écart sans « attente » suit les correctifs de sécurité.
const ECARTS_AUTORISES = [
  // Correctif de sécurité du 19/10/2026 (order-save, quota-status et group-order exigent un jeton) : envoi de la commande
  // et contingentement passent par appelAuthentifie ; la session est vérifiée avant tout envoi. À retirer dès que master les contient.
  { zone: "panier calculé, contingentement, signature du catalogue, adresse ↔ menu", lot: "sécurité 19/10/2026", motif: "quota-status exige un jeton : appel par appelAuthentifie (jeton pharmacie, ou admin en saisie, renouvelé s'il a expiré)",
    avant: "      const t = actingFor ? localStorage.getItem(\"admin_token\") : localStorage.getItem(\"pharmacy_token\");\n      const r = await fetch(\"/.netlify/functions/quota-status\", { method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\", ...(t ? { Authorization: `Bearer ${t}` } : {}) },",
    apres: "      // jeton pharmacie (saisie Elixir : jeton admin), renouvelé s'il a expiré (quota-status exige un jeton)\n      const r = await appelAuthentifie(\"/.netlify/functions/quota-status\", { method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" }," },
  { zone: "panier calculé, contingentement, signature du catalogue, adresse ↔ menu", lot: "sécurité 19/10/2026", motif: "dépendance de loadQuota : appelAuthentifie",
    avant: "  }, [pharmacyEmail, pharmacyCip, actingFor]);",
    apres: "  }, [pharmacyEmail, pharmacyCip, actingFor, appelAuthentifie]);" },
  { zone: "envoi de la commande", lot: "sécurité 19/10/2026", motif: "session vérifiée AVANT tout envoi (sessionPourEnvoi : order-save { verifier }), pharmacie comprise ; sinon rien ne part et le panier reste intact",
    avant: "    // Saisie Elixir : la session admin doit être valide AVANT tout envoi (sinon commande sans mention ni trace admin)\n    if (actingFor) {\n      const ok = await fetch(\"/.netlify/functions/admin-pharmacy-find?q=\", { headers: { Authorization: `Bearer ${localStorage.getItem(\"admin_token\") || \"\"}` } })\n        .then(r => r.ok).catch(() => false);\n      if (!ok) { setSendStatus(null); flash(\"⚠ Session admin expirée : ouvrez l'admin (#admin) pour vous reconnecter, puis renvoyez la commande\"); return false; }\n    }",
    apres: "    // Session valide AVANT tout envoi (e-mail, enregistrement, PharmaML) : jeton pharmacie renouvelé si besoin, sinon\n    // reconnexion par code, panier intact ; saisie Elixir : session admin (sinon commande sans mention ni trace admin)\n    if (!(await sessionPourEnvoi())) { setSendStatus(null); return false; }" },
  { zone: "envoi de la commande", lot: "sécurité 19/10/2026", motif: "order-save exige un jeton : lignes « justificatif » enregistrées par appelAuthentifie",
    avant: "      const atok = actingFor ? localStorage.getItem(\"admin_token\") : null;\n      const saveOrder = (o) => fetch(\"/.netlify/functions/order-save\", {\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\", ...(atok ? { Authorization: `Bearer ${atok}` } : {}) },",
    apres: "      const saveOrder = (o) => appelAuthentifie(\"/.netlify/functions/order-save\", {   // jeton pharmacie, ou admin en saisie\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" }," },
  { zone: "envoi de la commande", lot: "sécurité 19/10/2026", motif: "order-save exige un jeton : commande normale enregistrée par appelAuthentifie",
    avant: "        const atok = actingFor ? localStorage.getItem(\"admin_token\") : null;\n        const saveRes = await fetch(\"/.netlify/functions/order-save\", {\n          method: \"POST\",\n          headers: { \"Content-Type\": \"application/json\", ...(atok ? { Authorization: `Bearer ${atok}` } : {}) },",
    apres: "        const saveRes = await appelAuthentifie(\"/.netlify/functions/order-save\", {   // jeton pharmacie, ou admin en saisie\n          method: \"POST\",\n          headers: { \"Content-Type\": \"application/json\" }," },
  { zone: "confirmation de la commande groupée U-Labs", lot: "sécurité 19/10/2026", motif: "order-save exige un jeton : commande U-Labs enregistrée par appelAuthentifie",
    avant: "                const atok = actingFor ? localStorage.getItem(\"admin_token\") : null;   // saisie Elixir pour une pharmacie\n                await fetch(\"/.netlify/functions/order-save\", {\n                  method: \"POST\", headers: { \"Content-Type\": \"application/json\", ...(atok ? { Authorization: `Bearer ${atok}` } : {}) },",
    apres: "                // jeton pharmacie, ou admin en saisie Elixir pour une pharmacie ; confirmée seulement si enregistrée\n                const res = await appelAuthentifie(\"/.netlify/functions/order-save\", {\n                  method: \"POST\", headers: { \"Content-Type\": \"application/json\" }," },
  { zone: "confirmation de la commande groupée U-Labs", lot: "sécurité 19/10/2026", motif: "« Commande confirmée » seulement si le serveur l'a enregistrée ; sinon message (session expirée, compte sans pharmacie, erreur) et reconnexion par code, quantités gardées",
    avant: "                setUlabsConfirmed(true);\n              } catch(e) { console.error(e); }",
    apres: "                if (res.ok) setUlabsConfirmed(true);\n                else {\n                  if (res.status === 401 && !actingFor) setEnvoiBloque(\"reconnexion\");\n                  setUlabsError(res.status === 401 ? `⚠️ Commande non enregistrée : session expirée\\n${actingFor ? MESSAGE_ENVOI_BLOQUE.admin : \"Reconnectez-vous avec le code reçu par e-mail, puis confirmez à nouveau : vos quantités sont conservées.\"}`\n                    : res.status === 403 ? `⚠️ Commande non enregistrée\\n${actingFor ? MESSAGE_ENVOI_BLOQUE.admin : MESSAGE_ENVOI_BLOQUE.fiche}`\n                    : \"⚠️ Commande non enregistrée\\nRéessayez dans un instant : vos quantités sont conservées.\");\n                }\n              } catch(e) { console.error(e); setUlabsError(\"⚠️ Commande non enregistrée\\nRéessayez dans un instant : vos quantités sont conservées.\"); }" },
  // relecture du second correctif : délais compatibles Safari < 16, e-mail de commande avec le jeton, reconnexion sans fenêtre promo
  { zone: "panier calculé, contingentement, signature du catalogue, adresse ↔ menu", lot: "sécurité 19/10/2026 (relecture)", motif: "délai sans AbortSignal.timeout (Safari < 16) : l'appel part sans délai au lieu d'échouer",
    avant: "}), signal: AbortSignal.timeout(12000) });",
    apres: "}), ...delai(12000) });" },
  { zone: "identification de la pharmacie", lot: "sécurité 19/10/2026 (relecture)", motif: "reconnexion demandée depuis la session : retour au panier sans la fenêtre « Offres du moment »",
    avant: "      setOnboardingDone(true);\n      if (promoSections.some(p => p.active) && !menuViaLien.current) setPromoPopupOpen(true);",
    apres: "      setOnboardingDone(true);\n      // reconnexion demandée depuis la session (envoi du panier…) : retour direct au panier, sans « Offres du moment »\n      if (!reconnexion && promoSections.some(p => p.active) && !menuViaLien.current) setPromoPopupOpen(true);" },
  { zone: "envoi de la commande", lot: "sécurité 19/10/2026 (relecture)", motif: "e-mail de commande envoyé avec le jeton (send-email : adresse vérifiée, destinataire fixé) ; session refusée → rien ne part, panier intact",
    avant: "    try {\n      await fetch(\"/.netlify/functions/send-email\", {\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" },\n        body: JSON.stringify({ template_params: templateParams }),\n      });\n      setSendStatus(\"success\");",
    apres: "    try {\n      // e-mail de commande avec le jeton (send-email : adresse de la pharmacie vérifiée ; sans jeton, « non vérifiée ») ;\n      // session refusée (expirée juste après le contrôle, non renouvelable) : rien n'est parti, panier intact\n      const mail = await appelAuthentifie(\"/.netlify/functions/send-email\", {\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" },\n        body: JSON.stringify({ template_params: templateParams }),\n      });\n      if (mail.status === 401) {\n        const motif = actingFor ? \"admin\" : \"reconnexion\";\n        setSendStatus(null); setEnvoiBloque(motif); flash(`⚠ ${MESSAGE_ENVOI_BLOQUE[motif]}`, 8000);\n        return false;\n      }\n      setSendStatus(\"success\");" },
  { zone: "envoi de la commande", lot: "sécurité 19/10/2026 (relecture)", motif: "délai sans AbortSignal.timeout (Safari < 16) : le relais PharmaML part sans délai au lieu de ne jamais partir",
    avant: "              signal: AbortSignal.timeout(20000),",
    apres: "              ...delai(20000)," },  // relecture finale du second correctif (19/10/2026) : la commande est enregistrée AVANT l'e-mail et le relais
  { zone: "envoi de la commande", lot: "sécurité 19/10/2026 (relecture finale)", motif: "numéro de commande stable d'un essai à l'autre tant qu'elle n'est pas enregistrée (réponse perdue : order-save reconnaît la commande, pas de doublon)",
    avant: "  const sendingRef = useRef(false);",
    apres: "  const sendingRef = useRef(false);\n  // numéro de chaque commande (clé : identité, source, lignes) tant qu'elle n'est pas enregistrée : un nouvel essai garde\n  // le même, order-save reconnaît alors une commande déjà enregistrée dont la réponse s'est perdue (pas de doublon)\n  const idsEnvoi = useRef({});" },
  { zone: "envoi de la commande", lot: "sécurité 19/10/2026 (relecture finale)", motif: "lignes de l'e-mail calculées pour les seules commandes enregistrées",
    avant: "    const lignes = sendItems.map(i =>",
    apres: "    const lignesMail = (arr) => arr.map(i =>" },
  { zone: "envoi de la commande", lot: "sécurité 19/10/2026 (relecture finale)", motif: "enregistrement AVANT l'e-mail et le relais : un enregistrement refusé (session expirée, Supabase en panne, erreur) ne laisse plus partir l'e-mail ni afficher « Commande envoyée » ni vider le panier ; e-mail en échec après l'enregistrement : commande gardée et relayée ; relais et demande labo après l'enregistrement seulement",
    avant: "    const templateParams = {\n      to_email:      DEFAULT_RECIPIENT,\n      pharmacy_name: actingFor ? `${pharmacyName} — saisie par Elixir` : pharmacyName,\n      pharmacy_email: pharmacyEmail || \"—\",\n      is_client:     isClient ? \"Oui\" : \"Non (nouveau client – RIB joint)\",\n      order_date:    date,\n      order_lines:   lignes,\n      total_ht:      cartTotal.toFixed(2).replace(\".\", \",\") + \" €\",\n      nb_lignes:     sendItems.length,\n      nb_unites:     cartCount,\n    };\n\n    try {\n      // e-mail de commande avec le jeton (send-email : adresse de la pharmacie vérifiée ; sans jeton, « non vérifiée ») ;\n      // session refusée (expirée juste après le contrôle, non renouvelable) : rien n'est parti, panier intact\n      const mail = await appelAuthentifie(\"/.netlify/functions/send-email\", {\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" },\n        body: JSON.stringify({ template_params: templateParams }),\n      });\n      if (mail.status === 401) {\n        const motif = actingFor ? \"admin\" : \"reconnexion\";\n        setSendStatus(null); setEnvoiBloque(motif); flash(`⚠ ${MESSAGE_ENVOI_BLOQUE[motif]}`, 8000);\n        return false;\n      }\n      setSendStatus(\"success\");\n      // Save order to Supabase via Netlify Function\n      // Lignes « sur justificatif labo » : commande à part (source « justificatif »), jamais transmise\n      // automatiquement à PharmaML (Elixir commande au labo, puis synchronise à réception)\n      const normalItems = sendItems.filter(i => !isJustif(i));\n      const justifLines = sendItems.filter(isJustif);\n      const toItems = (arr) => arr.map(i => ({ cip: i.cip || null, name: i.name, qty: i.qty, pn: i.pn, total: i.total, ...(i.group ? { group: i.group } : {}) }));\n      const csvOf = (arr) => arr.map(i => `${String(i.cip || cipLookup[i.name?.trim().toLowerCase()] || \"—\").replace(/;/g, \"\")};${i.qty}`).join(\"\\n\");\n      const saveOrder = (o) => appelAuthentifie(\"/.netlify/functions/order-save\", {   // jeton pharmacie, ou admin en saisie\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" },\n        body: JSON.stringify(actingFor ? { ...o, enteredByAdmin: true } : o),\n      }).then(r => r.json()).catch(e => ({ success: false, error: e.message }));\n      const baseId = Date.now();\n      if (normalItems.length) try {\n        const order = {\n          id: baseId,\n          date: new Date().toISOString(),\n          pharmacyName,\n          pharmacyEmail,\n          pharmacyCip: (pharmacyCip && pharmacyCip !== \"0\") ? pharmacyCip : null,\n          isClient,\n          items: toItems(normalItems),\n          totalHt: justifLines.length ? normalItems.reduce((t, i) => t + (i.total || 0), 0) : cartTotal,\n          nbLignes: normalItems.length,\n          csv: justifLines.length ? csvOf(normalItems) : csvContent,\n          processed: false,\n          source: \"catalogue\",\n        };\n\n        // Sauvegarde dans Supabase (await pour détecter les erreurs)\n        const saveRes = await appelAuthentifie(\"/.netlify/functions/order-save\", {   // jeton pharmacie, ou admin en saisie\n          method: \"POST\",\n          headers: { \"Content-Type\": \"application/json\" },\n          body: JSON.stringify(actingFor ? { ...order, enteredByAdmin: true } : order),\n        });\n        const saveJson = await saveRes.json();\n        if (saveJson.success) console.log(\"[order-save] ✓ Commande sauvegardée dans Supabase\");\n        else console.warn(\"[order-save] ✗\", saveJson.error);\n\n        // ── Envoi automatique vers PharmaML (relais) ──\n        // Le serveur relit la commande enregistrée, vérifie la pharmacie (jeton) et met les lignes EN STOCK dans\n        // la file du relais, que l'agent du Mac du bureau envoie à PharmaML ; le reste attend la synchro manuelle.\n        (async () => {\n          if (!saveJson.success) return;                                     // pas en base : rien ne part\n          if (actingFor && !(pharmacyCip && pharmacyCip !== \"0\")) return;   // saisie Elixir sans CIP : synchro manuelle depuis l'admin\n          try {\n            const ptok = actingFor ? localStorage.getItem(\"admin_token\") : await freshPharmacyToken();\n            const res = await fetch(\"/.netlify/functions/submit-order\", {\n              method: \"POST\",\n              headers: ptok ? { \"Content-Type\": \"application/json\", \"Authorization\": `Bearer ${ptok}` } : { \"Content-Type\": \"application/json\" },\n              body: JSON.stringify({ orderId: order.id, pharmacyName, via: \"auto\" }),\n              ...delai(20000),\n            });\n            const json = await res.json().catch(() => ({}));\n            if (json.queued) console.log(`[PharmaML] ✓ ${json.lignes} ligne(s) en file d'envoi (réf. ${json.reference})${json.retenues ? `, ${json.retenues} à synchroniser par Elixir` : \"\"}`);\n            else console.log(\"[PharmaML] synchro par Elixir :\", json.error || res.status);\n          } catch (err) { console.warn(\"[PharmaML] envoi automatique non demandé :\", err.message); }\n        })();\n\n      } catch(e) { console.error(\"Order save error\", e); }\n\n      // Commande « sur justificatif » APRÈS la commande normale (celle-ci part sans attendre le labo)\n      let keepJustif = null;   // lignes non enregistrées : laissées au panier pour être renvoyées\n      if (justifLines.length) {\n        const jOrder = {\n          id: normalItems.length ? baseId + 1 : baseId,\n          date: new Date().toISOString(),\n          pharmacyName, pharmacyEmail,\n          pharmacyCip: (pharmacyCip && pharmacyCip !== \"0\") ? pharmacyCip : null,\n          isClient,\n          // justificatif gardé dans la ligne : une reprise par l'admin le retrouve si la transmission échoue\n          items: justifLines.map(i => ({ ...toItems([i])[0], justif: { attestation: !!justifInfo[i.cip]?.attestation,\n            renouvellement: !!justifInfo[i.cip]?.renouvellement, rx: (justifInfo[i.cip]?.rx || []).map(x => x.id).filter(Boolean) } })),\n          totalHt: justifLines.reduce((t, i) => t + (i.total || 0), 0),\n          nbLignes: justifLines.length,\n          csv: csvOf(justifLines),\n          processed: false,\n          source: \"justificatif\",\n        };\n        const jSave = await saveOrder(jOrder);\n        if (!jSave.success) {\n          keepJustif = new Set(justifLines.map(i => i.cip));\n          flash(`⚠ Lignes sur justificatif labo NON enregistrées (${jSave.error || \"erreur\"}) : elles restent dans votre panier, renvoyez-les`);\n        } else {\n          try {\n            const auth = actingFor ? { token: localStorage.getItem(\"admin_token\"), odooId: actingFor.odoo_id } : { getToken: freshPharmacyToken };\n            await submitJustif(jSave.id || jOrder.id, justifLines.map(i => ({ cip: i.cip, attestation: !!justifInfo[i.cip]?.attestation,\n              renouvellement: !!justifInfo[i.cip]?.renouvellement, rx: (justifInfo[i.cip]?.rx || []).map(x => x.id).filter(Boolean) })), auth);\n          } catch (e) {\n            console.warn(\"[justificatif labo]\", e.message);\n            flash(`⚠ Commande enregistrée ; sa transmission au laboratoire sera faite par Elixir (${e.message})`);\n          }\n        }\n      }\n      setTimeout(() => {\n        setSendStatus(null);\n        if (keepJustif) {\n          // garder seulement les lignes « justificatif » non enregistrées (la commande normale est partie)\n          setQuantities(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => {\n            const i = k.lastIndexOf(\"-\"); const p = CATALOG_WITH_ADMIN[k.slice(0, i)]?.products?.[Number(k.slice(i + 1))];\n            return p && keepJustif.has(p.cip);\n          })));\n          setSpecialItems(prev => prev.filter(x => keepJustif.has(x.cip)));\n          setJustifInfo(prev => Object.fromEntries(Object.entries(prev).filter(([c]) => keepJustif.has(c))));\n        } else {\n          setQuantities({});\n          setSpecialItems([]);\n          setJustifInfo({});\n          setCartOpen(false);\n        }\n      }, 3000);\n      return true;\n    } catch (err) {\n      console.error(\"[send-email] error:\", err);\n      setSendStatus(\"error\");\n      setTimeout(() => setSendStatus(null), 5000);\n      return false;\n    }",
    apres: "    // E-mail de commande : lignes enregistrées seulement (lignes « justificatif » refusées : laissées au panier, hors e-mail)\n    const paramsMail = (arr, total, unites) => ({\n      to_email:      DEFAULT_RECIPIENT,\n      pharmacy_name: actingFor ? `${pharmacyName} — saisie par Elixir` : pharmacyName,\n      pharmacy_email: pharmacyEmail || \"—\",\n      is_client:     isClient ? \"Oui\" : \"Non (nouveau client – RIB joint)\",\n      order_date:    date,\n      order_lines:   lignesMail(arr),\n      total_ht:      total.toFixed(2).replace(\".\", \",\") + \" €\",\n      nb_lignes:     arr.length,\n      nb_unites:     unites,\n    });\n\n    // ── 1. Enregistrement AVANT l'e-mail et le relais (correctif de sécurité du 19/10/2026) ──\n    // Avant, un enregistrement refusé APRÈS l'e-mail (session expirée, panne) perdait la commande — ni admin, ni\n    // PharmaML — alors que le site affichait « Commande envoyée ». Désormais : enregistrement refusé → rien ne part,\n    // panier intact, motif affiché ; nouvel essai sans risque. Numéro de commande stable d'un essai à l'autre pour les\n    // mêmes lignes (idsEnvoi) : si un enregistrement réussi n'a pas reçu sa réponse, order-save reconnaît le nouvel\n    // essai ({ deja }) au lieu de créer un doublon. Lignes « sur justificatif labo » : commande à part (source\n    // « justificatif »), jamais transmise automatiquement à PharmaML (Elixir commande au labo, puis synchronise à réception).\n    const normalItems = sendItems.filter(i => !isJustif(i));\n    const justifLines = sendItems.filter(isJustif);\n    const toItems = (arr) => arr.map(i => ({ cip: i.cip || null, name: i.name, qty: i.qty, pn: i.pn, total: i.total, ...(i.group ? { group: i.group } : {}) }));\n    const csvOf = (arr) => arr.map(i => `${String(i.cip || cipLookup[i.name?.trim().toLowerCase()] || \"—\").replace(/;/g, \"\")};${i.qty}`).join(\"\\n\");\n    const enregistrer = async (o) => {   // → { ok: true, id } | { ok: false, status, error }\n      const cle = JSON.stringify([actingFor?.odoo_id ?? null, pharmacyEmail, o.source, o.items]);\n      idsEnvoi.current[cle] ??= o.id;\n      for (let essai = 0; essai < 2; essai++) {\n        const corps = { ...o, id: idsEnvoi.current[cle] };\n        let res = null, j = {};\n        try {\n          res = await appelAuthentifie(\"/.netlify/functions/order-save\", {   // jeton pharmacie, ou admin en saisie\n            method: \"POST\",\n            headers: { \"Content-Type\": \"application/json\" },\n            body: JSON.stringify(actingFor ? { ...corps, enteredByAdmin: true } : corps),\n            ...delai(20000),\n          });\n          j = await res.json().catch(() => ({}));\n        } catch { res = null; }\n        if (res?.ok && j.success) { delete idsEnvoi.current[cle]; return { ok: true, id: j.id || corps.id }; }\n        if (res?.status === 409 && j.error === \"numero\") { idsEnvoi.current[cle] = Date.now() + 2; continue; }   // numéro pris par une autre commande\n        console.warn(\"[order-save] ✗\", res?.status, j.error);\n        return { ok: false, status: res?.status || 0, error: j.message || j.error || \"serveur injoignable\" };\n      }\n      return { ok: false, status: 409, error: \"numéro de commande déjà pris\" };\n    };\n    // enregistrement refusé : rien n'est parti, le panier reste tel quel\n    const bloquer = (r) => {\n      setSendStatus(null);\n      if (r.status === 400) { flash(`⚠ Commande non enregistrée : ${r.error}. Rien n'est parti, votre panier est conservé.`, 8000); return false; }\n      const motif = r.status === 401 ? (actingFor ? \"admin\" : \"reconnexion\") : r.status === 403 ? (actingFor ? \"admin\" : \"fiche\") : \"erreur\";\n      setEnvoiBloque(motif); flash(`⚠ ${MESSAGE_ENVOI_BLOQUE[motif]}`, 8000);\n      return false;\n    };\n\n    const baseId = Date.now();\n    let order = null, saveNormal = null;\n    if (normalItems.length) {\n      order = {\n        id: baseId,\n        date: new Date().toISOString(),\n        pharmacyName,\n        pharmacyEmail,\n        pharmacyCip: (pharmacyCip && pharmacyCip !== \"0\") ? pharmacyCip : null,\n        isClient,\n        items: toItems(normalItems),\n        totalHt: justifLines.length ? normalItems.reduce((t, i) => t + (i.total || 0), 0) : cartTotal,\n        nbLignes: normalItems.length,\n        csv: justifLines.length ? csvOf(normalItems) : csvContent,\n        processed: false,\n        source: \"catalogue\",\n      };\n      saveNormal = await enregistrer(order);\n      if (!saveNormal.ok) return bloquer(saveNormal);\n      console.log(\"[order-save] ✓ Commande sauvegardée dans Supabase\");\n    }\n    // Commande « sur justificatif » APRÈS la commande normale (celle-ci part sans attendre le labo)\n    let jSave = null;\n    let keepJustif = null;   // lignes non enregistrées : laissées au panier pour être renvoyées\n    if (justifLines.length) {\n      const jOrder = {\n        id: normalItems.length ? baseId + 1 : baseId,\n        date: new Date().toISOString(),\n        pharmacyName, pharmacyEmail,\n        pharmacyCip: (pharmacyCip && pharmacyCip !== \"0\") ? pharmacyCip : null,\n        isClient,\n        // justificatif gardé dans la ligne : une reprise par l'admin le retrouve si la transmission échoue\n        items: justifLines.map(i => ({ ...toItems([i])[0], justif: { attestation: !!justifInfo[i.cip]?.attestation,\n          renouvellement: !!justifInfo[i.cip]?.renouvellement, rx: (justifInfo[i.cip]?.rx || []).map(x => x.id).filter(Boolean) } })),\n        totalHt: justifLines.reduce((t, i) => t + (i.total || 0), 0),\n        nbLignes: justifLines.length,\n        csv: csvOf(justifLines),\n        processed: false,\n        source: \"justificatif\",\n      };\n      jSave = await enregistrer(jOrder);\n      if (!jSave.ok) {\n        if (!saveNormal) return bloquer(jSave);   // rien d'enregistré : rien ne part\n        keepJustif = new Set(justifLines.map(i => i.cip));\n        flash(`⚠ Lignes sur justificatif labo NON enregistrées (${jSave.error}) : elles restent dans votre panier, renvoyez-les`);\n      }\n    }\n\n    // ── 2. E-mail à Elixir : la commande est enregistrée, un e-mail refusé ou perdu ne la perd plus ──\n    try {\n      // jeton joint (send-email : adresse de la pharmacie vérifiée)\n      const mail = await appelAuthentifie(\"/.netlify/functions/send-email\", {\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" },\n        body: JSON.stringify({ template_params: keepJustif\n          ? paramsMail(normalItems, normalItems.reduce((t, i) => t + (i.total || 0), 0), normalItems.reduce((n, i) => n + (i.qty || 0), 0))\n          : paramsMail(sendItems, cartTotal, cartCount) }),\n      });\n      if (!mail.ok) console.warn(\"[send-email] e-mail non envoyé (commande enregistrée) :\", mail.status);\n    } catch (err) { console.warn(\"[send-email] e-mail non envoyé (commande enregistrée) :\", err.message); }\n    setSendStatus(\"success\");\n\n    // ── 3. Envoi automatique vers PharmaML (relais), commande normale enregistrée seulement ──\n    // Le serveur relit la commande enregistrée, vérifie la pharmacie (jeton) et met les lignes EN STOCK dans\n    // la file du relais, que l'agent du Mac du bureau envoie à PharmaML ; le reste attend la synchro manuelle.\n    if (saveNormal?.ok) (async () => {\n      if (actingFor && !(pharmacyCip && pharmacyCip !== \"0\")) return;   // saisie Elixir sans CIP : synchro manuelle depuis l'admin\n      try {\n        const ptok = actingFor ? localStorage.getItem(\"admin_token\") : await freshPharmacyToken();\n        const res = await fetch(\"/.netlify/functions/submit-order\", {\n          method: \"POST\",\n          headers: ptok ? { \"Content-Type\": \"application/json\", \"Authorization\": `Bearer ${ptok}` } : { \"Content-Type\": \"application/json\" },\n          body: JSON.stringify({ orderId: saveNormal.id, pharmacyName, via: \"auto\" }),\n          ...delai(20000),\n        });\n        const json = await res.json().catch(() => ({}));\n        if (json.queued) console.log(`[PharmaML] ✓ ${json.lignes} ligne(s) en file d'envoi (réf. ${json.reference})${json.retenues ? `, ${json.retenues} à synchroniser par Elixir` : \"\"}`);\n        else console.log(\"[PharmaML] synchro par Elixir :\", json.error || res.status);\n      } catch (err) { console.warn(\"[PharmaML] envoi automatique non demandé :\", err.message); }\n    })();\n\n    // ── 4. Lignes « justificatif » enregistrées : demandes au laboratoire ──\n    if (jSave?.ok) {\n      try {\n        const auth = actingFor ? { token: localStorage.getItem(\"admin_token\"), odooId: actingFor.odoo_id } : { getToken: freshPharmacyToken };\n        await submitJustif(jSave.id, justifLines.map(i => ({ cip: i.cip, attestation: !!justifInfo[i.cip]?.attestation,\n          renouvellement: !!justifInfo[i.cip]?.renouvellement, rx: (justifInfo[i.cip]?.rx || []).map(x => x.id).filter(Boolean) })), auth);\n      } catch (e) {\n        console.warn(\"[justificatif labo]\", e.message);\n        flash(`⚠ Commande enregistrée ; sa transmission au laboratoire sera faite par Elixir (${e.message})`);\n      }\n    }\n    setTimeout(() => {\n      setSendStatus(null);\n      if (keepJustif) {\n        // garder seulement les lignes « justificatif » non enregistrées (la commande normale est partie)\n        setQuantities(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => {\n          const i = k.lastIndexOf(\"-\"); const p = CATALOG_WITH_ADMIN[k.slice(0, i)]?.products?.[Number(k.slice(i + 1))];\n          return p && keepJustif.has(p.cip);\n        })));\n        setSpecialItems(prev => prev.filter(x => keepJustif.has(x.cip)));\n        setJustifInfo(prev => Object.fromEntries(Object.entries(prev).filter(([c]) => keepJustif.has(c))));\n      } else {\n        setQuantities({});\n        setSpecialItems([]);\n        setJustifInfo({});\n        setCartOpen(false);\n      }\n    }, 3000);\n    return true;" },
  { zone: "confirmation de la commande groupée U-Labs", lot: "sécurité 19/10/2026 (relecture finale)", motif: "confirmation refusée faute de session : quantités du groupement renvoyées après la reconnexion (renvoyerGroupe)",
    avant: "                  if (res.status === 401 && !actingFor) setEnvoiBloque(\"reconnexion\");",
    apres: "                  if (res.status === 401 && !actingFor) { setEnvoiBloque(\"reconnexion\"); groupeAResynchroniser.current = true; }   // quantités renvoyées au groupement après la reconnexion" },
  // ── Péremption courte, lot 0 (20/10/2026, conception « Odoo facture la remise », § 8.2 et § 14) : src/peremption-panier.js ──
  // Seule la mention « Pér. <date> » de la branche peremption-prix-panier est reprise : elle suit une ligne hors catalogue
  // ajoutée depuis la page (panier, commande enregistrée, e-mail à Elixir). Ni ligne à part, ni commande à part, ni
  // changement du relais : prix, identité de ligne (CIP) et champs lus par le relais (cip, name, qty, pn) inchangés.
  // Appliqués après ceux de sécurité (ordre du tableau), tant que la référence ne contient pas le lot.
  { zone: "quantités et ajout au panier", lot: "péremption courte, lot 0 (20/10/2026)", attente: "peremptionMention", motif: "addItemToCart : un ajout depuis Péremption courte sur une ligne hors catalogue existante (même CIP) lui laisse la date du lot (champsMention) ; quantité, prix et identité comme avant",
    avant: "          n[i] = { ...n[i], qty: n[i].qty + item.qty, ...(item.supplier_code ? { supplier_code: item.supplier_code } : {}) };",
    apres: "          // ajout depuis Péremption courte : la ligne garde la date du lot (champsMention) ; prix et identité inchangés\n          n[i] = { ...n[i], qty: n[i].qty + item.qty, ...(item.supplier_code ? { supplier_code: item.supplier_code } : {}), ...champsMention(item) };" },
  { zone: "quantités et ajout au panier", lot: "péremption courte, lot 0 (20/10/2026)", attente: "peremptionMention", motif: "addItemToCart : nouvelle ligne hors catalogue ajoutée depuis Péremption courte : date du lot gardée (champsMention) ; mêmes champs qu'avant pour toute autre ligne",
    avant: "        return [...prev, { cip: item.cip || null, name: item.name, qty: item.qty, pn: item.pn ?? null, pv: item.pv ?? null, tiers: item.tiers ?? null, ...(item.supplier_code ? { supplier_code: item.supplier_code } : {}) }];",
    apres: "        return [...prev, { cip: item.cip || null, name: item.name, qty: item.qty, pn: item.pn ?? null, pv: item.pv ?? null, tiers: item.tiers ?? null, ...(item.supplier_code ? { supplier_code: item.supplier_code } : {}), ...champsMention(item) }];" },
  { zone: "panier calculé, contingentement, signature du catalogue, adresse ↔ menu", lot: "péremption courte, lot 0 (20/10/2026)", attente: "peremptionMention", motif: "ligne du panier : date du lot et mention « Pér. … » recopiées (champsPeremption) ; clé, rayon, prix et total inchangés",
    avant: "        supplierCode: s.supplier_code || null,",
    apres: "        supplierCode: s.supplier_code || null,\n        ...champsPeremption(s),   // péremption courte : date du lot et mention « Pér. … » (rien d'autre ne change)" },
  { zone: "envoi de la commande", lot: "péremption courte, lot 0 (20/10/2026)", attente: "peremptionMention", motif: "e-mail à Elixir : « PÉREMPTION COURTE (Pér. 31/12/2026, sans remise péremption) » sur la ligne (mentionMail) ; vide pour toute autre ligne",
    avant: "${isJustif(i) ? \" — SUR JUSTIFICATIF LABO (\" + jp[i.cip].labNom + \")\" : \"\"}\\n  Qté : ${i.qty}",
    apres: "${isJustif(i) ? \" — SUR JUSTIFICATIF LABO (\" + jp[i.cip].labNom + \")\" : \"\"}${mentionMail(i)}\\n  Qté : ${i.qty}" },
  { zone: "envoi de la commande", lot: "péremption courte, lot 0 (20/10/2026)", attente: "peremptionMention", motif: "lignes enregistrées : mention « Pér. … » et date du lot gardées (mentionCommande : admin, « Mes commandes ») ; le relais n'en lit que cip, name, qty et pn",
    avant: "    const toItems = (arr) => arr.map(i => ({ cip: i.cip || null, name: i.name, qty: i.qty, pn: i.pn, total: i.total, ...(i.group ? { group: i.group } : {}) }));",
    apres: "    // péremption courte : mention « Pér. … » et date du lot gardées dans la ligne (mentionCommande ; le relais ne les lit pas)\n    const toItems = (arr) => arr.map(i => ({ cip: i.cip || null, name: i.name, qty: i.qty, pn: i.pn, total: i.total, ...(i.group ? { group: i.group } : {}), ...mentionCommande(i) }));" },  // ── Péremption courte, règle panier (21/10/2026, décision de Zineb : « par défaut le −50 s'affiche et c'est la règle panier qui
  // s'applique », docs/peremption.md) : src/peremption-panier.js. Reprise de la branche peremption-prix-panier (d801990, 3774a17) sur
  // le lot 0 et la V1 : ajout depuis la page = ligne à part au prix de la page (« Pér. <date> · −X % »), jamais fondue dans une
  // ligne de menu ou de la Saisie du même CIP ; commande à part si le même produit est sur une autre ligne (separeDe), relayée
  // après l'autre ; e-mail, bon copié. Appliqués après ceux du lot 0 (ordre du tableau), tant que la référence ne contient pas
  // le lot (attente « peremptionPanier », LOTS.peremptionPanier). Avec eux : _relais.js (FICHIERS_AUTORISES, empreinte « :per »).
  { zone: "quantités et ajout au panier", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "setItemQty : attestation et ordonnances gardées tant qu'une autre ligne du même CIP reste au panier (ligne du menu et ligne péremption, deux menus) ; avant, retirer l'une les effaçait pour l'autre",
    avant: "    // ligne retirée : attestation et ordonnances valent pour UNE commande, jamais réutilisées\n    if ((parseInt(newQty) || 0) <= 0 && item.cip) setJustifInfo(",
    apres: "    // ligne retirée : attestation et ordonnances valent pour UNE commande, jamais réutilisées ; gardées tant qu'une autre\n    // ligne du même CIP reste au panier (menu et péremption courte, deux menus) : elles valent pour elle\n    if ((parseInt(newQty) || 0) <= 0 && item.cip && !cartItems.some(j => j.key !== item.key && j.cip === item.cip)) setJustifInfo(" },
  { zone: "quantités et ajout au panier", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "setItemQty : une ligne hors catalogue est retrouvée par son identité (idSpecial) — la ligne péremption d'un CIP se modifie et se retire seule, sans toucher la ligne de la Saisie du même CIP",
    avant: "      const id = item.cip || item.name;\n      setSpecialItems(prev => q <= 0\n        ? prev.filter(s => (s.cip || s.name) !== id)\n        : prev.map(s => (s.cip || s.name) === id ? { ...s, qty: q } : s));",
    apres: "      const id = item.specialId ?? (item.cip || item.name);   // ligne péremption courte : identité propre (idSpecial)\n      setSpecialItems(prev => q <= 0\n        ? prev.filter(s => idSpecial(s) !== id)\n        : prev.map(s => idSpecial(s) === id ? { ...s, qty: q } : s));" },
  { zone: "quantités et ajout au panier", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "addItemToCart : un ajout depuis Péremption courte devient une ligne à part, au prix, à la remise et à la date de la page (ajouterPeremption) ; avant (lot 0), il allait sur la ligne d'un menu du même CIP, au prix du menu, et la mention se perdait",
    avant: "    // article regroupant plusieurs références (même code fournisseur) : ligne hors catalogue, une seule\n    let added = false;",
    apres: "    // Péremption courte : ligne à part, au prix de la page et avec sa date (src/peremption-panier.js) — jamais la ligne d'un menu\n    if (estPeremption(item)) setSpecialItems(prev => ajouterPeremption(prev, item));\n    // article regroupant plusieurs références (même code fournisseur) : ligne hors catalogue, une seule\n    let added = estPeremption(item);" },
  { zone: "quantités et ajout au panier", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "addItemToCart : un ajout hors catalogue (Saisie) n'est jamais fondu dans la ligne péremption du même CIP ; la mention du lot 0 (champsMention) n'a plus lieu d'être ici (une ligne péremption n'arrive plus dans cette branche) : lignes d'avant le lot 0",
    avant: "        const i = byCode >= 0 ? byCode : prev.findIndex(s => (s.cip || s.name) === id);\n        if (i >= 0) {\n          const n = [...prev];\n          // ajout depuis Péremption courte : la ligne garde la date du lot (champsMention) ; prix et identité inchangés\n          n[i] = { ...n[i], qty: n[i].qty + item.qty, ...(item.supplier_code ? { supplier_code: item.supplier_code } : {}), ...champsMention(item) };",
    apres: "        const i = byCode >= 0 ? byCode : prev.findIndex(s => idSpecial(s) === id);   // jamais la ligne péremption du CIP\n        if (i >= 0) {\n          const n = [...prev];\n          n[i] = { ...n[i], qty: n[i].qty + item.qty, ...(item.supplier_code ? { supplier_code: item.supplier_code } : {}) };" },
  { zone: "quantités et ajout au panier", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "addItemToCart : nouvelle ligne hors catalogue sans champsMention (lot 0) : une ligne péremption passe par ajouterPeremption",
    avant: "        return [...prev, { cip: item.cip || null, name: item.name, qty: item.qty, pn: item.pn ?? null, pv: item.pv ?? null, tiers: item.tiers ?? null, ...(item.supplier_code ? { supplier_code: item.supplier_code } : {}), ...champsMention(item) }];",
    apres: "        return [...prev, { cip: item.cip || null, name: item.name, qty: item.qty, pn: item.pn ?? null, pv: item.pv ?? null, tiers: item.tiers ?? null, ...(item.supplier_code ? { supplier_code: item.supplier_code } : {}) }];" },
  { zone: "panier calculé, contingentement, signature du catalogue, adresse ↔ menu", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "ligne péremption : clé propre (special-per-<cip>, distincte de special-<cip>) et rayon « Péremption courte »",
    avant: "        key: `special-${s.cip || i}`,\n        cat: \"Hors catalogue\",",
    apres: "        key: estPeremption(s) ? `special-per-${s.cip || i}` : `special-${s.cip || i}`,\n        cat: estPeremption(s) ? \"Péremption courte\" : \"Hors catalogue\"," },
  { zone: "panier calculé, contingentement, signature du catalogue, adresse ↔ menu", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "ligne péremption : pastille orange du menu Péremption courte",
    avant: "        color: \"#2d9cbc\",",
    apres: "        color: estPeremption(s) ? COULEUR_PEREMPTION : \"#2d9cbc\"," },
  { zone: "panier calculé, contingentement, signature du catalogue, adresse ↔ menu", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "identité de ligne pour setItemQty (specialId) ; date, mention « Pér. … », remise, facturation par Odoo et prix de base de la ligne péremption (champsPeremption) — rien d'autre ne change pour les autres lignes",
    avant: "        ...champsPeremption(s),   // péremption courte : date du lot et mention « Pér. … » (rien d'autre ne change)",
    apres: "        specialId: idSpecial(s),\n        ...champsPeremption(s),   // péremption courte : date, mention « Pér. … », remise, facturation par Odoo, prix de base" },
  { zone: "copie du bon de commande", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "bon copié : mention « Pér. … · −X % » sous une ligne péremption",
    avant: "        return `${cip}${nm}${qty}${pn}${tot}`;",
    apres: "        // péremption courte : mention sous la ligne (« Pér. 31/12/2026 · −50 % · péremption courte »)\n        return `${cip}${nm}${qty}${pn}${tot}${estPeremption(i) ? `\\n${\"\".padEnd(18)}${notePeremption(i.peremption)}${remiseLigne(i).remise >= 1 ? ` · −${remiseLigne(i).remise} %` : \"\"} · péremption courte` : \"\"}`;" },
  { zone: "envoi de la commande", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "répartition multi-CIP : une ligne péremption n'est jamais répartie sur un autre CIP du même article (le lot court est celui de CE CIP)",
    avant: "    const codeFor = (i) => i.isCampaign ? null : (i.supplierCode || codeOf[i.cip] || null);   // campagne (UG) : ligne laissée telle quelle",
    apres: "    // campagne (UG), péremption courte (lot court de CE CIP) : ligne laissée telle quelle\n    const codeFor = (i) => i.isCampaign || estPeremption(i) ? null : (i.supplierCode || codeOf[i.cip] || null);" },
  { zone: "envoi de la commande", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "répartition multi-CIP : le stock pris par une ligne péremption est décompté pour les autres lignes",
    avant: "    for (const i of items) if (i.isCampaign && i.cip) used[i.cip] = (used[i.cip] || 0) + i.qty;",
    apres: "    for (const i of items) if ((i.isCampaign || estPeremption(i)) && i.cip) used[i.cip] = (used[i.cip] || 0) + i.qty;" },
  { zone: "envoi de la commande", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "e-mail à Elixir : mention PÉREMPTION COURTE (date, remise ; boîtes à corriger dans Odoo, sinon Contrôle des écarts) et numéros des deux commandes pour une ligne partie à part (mentionMail)",
    avant: "${mentionMail(i)}\\n  Qté : ${i.qty}",
    apres: "${mentionMail(i, perSepare.includes(i) ? { numero: saveSepare?.id, de: saveNormal?.id } : null)}\\n  Qté : ${i.qty}" },
  { zone: "envoi de la commande", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "ligne péremption dont le produit est sur une autre ligne : commande à part (separerPeremption — deux lignes d'un même CIP dans une commande PharmaML : comportement inconnu)",
    avant: "    const normalItems = sendItems.filter(i => !isJustif(i));",
    apres: "    // Péremption courte dont le produit est aussi sur une autre ligne : commande à part (separerPeremption)\n    const { principal: normalItems, separe: perSepare } = separerPeremption(sendItems.filter(i => !isJustif(i)));" },
  { zone: "envoi de la commande", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "lignes enregistrées : mention, date, remise et facturation par Odoo (mentionCommande) — commentaire seul",
    avant: "    // péremption courte : mention « Pér. … » et date du lot gardées dans la ligne (mentionCommande ; le relais ne les lit pas)",
    apres: "    // péremption courte : mention « Pér. … », date, remise et facturation par Odoo gardées dans la ligne (mentionCommande ; le\n    // relais n'en lit que cip, name, qty et pn)" },
  { zone: "envoi de la commande", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "total et CSV de la commande normale sans les lignes péremption parties à part",
    avant: "        totalHt: justifLines.length ? normalItems.reduce((t, i) => t + (i.total || 0), 0) : cartTotal,\n        nbLignes: normalItems.length,\n        csv: justifLines.length ? csvOf(normalItems) : csvContent,",
    apres: "        totalHt: justifLines.length || perSepare.length ? normalItems.reduce((t, i) => t + (i.total || 0), 0) : cartTotal,\n        nbLignes: normalItems.length,\n        csv: justifLines.length || perSepare.length ? csvOf(normalItems) : csvContent," },
  { zone: "envoi de la commande", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "commande à part enregistrée juste après la commande normale, ses lignes portent separeDe (n° de l'autre commande : admin, e-mail, écarts) ; refusée → ses lignes restent au panier, comme les lignes « justificatif »",
    avant: "      console.log(\"[order-save] ✓ Commande sauvegardée dans Supabase\");\n    }\n",
    apres: "      console.log(\"[order-save] ✓ Commande sauvegardée dans Supabase\");\n    }\n    // Péremption courte à part : enregistrée juste après la commande normale (qui porte l'autre ligne du même produit,\n    // donc déjà enregistrée ici) ; refusée → ses lignes restent au panier, comme les lignes « justificatif »\n    let saveSepare = null, keepSepare = null;\n    if (perSepare.length) {\n      // separeDe : n° de la commande qui porte l'autre ligne du produit (admin, e-mail, écarts : quoi corriger dans Odoo)\n      saveSepare = await enregistrer({ ...order, id: baseId + 2, items: toItems(perSepare).map(l => ({ ...l, separeDe: String(saveNormal?.id ?? \"\") })),\n        totalHt: perSepare.reduce((t, i) => t + (i.total || 0), 0),\n        nbLignes: perSepare.length, csv: csvOf(perSepare) });\n      if (!saveSepare.ok) {\n        keepSepare = new Set(perSepare.map(i => i.cip));\n        flash(`⚠ Ligne(s) péremption courte NON enregistrée(s) (${saveSepare.error}) : elles restent dans votre panier, renvoyez-les`);\n      }\n    }\n" },
  { zone: "envoi de la commande", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "e-mail : lignes enregistrées seulement (lignes à part refusées exclues)",
    avant: "    // ── 2. E-mail à Elixir : la commande est enregistrée, un e-mail refusé ou perdu ne la perd plus ──\n",
    apres: "    // ── 2. E-mail à Elixir : la commande est enregistrée, un e-mail refusé ou perdu ne la perd plus ──\n    // lignes enregistrées seulement (« justificatif » ou péremption à part refusées : restées au panier)\n    const mailItems = sendItems.filter(i => !(keepJustif && justifLines.includes(i)) && !(keepSepare && perSepare.includes(i)));\n" },
  { zone: "envoi de la commande", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "e-mail : lignes enregistrées seulement (lignes à part refusées exclues)",
    avant: "        body: JSON.stringify({ template_params: keepJustif\n          ? paramsMail(normalItems, normalItems.reduce((t, i) => t + (i.total || 0), 0), normalItems.reduce((n, i) => n + (i.qty || 0), 0))",
    apres: "        body: JSON.stringify({ template_params: keepJustif || keepSepare\n          ? paramsMail(mailItems, mailItems.reduce((t, i) => t + (i.total || 0), 0), mailItems.reduce((n, i) => n + (i.qty || 0), 0))" },
  { zone: "envoi de la commande", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "commande à part : « Commande envoyée » après la demande de ses deux relais (onglet fermé trop tôt : la seconde ne partait jamais) ; sans commande à part, inchangé",
    avant: "    } catch (err) { console.warn(\"[send-email] e-mail non envoyé (commande enregistrée) :\", err.message); }\n    setSendStatus(\"success\");",
    apres: "    } catch (err) { console.warn(\"[send-email] e-mail non envoyé (commande enregistrée) :\", err.message); }\n    // commande à part : « Commande envoyée » une fois ses deux relais demandés (plus bas) — avant, la seconde, demandée après\n    // la réponse de la première (jusqu'à 20 s), ne partait jamais si l'onglet était fermé entre-temps\n    if (!saveSepare?.ok) setSendStatus(\"success\");" },
  { zone: "envoi de la commande", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "relais PharmaML : commande normale puis commande à part, l'une après l'autre (promesse gardée)",
    avant: "    if (saveNormal?.ok) (async () => {\n      if (actingFor && !(pharmacyCip && pharmacyCip !== \"0\")) return;   // saisie Elixir sans CIP : synchro manuelle depuis l'admin\n      try {",
    apres: "    // Péremption courte à part : relayée APRÈS la commande normale (une à la fois : le stock en file de l'une est décompté\n    // pour l'autre)\n    const aRelayer = [saveNormal, saveSepare].filter(s => s?.ok);\n    const relais = aRelayer.length > 0 && (async () => {\n      if (actingFor && !(pharmacyCip && pharmacyCip !== \"0\")) return;   // saisie Elixir sans CIP : synchro manuelle depuis l'admin\n      for (const enr of aRelayer) try {" },
  { zone: "envoi de la commande", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "relais : numéro de la commande relayée ; keepalive (onglet fermé juste après l'envoi : la demande déjà partie va jusqu'au serveur)",
    avant: "          body: JSON.stringify({ orderId: saveNormal.id, pharmacyName, via: \"auto\" }),\n          ...delai(20000),",
    apres: "          body: JSON.stringify({ orderId: enr.id, pharmacyName, via: \"auto\" }),\n          keepalive: true,   // onglet fermé juste après l'envoi : la demande déjà partie va jusqu'au serveur\n          ...delai(20000)," },
  { zone: "envoi de la commande", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "commande à part : ses deux relais attendus (l'un après l'autre) avant « Commande envoyée »",
    avant: "      } catch (err) { console.warn(\"[PharmaML] envoi automatique non demandé :\", err.message); }\n    })();\n",
    apres: "      } catch (err) { console.warn(\"[PharmaML] envoi automatique non demandé :\", err.message); }\n    })();\n    if (saveSepare?.ok) { await relais; setSendStatus(\"success\"); }\n" },
  { zone: "envoi de la commande", lot: "péremption courte, règle panier (21/10/2026)", attente: "peremptionPanier", motif: "fin d'envoi : lignes à part refusées gardées au panier, comme les lignes « justificatif »",
    avant: "      if (keepJustif) {\n        // garder seulement les lignes « justificatif » non enregistrées (la commande normale est partie)\n        setQuantities(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => {\n          const i = k.lastIndexOf(\"-\"); const p = CATALOG_WITH_ADMIN[k.slice(0, i)]?.products?.[Number(k.slice(i + 1))];\n          return p && keepJustif.has(p.cip);\n        })));\n        setSpecialItems(prev => prev.filter(x => keepJustif.has(x.cip)));\n        setJustifInfo(prev => Object.fromEntries(Object.entries(prev).filter(([c]) => keepJustif.has(c))));",
    apres: "      if (keepJustif || keepSepare) {\n        // garder seulement les lignes non enregistrées, « justificatif » ou péremption à part (la commande normale est partie)\n        setQuantities(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => {\n          const i = k.lastIndexOf(\"-\"); const p = CATALOG_WITH_ADMIN[k.slice(0, i)]?.products?.[Number(k.slice(i + 1))];\n          return p && keepJustif?.has(p.cip);\n        })));\n        setSpecialItems(prev => prev.filter(x => keepJustif?.has(x.cip) || (estPeremption(x) && keepSepare?.has(x.cip))));\n        setJustifInfo(prev => Object.fromEntries(Object.entries(prev).filter(([c]) => keepJustif?.has(c))));" },
  // Revue du 21/10/2026 (correctifs) : ligne péremption jamais classée « sur justificatif » (stock court d'Elixir, jamais
  // commandée au labo), justificatif compté hors lignes péremption ; numéro d'une commande stable même quand la commande à
  // part perdue repart seule (clé sans separeDe : order-save reconnaît la commande, pas de doublon) ; fin d'envoi : une ligne
  // péremption n'est gardée que si SA commande à part a été refusée.
  { zone: "panier calculé, contingentement, signature du catalogue, adresse ↔ menu", lot: "péremption courte, règle panier (21/10/2026), revue", attente: "peremptionPanier", motif: "justificatif : lignes péremption hors du contrôle et des totaux par CIP (stock court d'Elixir, jamais commandé au labo)",
    avant: "  const justifCheck = useMemo(() => justifIssues(cartItems, justifProducts, justifInfo), [cartItems, justifProducts, justifInfo]);\n  const cartTotalsByCip = useMemo(() => qtyByCip(cartItems), [cartItems]);",
    apres: "  const justifCheck = useMemo(() => justifIssues(cartItems.filter(i => !estPeremption(i)), justifProducts, justifInfo), [cartItems, justifProducts, justifInfo]);\n  const cartTotalsByCip = useMemo(() => qtyByCip(cartItems.filter(i => !estPeremption(i))), [cartItems]);" },
  { zone: "envoi de la commande", lot: "péremption courte, règle panier (21/10/2026), revue", attente: "peremptionPanier", motif: "justificatif : contrôle avant l'envoi sans les lignes péremption",
    avant: "    const jIssues = justifIssues(cartItems, justifProducts, justifInfo);",
    apres: "    const jIssues = justifIssues(cartItems.filter(i => !estPeremption(i)), justifProducts, justifInfo);" },
  { zone: "envoi de la commande", lot: "péremption courte, règle panier (21/10/2026), revue", attente: "peremptionPanier", motif: "justificatif : contrôle au stock du moment sans les lignes péremption",
    avant: "    const jIssues2 = justifIssues(cartItems, jp, justifInfo);",
    apres: "    const jIssues2 = justifIssues(cartItems.filter(i => !estPeremption(i)), jp, justifInfo);" },
  { zone: "envoi de la commande", lot: "péremption courte, règle panier (21/10/2026), revue", attente: "peremptionPanier", motif: "ligne péremption jamais « sur justificatif » (sinon : deux lignes du même CIP dans la commande justificatif, ligne −50 % commandée au labo) ; totaux par CIP hors lignes péremption",
    avant: "    const totalsSend = qtyByCip(sendItems);\n    const isJustif = (i) => needsJustif(i, jp, totalsSend);",
    apres: "    const totalsSend = qtyByCip(sendItems.filter(i => !estPeremption(i)));\n    const isJustif = (i) => !estPeremption(i) && needsJustif(i, jp, totalsSend);" },
  { zone: "envoi de la commande", lot: "péremption courte, règle panier (21/10/2026), revue", attente: "peremptionPanier", motif: "numéro stable : clé sans separeDe (commande à part enregistrée sans réponse puis renvoyée seule : même numéro, order-save répond { deja }, un seul relais)",
    avant: "      const cle = JSON.stringify([actingFor?.odoo_id ?? null, pharmacyEmail, o.source, o.items]);",
    apres: "      const cle = JSON.stringify([actingFor?.odoo_id ?? null, pharmacyEmail, o.source, o.items.map(({ separeDe, ...l }) => l)]);   // eslint-disable-line no-unused-vars" },
  { zone: "envoi de la commande", lot: "péremption courte, règle panier (21/10/2026), revue", attente: "peremptionPanier", motif: "fin d'envoi : ligne péremption gardée seulement si sa commande à part a été refusée (plus jamais au titre du justificatif)",
    avant: "        setSpecialItems(prev => prev.filter(x => keepJustif?.has(x.cip) || (estPeremption(x) && keepSepare?.has(x.cip))));",
    apres: "        setSpecialItems(prev => prev.filter(x => (!estPeremption(x) && keepJustif?.has(x.cip)) || (estPeremption(x) && keepSepare?.has(x.cip))));" },
  // ── Contingentement dans la ligne de l'article (23/10/2026, docs/contingentement-ligne.md ; attente « quotaLigne ») ──
  // Revue : une réponse de quota-status arrivée APRÈS un changement de pharmacie (saisie Elixir : panier ouvert, ajout depuis la
  // Saisie ou pastille pour A, puis passage à B) s'affichait sur les lignes de B et dans son panier. loadQuota n'enregistre plus
  // une réponse que si la pharmacie affichée est encore celle du départ de la lecture (cleQuotaRef, posée hors zone juste avant) ;
  // il renvoie toujours la réponse (contrôle de l'envoi inchangé : il relit et bloque avec les chiffres qu'il a demandés).
  { zone: "panier calculé, contingentement, signature du catalogue, adresse ↔ menu", lot: "contingentement dans la ligne (23/10/2026)", attente: "quotaLigne", motif: "loadQuota : identité de la pharmacie notée au départ de la lecture (même clé que cleQuotaRef)",
    avant: "    if (!pharmacyEmail && !actingFor) return null;\n    try {",
    apres: "    if (!pharmacyEmail && !actingFor) return null;\n    // réponse enregistrée seulement pour la pharmacie encore affichée (saisie Elixir : autre pharmacie choisie entre-temps)\n    const cle = `${actingFor?.odoo_id ?? \"\"}|${pharmacyEmail}|${pharmacyCip}`, garde = (j) => { if (cle === cleQuotaRef.current) setQuota(j); return j; };\n    try {" },
  { zone: "panier calculé, contingentement, signature du catalogue, adresse ↔ menu", lot: "contingentement dans la ligne (23/10/2026)", attente: "quotaLigne", motif: "loadQuota : réponse, refus et panne enregistrés par garde (rien pour une autre pharmacie), réponse toujours renvoyée",
    avant: "      if (!r.ok) { setQuota(null); return null; }\n      const j = await r.json();\n      setQuota(j);\n      return j;\n    } catch { setQuota(null); return null; }",
    apres: "      if (!r.ok) return garde(null);\n      return garde(await r.json());\n    } catch { return garde(null); }" },
];
// Lots en attente de fusion dans la référence : leurs écarts ne valent que si la référence ne les contient pas encore,
// repéré par un fichier propre au lot. Ainsi la vérification passe contre master (local, d'avant les correctifs) comme
// contre origin/master (correctifs en ligne, assistant pas encore fusionné). À vider dès que la référence contient le lot.
const LOTS = {
  securite: { nom: "correctifs de sécurité du 19/10/2026", repere: "scripts/test-securite-2.mjs" },
  assistant: { nom: "Assistant Elixir", repere: "src/assistant-client.js" },
  // suite du même projet, demandée par Zineb le 19/10/2026 après la mise en ligne de l'assistant (origin/master contient
  // déjà le lot « assistant ») : fenêtre de présentation et lanceur flottant
  assistantPresentation: { nom: "Assistant Elixir (présentation et lanceur)", repere: "src/components/assistant/presentation.js" },
  // branche accueil-offres (docs/accueil.md), en attente de fusion : page d'accueil et mises en avant de Zineb
  accueil: { nom: "page d'accueil (mises en avant)", repere: "src/components/accueil/Squelette.jsx" },
  // branche appli-notifications (docs/notifications.md), en attente de fusion : appli installable et notifications Web Push
  notifications: { nom: "notifications (appli installable)", repere: "src/notifications/regles.js" },
  // Péremption courte, lot 0 (20/10/2026) : mention « Pér. » jusqu'à la commande (ECARTS_AUTORISES, attente
  // « peremptionMention »)
  peremptionMention: { nom: "péremption courte, lot 0 (mention « Pér. »)", repere: "scripts/test-peremption-mention.mjs" },
  // Péremption courte, V1 « Odoo facture la remise » (docs/peremption-odoo.md) : fonctions nouvelles (AJOUTS_AUTORISES) ;
  // la page des pharmacies ne lit plus le jeton admin (l'onglet admin est PeremptionsAdmin.jsx, appels par adminFetch)
  peremptionOdoo: { nom: "péremption courte, V1 (« Odoo facture la remise »)", repere: "scripts/test-peremption-odoo.mjs" },
  // Péremption courte, règle panier (21/10/2026, docs/peremption.md) : −50 % affiché par défaut, ligne « Pér. » à part au prix
  // de la page, commande à part, contrôle et suivi des écarts (ECARTS_AUTORISES, attente « peremptionPanier » ; _relais.js)
  peremptionPanier: { nom: "péremption courte, règle panier", repere: "scripts/test-peremption-panier.mjs" },
  // appli « Elixir Admin » à l'adresse /admin (21/10/2026, docs/notifications.md § 10) : retour à l'admin dans l'appli
  appliAdmin: { nom: "appli « Elixir Admin » (adresse /admin)", repere: "src/adresse-admin.js" },
  // contingentement dans la ligne de l'article (23/10/2026, docs/contingentement-ligne.md) : loadQuota ignore une réponse
  // arrivée pour une autre pharmacie (ECARTS_AUTORISES, attente « quotaLigne »)
  quotaLigne: { nom: "contingentement dans la ligne de l'article", repere: "src/quota-ligne.js" },
};
// Fichiers intouchables et clés de stockage modifiés volontairement : affichés, non comptés comme écarts. À vider
// dès que master contient la modification. Correctif de sécurité du 19/10/2026 (order-list, restock-alert et
// pharmacy-lookup exigent un jeton ; le site renouvelle le jeton pharmacie expiré : une lecture de plus).
// Valeur : motif (correctifs de sécurité : modification affichée, admise) ou { empreinte, motif } (Assistant Elixir :
// modification figée par son empreinte sha256 à 12 caractères — toute autre modification reste signalée).
const FICHIERS_AUTORISES = {
  "netlify/functions/order-list.js": "correctif de sécurité du 19/10/2026 (jeton obligatoire ; relecture finale : Supabase Auth en panne → 503 indisponible)",
  // correctif de sécurité du 19/10/2026 (jeton obligatoire), puis alertes retour (20/10/2026, docs/alertes-retour.md) :
  // modification figée par son empreinte (vaut contre master local, d'avant les correctifs, comme contre origin/master)
  "netlify/functions/restock-alert.js": { empreinte: "9b28a9339ec3", motif: "alertes retour (20/10/2026) : « mes alertes » sans adresse e-mail, avec notified, retour et retour_cip (mention « De retour en stock » de la Saisie, _restock.js) ; nouvelle demande : suivi d'envoi remis à zéro (notified_at, attempts, outcome), repli sans ces colonnes ; correctifs de la revue : cip en chiffres (7 à 14), nom du produit coupé à 200 caractères, CIP de pharmacie et adresse de l'admin sans espaces" },
  "netlify/functions/pharmacy-lookup.js": "correctif de sécurité du 19/10/2026 (limite de débit, fermé en mode code)",
  // second correctif du 19/10/2026 : plus aucune commande, commande groupée ni habitude d'achat sans jeton
  "netlify/functions/_gp.js": "second correctif de sécurité du 19/10/2026 (identité des commandes groupées : jeton obligatoire, plus de repli sur l'e-mail du corps ; relecture finale : Supabase Auth en panne → refus 5xx, jamais 401)",
  "netlify/functions/gp-pharmacy.js": "second correctif de sécurité du 19/10/2026 (jeton obligatoire : 401 reconnexion)",
  "netlify/functions/gp-upload.js": "second correctif de sécurité du 19/10/2026 (jeton obligatoire : analyses LGO et quota au nom du jeton)",
  "netlify/functions/quota-status.js": "second correctif de sécurité du 19/10/2026 (jeton obligatoire, adresses comparées en eq au lieu de ilike)",
  "netlify/functions/order-save.js": "second correctif de sécurité du 19/10/2026 (jeton obligatoire, identité du jeton, contrôle { verifier } avant envoi, quarantaine bornée des pages d'avant le correctif, entered_by pour la saisie Elixir seulement, lignes « justificatif » contrôlées ; relecture finale : même numéro renvoyé → { deja } si même commande, 409 sinon ; quarantaine avec justificatif nettoyé ; Supabase Auth en panne → 503)",
  "netlify/functions/ml-recommend.js": "second correctif de sécurité du 19/10/2026 (suggestions au CIP du jeton, segments et ruptures réservés à l'admin)",
  "netlify/functions/group-order.js": "second correctif de sécurité du 19/10/2026 (jeton obligatoire, autres pharmacies anonymes ; relecture finale : Supabase Auth en panne → 503)",
  "netlify/functions/pharmacy-otp-send.js": "second correctif de sécurité du 19/10/2026 (limite durable par connexion et par adresse × connexion, IPv6 par /64 ; code non envoyé non compté ; relecture finale : connexion demandeuse du code enregistrée)",
  "netlify/functions/pharmacy-otp-verify.js": "second correctif de sécurité du 19/10/2026 (limite durable des codes erronés par adresse et par connexion ; relecture finale : la connexion qui a demandé le code a ses essais à elle, un tiers ne la bloque plus)",
  "netlify/functions/send-email.js": "second correctif de sécurité du 19/10/2026 (destinataire fixé par le serveur, adresse vérifiée par le jeton, « identité non vérifiée » sans jeton ; relecture finale : Supabase Auth en panne → 503, rien envoyé)",
  "netlify/functions/rate-limit.js": "second correctif de sécurité du 19/10/2026 (limiteDurable : limite partagée dans kv_store, liberer ; IPv6 compté par préfixe /64 ; relecture finale : noterDemandeur / estDemandeur)",
  // relecture finale du second correctif (19/10/2026)
  "netlify/functions/auth.js": "relecture finale du second correctif de sécurité du 19/10/2026 (Supabase Auth en panne ≠ jeton invalide : verifierJeton lève « indisponible » → 503 ; verifyTokenAsync refuse toujours ; verifyAdmin / verifyAuth → 503)",
  "netlify/functions/_lab-justif.js": "relecture finale du second correctif de sécurité du 19/10/2026 (menageOrdonnances garde les ordonnances des commandes « a_verifier » non traitées)",
  // Assistant Elixir : fonction existante modifiée (les fonctions de lot 0 — order-list, restock-alert, pharmacy-lookup —
  // sont celles des correctifs ci-dessus depuis la fusion de master, 19/10/2026 ; l'agrégat de campagne ?agrege=1 est retiré)
  "netlify/functions/_odoo-rpc.js": { empreinte: "c405c5a8fadd", motif: "délai facultatif des lectures (5e argument), lectures de l'assistant coupées à 6 s" },
  // Péremption courte, règle panier (21/10/2026) : seule fonction serveur existante modifiée par le lot (reprise de 3774a17)
  "netlify/functions/_relais.js": { empreinte: "07965174f91d", motif: "péremption courte, règle panier (21/10/2026) : empreinte anti-doublon d'envoiAuto, ligne péremption marquée « :per » — la commande « à part » (même produit, même quantité que la ligne du menu de la commande voisine) n'est plus classée « POSSIBLE DOUBLON » ni écartée de l'envoi automatique ; sans ligne péremption, empreinte inchangée" },
  // Sections du catalogue (22/10/2026, docs/sections-admin.md) : contrôle serveur des seules actions section_* (ajout,
  // déplacement, remise, retrait depuis l'onglet ✏️ Modifier) ; les autres actions (update, create, delete) sont inchangées
  "netlify/functions/products-upsert.js": { empreinte: "f18d186674d1", motif: "sections du catalogue (22/10/2026) : actions section_* contrôlées par refusActionSection (src/components/sections-produits.js) après lecture de la ligne et des campagnes actives — refus 400 menu promo, outil, clé invalide, U-Labs ou campagne active (arrivée ou origine), Stratège sans colis ; 409 CIP déjà présent ; 503 si la lecture échoue, rien d'écrit ; les autres actions sont inchangées" },
};
// Projet « Assistant Elixir » (branche assistant-elixir, docs/assistant-contrat.md), en attente de fusion dans master :
// fonctions ajoutées sous netlify/functions (chat*.js, _chat-*.js), admises tant qu'elles n'existent pas dans la référence.
// Empreinte d'un fichier de FICHIERS_AUTORISES : node scripts/verifie-zones.mjs --empreintes
// Page d'accueil « La Tête de gondole » (branche accueil-offres, docs/accueil.md) : fonctions NOUVELLES seulement
// (accueil-offres.js, accueil-offres-refresh.js, _accueil-*.js) ; aucune fonction existante n'est modifiée.
// Alertes « M'avertir du retour » (branche alertes-retour, docs/alertes-retour.md) : restock-notify.js (envois et tableau de
// bord de l'admin), restock-notify-cron.js (passage planifié) et _restock.js (logique) ; seule fonction existante
// modifiée : restock-alert.js (FICHIERS_AUTORISES, empreinte).
// Notifications de l'appli installable (branche appli-notifications, docs/notifications.md) : fonctions NOUVELLES
// (_push.js, push-abonnement.js, push-admin.js, push-envoi-background.js, push-menage.js) ; seule fonction existante
// modifiée : _restock.js (crochet « Retour en stock » après l'e-mail, § 9.1), déjà admise ci-dessus avec les alertes retour.
// Messages unitaires et collectifs (branche notifications-messages, 21/10/2026, docs/notifications.md § 4 à 6) : fonctions
// NOUVELLES _push-messages.js (admise par _push-*), push-evenement.js (API signée de l'outil entrepôt) et
// push-programmes.js (messages programmés, planifiée) ; seules fonctions existantes modifiées : celles des notifications.
// Péremption courte, V1 « Odoo facture la remise » (docs/peremption-odoo.md) : peremption.js (page des pharmacies, admin,
// chaîne de nuit), peremption-cron.js (filet horaire) et _peremption.js (logique, seule porte d'écriture Odoo, par
// _odoo-rpc.js) ; aucune fonction existante modifiée (_accueil-outils.js et _accueil-donnees.js : admis d'office ;
// odoo-price-sync.js, _odoo-rpc.js, odoo-catalog.js, restock-alert.js et _lab-justif.js : importés, inchangés). Règle panier
// (21/10/2026) : _relais.js modifié (empreinte « :per », FICHIERS_AUTORISES) ; peremption.js, _peremption.js et
// _accueil-outils.js complétés (remise affichée, écarts) ; restock-alert.js inchangé (sa lecture publique des remises sert
// de repli à la page).
// Sections du catalogue (admin, onglet ✏️ Modifier : ajouter et retirer des produits d'une section existante, 22/10/2026,
// src/components/sections-produits.js) : fonction NOUVELLE products-sections.js, en LECTURE SEULE (produits retirés d'une
// section, état et stock de CIP ; réservée à l'admin) ; les écritures passent par products-upsert.js, qui contrôle aussi
// les actions section_* (FICHIERS_AUTORISES, empreinte), les autres actions inchangées.
// Contingentement dans la ligne de l'article (23/10/2026, docs/contingentement-ligne.md) : fonction NOUVELLE quota-liste.js,
// en LECTURE SEULE (règles des produits contingentés par quotaProducts de _quota.js, jeton exigé) ; _quota.js et
// quota-status.js inchangés (le reste de la pharmacie est lu par le même appel que le panier).
const AJOUTS_AUTORISES = /^netlify\/functions\/(_chat-[a-z-]+|chat(-[a-z]+)*|accueil-offres(-refresh)?|_accueil-[a-z-]+|restock-notify(-cron)?|_restock|_push(-[a-z-]+)?|push-(abonnement|admin|envoi-background|menage|evenement|programmes)|peremption(-cron)?|_peremption|products-sections|quota-liste)\.js$/;
// clé → écart de nombre d'appels admis, par lot (ajoutés tant que la référence ne contient pas le lot : LOTS)
const CLES_AUTORISEES = {
  // appelAuthentifie : renouvellement du jeton pharmacie, et du jeton admin en saisie (échange : src/jetons.js) ;
  // second correctif : contingentement, envoi de la commande, commande U-Labs, accès et écran des commandes groupées lisent
  // désormais le jeton par appelAuthentifie, plus directement — 5 lectures du jeton admin et 3 du jeton pharmacie en moins ;
  // une lecture de plus de pharmacy_token et de pharmacy_refresh_token : session sans aucun jeton, annoncée dans le panier
  securite: { 'localStorage.getItem("pharmacy_refresh_token"': 2, 'localStorage.getItem("admin_refresh_token"': 1,
    'localStorage.setItem("admin_token", d.token': 1, 'localStorage.setItem("admin_refresh_token", d.refresh_token': 1,
    'localStorage.getItem("admin_token"': -5, 'localStorage.getItem("pharmacy_token"': -2 },
  // assistant-client.js : jeton de l'appel (jetonCourant : pharmacie, ou admin en saisie Elixir) et renouvellement
  // (renouvelleJeton, par l'échange partagé de src/jetons.js) ; AssistantPanel : conversation gardée pour l'onglet
  assistant: { 'localStorage.getItem("pharmacy_token"': 1, 'localStorage.getItem("admin_token"': 1,
    'localStorage.getItem("pharmacy_refresh_token"': 1, 'localStorage.getItem("admin_refresh_token"': 1,
    "sessionStorage.getItem(cle(identite": 1, "sessionStorage.setItem(cle(identite": 1, "sessionStorage.removeItem(cle(identite": 1 },
  // src/components/assistant/presentation.js, clé assistant_presentation_<identite> (compte de la pharmacie) :
  // localStorage { vues, fini } — fenêtre de présentation affichée 3 fois au plus, plus jamais une fois l'assistant ouvert
  // ou sur « Ne plus afficher » ; sessionStorage « 1 » — « Plus tard » : plus rien jusqu'à la prochaine session
  assistantPresentation: { "localStorage.getItem(clePresentation(identite": 1, "localStorage.setItem(clePresentation(identite": 1,
    "sessionStorage.getItem(clePresentation(identite": 1, "sessionStorage.setItem(clePresentation(identite": 1 },
  // src/components/accueil/Squelette.jsx, clé accueil_salle : { l, h, s } — hauteur de la salle de la vitrine cinéma
  // mesurée à la dernière visite (largeur et hauteur de la fenêtre), réservée par le squelette (aucun décalage à l'arrivée)
  accueil: { "localStorage.getItem(CLE_SALLE": 1, "localStorage.setItem(CLE_SALLE, memo": 1 },
  // src/notifications/memo.js, clé notif_carte_<empreinte de l'identité> (aucune adresse e-mail en clair) : date du « Plus tard »
  // de la carte « Recevez nos alertes » de l'accueil (carte masquée 30 jours pour ce compte) ; AdminNotifications.jsx,
  // sessionStorage notif_brouillon_annonce : brouillon de l'annonce en cours (onglet) — seuls appels de stockage du lot
  notifications: { "localStorage.getItem(cleCarte(identite": 1, "localStorage.setItem(cleCarte(identite": 1,
    'sessionStorage.getItem(CLE_BROUILLON': 1, "sessionStorage.setItem(CLE_BROUILLON, JSON.stringify(brouillon": 1, "sessionStorage.removeItem(CLE_BROUILLON": 1 },
  // src/components/ShortExpiry.jsx : la page des pharmacies ne lit plus le jeton admin (adminAuthHeaders retiré)
  peremptionOdoo: { 'localStorage.getItem("admin_token"': -1 },
  // src/adresse-admin.js, clé appli_admin = "1" : posée par l'appli « Elixir Admin » ouverte sur l'admin (fenêtre d'appli
  // seulement), relue par les pages ouvertes ensuite dans l'appli sur une autre adresse (retour à l'admin toujours proposé)
  appliAdmin: { 'localStorage.setItem("appli_admin", "1"': 1, 'localStorage.getItem("appli_admin"': 1 },
};

// ── lecture ──
const git = (...a) => execFileSync("git", a, { cwd: APP, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const enRef = (chemin) => { try { return git("show", `${REF}:./${chemin}`); } catch { return null; } };
const enCours = (chemin) => existsSync(join(APP, chemin)) ? readFileSync(join(APP, chemin), "utf8") : null;
const empreinte = (t) => createHash("sha256").update(t).digest("hex").slice(0, 12);
// lot en attente de fusion dans la référence (LOTS) : son repère n'y est pas encore
const enAttente = (lot) => enRef(LOTS[lot].repere) == null;

const indentation = (l) => l.match(/^\s*/)[0].length;
const finDeBloc = (lignes, i) => {
  if (!/[{([]\s*(\/\/.*)?$/.test(lignes[i])) return i;   // ligne seule (pas de bloc ouvert)
  const n = indentation(lignes[i]);
  for (let j = i + 1; j < lignes.length; j++) if (lignes[j].trim() && indentation(lignes[j]) === n && /^\s*[)}\]]/.test(lignes[j])) return j;
  return -1;
};
const trouveUne = (lignes, re, depuis = 0) => {
  const idx = []; for (let i = depuis; i < lignes.length; i++) if (re.test(lignes[i])) idx.push(i);
  return idx;
};
// → { debut, fin, texte } ou { erreur }
function extrait(texte, z) {
  const lignes = texte.split("\n");
  const d = trouveUne(lignes, z.de);
  if (d.length !== 1) return { erreur: d.length ? `début ambigu (${d.length} occurrences)` : "début introuvable" };
  let repere = d[0];
  if (z.puis) { const p = trouveUne(lignes, z.puis, d[0]); if (!p.length) return { erreur: "repère introuvable" }; repere = p[0]; }
  const f = z.fin === "bloc" ? finDeBloc(lignes, repere) : trouveUne(lignes, z.fin, repere)[0] ?? -1;
  if (f < 0) return { erreur: "fin introuvable" };
  return { debut: d[0] + 1, fin: f + 1, texte: lignes.slice(d[0], f + 1).join("\n") };
}
const premiereDifference = (a, b) => {
  const la = a.split("\n"), lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) return { i, a: la[i], b: lb[i] };
  return null;
};

let ecarts = 0, erreurs = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const ko = (m) => { ecarts++; console.log(`  ✗ ${m}`); };

// --empreintes : empreinte actuelle des fichiers de FICHIERS_AUTORISES (à recopier après une modification voulue)
if (args.includes("--empreintes")) {
  for (const [f, permis] of Object.entries(FICHIERS_AUTORISES)) if (permis?.empreinte) console.log(`${f} ${enCours(f) == null ? "absent" : empreinte(enCours(f))}`);
  process.exit(0);
}

try { git("rev-parse", "--verify", `${REF}^{commit}`); }
catch { console.error(`Référence « ${REF} » inconnue de git.`); process.exit(2); }
console.log(`Zones protégées : ${REF} ↔ arbre de travail (${relative(process.cwd(), APP) || "."})\n`);

// 1. zones
console.log("Zones de logique");
for (const z of ZONES) {
  const tr = enRef(z.fichier), tc = enCours(z.fichier);
  const zr = tr == null ? { erreur: "fichier absent" } : extrait(tr, z);
  const zc = tc == null ? { erreur: "fichier absent" } : extrait(tc, z);
  const titre = `${z.fichier} · ${z.nom}`;
  if (zr.erreur) { erreurs++; console.log(`  ! ${titre} : ${zr.erreur} dans ${REF} (définition de zone à revoir)`); continue; }
  if (zc.erreur) { ko(`${titre} : ${zc.erreur} dans l'arbre de travail`); continue; }
  let attendu = zr.texte;
  // chaque écart vaut tant que la référence ne contient pas son lot (attente ; par défaut : correctifs de sécurité)
  for (const e of ECARTS_AUTORISES.filter(e => z.nom.startsWith(e.zone) && enAttente(e.attente || "securite"))) {
    if (!attendu.includes(e.avant)) { erreurs++; console.log(`  ! écart autorisé (lot ${e.lot}) introuvable dans la zone « ${z.nom} »`); continue; }
    attendu = attendu.replace(e.avant, e.apres);
  }
  if (attendu === zc.texte) ok(`${titre} — ${zc.fin - zc.debut + 1} lignes (l. ${zc.debut}-${zc.fin}), ${empreinte(zc.texte)}`);
  else {
    const d = premiereDifference(attendu, zc.texte);
    ko(`${titre} : ${empreinte(attendu)} ≠ ${empreinte(zc.texte)}, 1re différence ligne ${zc.debut + d.i} (${REF} : ${zr.debut + d.i})`);
    console.log(`      ${REF} : ${(d.a ?? "‹fin de zone›").trim().slice(0, 160)}\n      après  : ${(d.b ?? "‹fin de zone›").trim().slice(0, 160)}`);
  }
}

// 2. fichiers et dossiers intouchables
console.log("\nFichiers intouchables");
const fichiersDe = (dossier) => {
  const enRefListe = (() => { try { return git("ls-tree", "-r", "--name-only", REF, "--", dossier).split("\n").filter(Boolean); } catch { return []; } })();
  const parcours = (d) => !existsSync(join(APP, d)) ? [] : readdirSync(join(APP, d)).filter(n => !n.startsWith("."))
    .flatMap(n => statSync(join(APP, d, n)).isDirectory() ? parcours(join(d, n)) : [join(d, n)]);
  return [...new Set([...enRefListe, ...parcours(dossier)])].sort();
};
const assistant = { ajoutes: 0, modifies: 0 };
const verifieFichier = (chemin, silencieux) => {
  const a = enRef(chemin), b = enCours(chemin);
  if (a == null && b == null) return true;
  if (a == null && AJOUTS_AUTORISES.test(chemin)) { assistant.ajoutes++; return true; }
  // fonctions de l'assistant déjà en ligne : ce sont les siennes, pas des fonctions protégées par la refonte
  if (a != null && b != null && a !== b && AJOUTS_AUTORISES.test(chemin)) { assistant.modifies++; console.log(`  ~ ${chemin} : modifié (fonction ${/accueil/.test(chemin) ? "de la page d'accueil" : /restock/.test(chemin) ? "des alertes retour" : /push/.test(chemin) ? "des notifications" : /peremption/.test(chemin) ? "de la Péremption courte" : /products-sections/.test(chemin) ? "des sections du catalogue" : "de l'Assistant Elixir"})`); return true; }
  const permis = FICHIERS_AUTORISES[chemin];
  if (permis?.empreinte && a != null && b != null && a !== b) {
    if (empreinte(b) === permis.empreinte) { assistant.modifies++; return true; }
    ko(`${chemin} : modifié (${empreinte(b)}), empreinte admise : ${permis.empreinte} (FICHIERS_AUTORISES : ${permis.motif})`);
    return false;
  }
  if (a == null) { ko(`${chemin} : ajouté`); return false; }
  if (b == null) { ko(`${chemin} : supprimé`); return false; }
  // motif texte = correctif de sécurité : admis seulement tant que la référence ne le contient pas encore
  if (a !== b && typeof permis === "string" && enAttente("securite")) { console.log(`  ~ ${chemin} : modifié (autorisé : ${permis})`); return true; }
  if (a !== b) { const d = premiereDifference(a, b); ko(`${chemin} : modifié, ligne ${d.i + 1}`); return false; }
  if (!silencieux) ok(chemin);
  return true;
};
for (const f of FICHIERS) verifieFichier(f, false);
for (const d of DOSSIERS) {
  const liste = fichiersDe(d);
  const bons = liste.filter(f => verifieFichier(f, true)).length;
  const admis = assistant.ajoutes + assistant.modifies;
  if (bons === liste.length) ok(`${d}/** — ${liste.length - admis} fichiers identiques${admis ? `, admis : ${assistant.ajoutes} ajouté(s) et ${assistant.modifies} modifié(s) (Assistant Elixir, page d'accueil, alertes retour, notifications, Péremption courte, sections du catalogue, contingentement)` : ""}`);
}

// 3. clés de stockage
console.log("\nClés de stockage (localStorage / sessionStorage)");
const RE_STOCKAGE = /(local|session)Storage\.(get|set|remove)Item\([^)]*/g;
const sources = (liste) => liste.filter(f => /\.(jsx?|mjs)$/.test(f));
const appelsRef = sources(git("ls-tree", "-r", "--name-only", REF, "--", "src").split("\n").filter(Boolean))
  .flatMap(f => (enRef(f) || "").match(RE_STOCKAGE) || []).sort();
const appelsCours = sources(fichiersDe("src")).flatMap(f => (enCours(f) || "").match(RE_STOCKAGE) || []).sort();
{
  const avantCles = ecarts;
  const compte = (l) => l.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const cr = compte(appelsRef), cc = compte(appelsCours);
  // attendu : la référence, plus les écarts admis des lots qu'elle ne contient pas encore (LOTS)
  const lots = Object.keys(CLES_AUTORISEES).filter(enAttente);
  const admis = (k) => lots.reduce((n, l) => n + (CLES_AUTORISEES[l][k] || 0), 0);
  for (const k of new Set([...cr.keys(), ...cc.keys()])) {
    const ecart = (cc.get(k) || 0) - (cr.get(k) || 0);
    if (ecart && ecart === admis(k)) console.log(`  ~ ${k}) : ${cr.get(k) || 0} → ${cc.get(k) || 0} (autorisé : ${lots.filter(l => CLES_AUTORISEES[l][k]).map(l => LOTS[l].nom).join(" + ")})`);
    else if (ecart !== admis(k)) ko(`${k}) : ${cr.get(k) || 0} → ${cc.get(k) || 0}${admis(k) ? ` (admis : ${admis(k) > 0 ? "+" : ""}${admis(k)})` : ""}`);
  }
  if (ecarts === avantCles) ok(`${appelsCours.length} appels${lots.length ? ` (écarts admis : ${lots.map(l => LOTS[l].nom).join(", ")})` : ""}`);
}

// 4. tableaux d'ordinateur : autant d'en-têtes que de cellules par ligne (revue, docs/refonte-charte.md § 20 : la
// Sélection Master avait 7 cellules pour 6 en-têtes, prix net affiché sous « QTÉ »). Contrôle du texte d'App.jsx :
// columns de SECTION_META (menus en tableau, hors GRID_SECTIONS et vues spéciales) et des menus promo, comparées au
// nombre de <td du bloc {activeTab === "<clé>" && <>…</>} (ou {cat.isPromo && <>…</>}).
console.log("\nTableaux : en-têtes ↔ cellules (src/App.jsx)");
{
  const app = enCours("src/App.jsx") || "";
  const lignes = app.split("\n");
  const grille = ((app.match(/^const GRID_SECTIONS = \[([^\]]*)\]/m) || [])[1] || "").match(/"[^"]+"/g)?.map(x => x.slice(1, -1)) || [];
  const compteCols = (liste) => (liste.match(/"[^"]*"/g) || []).length;
  // bloc : de la ligne repère à la première ligne « </>} » de même indentation
  const cellules = (repere) => {
    const i = lignes.findIndex(l => repere.test(l));
    if (i < 0) return null;
    const n = indentation(lignes[i]);
    const f = lignes.findIndex((l, j) => j > i && indentation(l) === n && /^\s*<\/>\}/.test(l));
    return f < 0 ? null : (lignes.slice(i, f + 1).join("\n").match(/<td\b/g) || []).length;
  };
  const menus = [];
  for (const l of lignes.slice(0, lignes.findIndex(l => /^\};/.test(l)) + 1)) {
    const m = l.match(/^  (\w+):\s*\{.*\bcolumns: \[([^\]]*)\]/);
    if (m && !/specialView/.test(l) && !grille.includes(m[1]) && compteCols(m[2])) menus.push({ nom: m[1], cols: compteCols(m[2]), repere: new RegExp(`^\\s*\\{activeTab === "${m[1]}" && <>$`) });
  }
  const promo = app.match(/merged\[`promo_\$\{ps\.id\}`\] = \{[\s\S]*?columns: \[([^\]]*)\]/);
  if (promo) menus.push({ nom: "menus promo", cols: compteCols(promo[1]), repere: /^\s*\{cat\.isPromo && <>$/ });
  if (!menus.length) { erreurs++; console.log("  ! aucun menu en tableau trouvé dans SECTION_META (contrôle à revoir)"); }
  for (const m of menus) {
    const n = cellules(m.repere);
    if (n == null) ko(`${m.nom} : bloc de cellules introuvable (${m.cols} en-têtes)`);
    else if (n !== m.cols) ko(`${m.nom} : ${m.cols} en-têtes pour ${n} cellules`);
    else ok(`${m.nom} : ${n} colonnes`);
  }
  // sections perso (customSections) : en-têtes sans cellules produit, connu (§ 12) — aucune en production
  if (/isCustom: true/.test(app)) console.log("  · sections perso de l'admin : en-têtes sans cellules produit (signalé au § 12, aucune en production)");
}

// 5. budget du bundle (revue, § 20) : JS + CSS de dist/assets en octets (Vite affiche des kB de caractères, les accents
// pèsent plusieurs octets), polices exclues. Depuis que l'admin se charge à la demande (labo-otc, 16/10/2026), le
// bundle des pharmacies pèse ~895 000 octets : budget resserré à 940 000 pour qu'il reste un garde-fou.
// Part de l'Assistant Elixir dans ce bundle (bouton, état, renouvellement des jetons, entrées d'App et de Mes commandes ;
// groupe « AIDE » et panneau chargés à la demande) : ≈ 3,6 Ko mesurés le 19/10/2026 ; critère relevé de 3 à 4 Ko avec
// l'accord de Zineb (19/10/2026). Lanceur flottant et fenêtre de présentation (chargés à la demande, eux aussi) :
// 3 559 octets en tout, mesurés contre le build de f2461b7 (master sans l'assistant), soit +120 octets ; 3 655 après les
// correctifs de la revue (lien de menu promo, barre U-Labs : +96 octets).
console.log("\nBudget du bundle (dist/assets, octets)");
{
  const BUDGET = 940_000;
  const dossier = join(APP, "dist", "assets");
  if (!existsSync(dossier)) console.log("  · dist/ absent : lancer npm run build pour contrôler le budget");
  else {
    const fichiers = readdirSync(dossier).filter(n => /^index-.*\.(js|css)$/.test(n));
    const total = fichiers.reduce((s, n) => s + statSync(join(dossier, n)).size, 0);
    const detail = fichiers.map(n => `${n} ${statSync(join(dossier, n)).size.toLocaleString("fr-FR")}`).join(" · ");
    // fichiers de l'arbre seulement (une référence plus récente peut en contenir d'autres : alertes retour dans origin/master)
    const plusRecent = fichiersDe("src").filter(f => existsSync(join(APP, f))).reduce((t, f) => Math.max(t, statSync(join(APP, f)).mtimeMs), 0);
    if (plusRecent > statSync(join(APP, "dist", "index.html")).mtimeMs) console.log("  · dist/ antérieur aux sources : relancer npm run build avant de lire ce chiffre");
    if (total <= BUDGET) ok(`${total.toLocaleString("fr-FR")} octets ≤ ${BUDGET.toLocaleString("fr-FR")} (marge ${(BUDGET - total).toLocaleString("fr-FR")}) — ${detail}`);
    else ko(`${total.toLocaleString("fr-FR")} octets > budget ${BUDGET.toLocaleString("fr-FR")} — ${detail}`);
  }
}

console.log(`\nRésultat : ${erreurs ? `${erreurs} erreur(s) de définition, ` : ""}${ecarts ? `${ecarts} écart(s)` : "aucun écart"}`);
process.exit(erreurs ? 2 : ecarts ? 1 : 0);
