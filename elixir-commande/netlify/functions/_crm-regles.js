// Contrat du lot 1 : docs/crm-conception.md. Logique pure, aucun accès réseau.
import { z } from "zod";

export const ROLES = ["admin", "commercial", "service_client", "lecture"];
export const STATUTS = ["prospect", "client", "ancien_client", "hors_cible"];
export const CHAMPS_CRM_COMPTE = ["notes", "etiquettes", "groupement", "logiciel", "email"];
export const CHAMPS_ODOO_COMPTE = ["nom", "odoo_id", "cip", "siret", "adresse", "code_postal", "ville", "departement", "telephone", "statut", "source"];
export const ETAPES = ["a_qualifier", "premier_contact", "rdv", "proposition", "ouverture_compte", "gagnee", "perdue"];
const courriel = v => String(v || "").trim().toLowerCase();
const identique = (a, b) => !!a && !!b && courriel(a) === courriel(b);
export function peut(u, action, ressource, r) {
  if (!ROLES.includes(u?.role)) return false;
  const admin = u.role === "admin", commercial = u.role === "commercial", service = u.role === "service_client";
  if (["tableau", "accueil"].includes(ressource)) return action === "synthese";
  if (ressource === "import_suivi") return admin && ["apercu", "appliquer"].includes(action);
  if (ressource === "annuaire") return admin && ["etat", "relancer"].includes(action);
  if (ressource === "rapprochements") return admin && ["lister", "valider", "rejeter", "defaire"].includes(action);
  if (ressource === "indicateurs") return action === "relancer" ? admin : ["compte", "global", "etat"].includes(action);
  if (ressource === "marge") return action === "lire" && admin;
  if (["equipe", "reglages", "journal"].includes(ressource)) {
    if (action === "chercher") return admin && ressource === "equipe";
    return admin && (ressource === "journal" ? action === "lister" : ["lire", "lister", "enregistrer"].includes(action));
  }
  if (!["comptes", "contacts", "activites", "opportunites", "ca"].includes(ressource)) return false;
  if (["lire", "lister"].includes(action)) return true;
  if (ressource === "comptes") {
    if (["attribuer", "archiver"].includes(action)) return admin;
    if (action === "modifier") return admin || commercial; // Les champs sont contrôlés dans l’API.
    return action === "creer" && (admin || (commercial && r?.statut === "prospect" && !r?.odoo_id));
  }
  if (ressource === "contacts") return ["creer", "modifier"].includes(action) && (admin || commercial || service);
  if (ressource === "activites") {
    if (action === "creer") return admin || commercial || service;
    return ["modifier", "terminer"].includes(action) && (admin || ((commercial || service) &&
      (identique(u.email, r?.auteur_email) || identique(u.email, r?.assigne_email))));
  }
  if (ressource === "opportunites") return ["creer", "modifier"].includes(action) &&
    (admin || (commercial && identique(u.email, r?.proprietaire_email)));
  return false;
}
export function droits(u) {
  // Les valeurs « propres » et « prospects » sont des conditions, jamais des autorisations globales.
  return Object.fromEntries(["tableau", "accueil", "comptes", "contacts", "activites", "opportunites", "equipe", "reglages", "journal", "marge", "ca", "indicateurs", "annuaire", "rapprochements", "import_suivi"].map(r => [r,
    Object.fromEntries(["synthese", "apercu", "appliquer", "defaire", "valider", "rejeter", "chercher", "lire", "lister", "creer", "modifier", "terminer", "attribuer", "archiver", "enregistrer", "compte", "global", "relancer", "etat"].map(a => [a,
      peut(u, a, r) || (u.role === "commercial" && r === "comptes" && ["creer", "modifier"].includes(a) ? "prospects" :
        ["commercial", "service_client"].includes(u.role) && r === "activites" && ["modifier", "terminer"].includes(a) ? "propres" :
          u.role === "commercial" && r === "opportunites" && ["creer", "modifier"].includes(a) ? "propres" : false)]))]));
}
export function masquer(u, donnees) {
  if (Array.isArray(donnees)) return donnees.map(d => masquer(u, d));
  if (donnees && typeof donnees === "object") return Object.fromEntries(Object.entries(donnees)
    .filter(([k]) => peut(u, "lire", "marge") || !k.toLowerCase().startsWith("marge"))
    .map(([k, v]) => [k, masquer(u, v)]));
  return donnees;
}
export function normaliserTelephone(v) {
  let s = v.trim().replace(/[\s.()\-]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (/^0[1-9]\d{8}$/.test(s)) s = `+33${s.slice(1)}`;
  return s;
}
export function departement(cp) {
  if (!/^\d{5}$/.test(cp || "")) return null;
  if (cp.startsWith("20")) return Number(cp) < 20200 ? "2A" : "2B";
  return /^(97|98)/.test(cp) ? cp.slice(0, 3) : cp.slice(0, 2);
}
const texte = z.string().trim().max(500);
const nom = texte.min(1);
const notes = z.string().trim().max(20000).nullable().optional();
export const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const uuid = z.uuid();
export const version = z.number().int().min(1).max(2147483646);
const tel = z.string().transform(normaliserTelephone).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/)).nullable().optional();
const nullable = s => s.nullable().optional();
const date = nullable(z.iso.date());
const instant = nullable(z.iso.datetime({ offset: true }));
const montant = z.number().finite().nonnegative().max(999999999999);
const dep = z.string().regex(/^(?:0[1-9]|[1-8]\d|9[0-5]|2A|2B|97\d|98\d)$/);
const formes = {
  comptes: z.strictObject({ nom, odoo_id: nullable(z.number().int().positive()), finess: nullable(z.string().regex(/^\d{9}$/)),
    siret: nullable(z.string().regex(/^\d{14}$/)), cip: nullable(z.string().regex(/^\d{7,13}$/)), adresse: nullable(texte),
    code_postal: nullable(z.string().regex(/^\d{5}$/)), ville: nullable(texte), telephone: tel, email: nullable(email),
    statut: z.enum(STATUTS).default("prospect"), source: z.enum(["odoo", "annuaire", "saisie"]).default("saisie"),
    commercial_email: nullable(email), groupement: nullable(texte), logiciel: nullable(texte),
    etiquettes: z.array(nom).max(50).default([]), notes, archive: z.boolean().default(false) }),
  contacts: z.strictObject({ compte_id: uuid, rpps: nullable(z.string().regex(/^\d{11}$/)), nom, prenom: nullable(texte),
    fonction: z.enum(["titulaire", "cotitulaire", "adjoint", "preparateur", "acheteur", "comptable", "autre"]).default("autre"),
    telephone: tel, mobile: tel, email: nullable(email), canal_prefere: nullable(z.enum(["telephone", "email", "visite"])),
    principal: z.boolean().default(false), actif: z.boolean().default(true), notes }),
  activites: z.strictObject({ compte_id: uuid, titre: nom, type: z.enum(["appel", "visite", "email", "rendez_vous", "note", "tache"]),
    echeance: instant, realise_at: instant, statut: z.enum(["a_faire", "fait", "annule"]).default("a_faire"), resultat: notes,
    auteur_email: email, assigne_email: nullable(email), contact_id: nullable(uuid), opportunite_id: nullable(uuid), notes }),
  opportunites: z.strictObject({ compte_id: uuid, titre: nom, etape: z.enum(ETAPES).default("a_qualifier"),
    montant_mensuel_estime: nullable(montant), probabilite: nullable(z.number().min(0).max(100)), date_visee: date,
    motif_perte: notes, proprietaire_email: email, notes }),
  equipe: z.strictObject({ utilisateur_id: uuid, email, nom_affiche: nom, role: z.enum(ROLES),
    territoires: z.array(dep).max(150).default([]), objectif_mensuel: nullable(montant), actif: z.boolean().default(true) }),
  reglages: z.strictObject({ cibles_indicateurs: z.strictObject({
    fond_de_rayon: montant, specialites_cheres: montant, glp1: montant, seuil_demande_isolee: montant,
    origine: nom,
  }).optional(), territoire_indicateurs: z.array(dep).max(150).optional(), objectif_mensuel_global: nullable(montant),
    jalons: z.record(z.iso.date(), montant).default({}),
    cibles_par_pharmacie: z.record(uuid, montant).default({}), seuils: z.record(z.string().min(1).max(100), montant).default({}) }),
};
const normaliser = (r, d) => r === "comptes" && Object.hasOwn(d, "code_postal") ? { ...d, departement: departement(d.code_postal) } : d;
export const schemasCreation = Object.fromEntries(Object.entries(formes).map(([r, s]) => [r, s.transform(d => normaliser(r, d))]));
export const schemasModification = Object.fromEntries(Object.entries(formes).map(([r, s]) => [r,
  // optional à l'extérieur : les valeurs par défaut de création ne doivent pas écraser une modification partielle.
  z.strictObject(Object.fromEntries(Object.entries(s.shape).map(([k, v]) => [k, (v instanceof z.ZodDefault ? v.removeDefault() : v).optional()])))
    .refine(d => Object.keys(d).length > 0, "Au moins un champ est requis").transform(d => normaliser(r, d))]));
export function valider(schema, valeur) {
  const r = schema.safeParse(valeur);
  if (!r.success) throw Object.assign(new Error(`Entrée invalide : ${r.error.issues.map(i => i.path.join(".") || "objet").join(", ")}.`), { status: 400 });
  return r.data;
}
export const filtresSchema = z.strictObject({ page: z.number().int().min(1).max(100000).default(1), limite: z.number().int().min(1).max(100).default(50),
  tri: z.string().regex(/^[a-z_]+$/).default("updated_at"), sens: z.enum(["asc", "desc"]).default("desc"),
  vue_tableau: z.boolean().optional(), fonction: nom.optional(), type: nom.optional(), retard: z.boolean().optional(),
  echeance_debut: z.iso.date().optional(), echeance_fin: z.iso.date().optional(),
  source: z.enum(["saisie", "odoo", "annuaire"]).optional(),
  recherche: z.string().trim().min(1).max(100).optional(), statut: nom.optional(), commercial_email: email.optional(),
  departement: dep.optional(), archive: z.boolean().optional(), compte_id: uuid.optional(), assigne_email: email.optional(),
  proprietaire_email: email.optional(), etape: z.enum(ETAPES).optional(), echeance_avant: z.iso.datetime({ offset: true }).optional(),
  ca_min: z.number().finite().optional(), ca_max: z.number().finite().optional(),
  evolution_min: z.number().finite().optional(), evolution_max: z.number().finite().optional(),
  non_servi_min: z.number().nonnegative().optional(), non_servi_max: z.number().nonnegative().optional(),
  profil: z.string().max(100).optional(), action_proposee: z.string().max(200).optional(),
  objet: z.enum([...Object.keys(formes), "rapprochements"]).optional(), objet_id: uuid.optional(), utilisateur_id: uuid.optional() });
