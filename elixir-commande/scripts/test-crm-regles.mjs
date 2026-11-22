// Hors ligne, données inventées : node scripts/test-crm-regles.mjs.
import assert from "node:assert/strict";
import { ROLES, peut, masquer, normaliserTelephone, departement, schemasCreation as C, schemasModification as M, droits } from "../netlify/functions/_crm-regles.js";
let ok = 0, ko = 0;
const test = (nom, fn) => { try { fn(); ok++; } catch (e) { ko++; console.error("✗", nom, e.message); } };
const id = "00000000-0000-4000-8000-000000000001";
const propre = { statut: "prospect", auteur_email: "commercial@exemple.test", proprietaire_email: "commercial@exemple.test" };
// Résultats attendus : admin, commercial, service_client, lecture.
const matrice = [
  ...["comptes", "contacts", "activites", "opportunites", "ca"].flatMap(r => ["lire", "lister"].map(a => [r, a, null, [true, true, true, true]])),
  ["marge", "lire", null, [true, false, false, false]],
  ...["compte", "global", "etat"].map(a => ["indicateurs", a, null, [true, true, true, true]]),
  ["indicateurs", "relancer", null, [true, false, false, false]],
  ...["creer", "modifier"].flatMap(a => [
    ["comptes", a, propre, [true, true, false, false]],
    ...["client", "ancien_client", "hors_cible"].map(statut => ["comptes", a, { statut }, [true, a === "modifier", false, false]]),
    ["comptes", a, { ...propre, odoo_id: 1 }, [true, a === "modifier", false, false]],
    ["contacts", a, null, [true, true, true, false]],
    ["opportunites", a, propre, [true, true, false, false]],
    ["opportunites", a, { proprietaire_email: "autre@exemple.test" }, [true, false, false, false]],
  ]),
  ["activites", "creer", null, [true, true, true, false]],
  ...["modifier", "terminer"].flatMap(a => [
    ["activites", a, propre, [true, true, true, false]],
    ["activites", a, { assigne_email: "commercial@exemple.test" }, [true, true, true, false]],
    ["activites", a, { auteur_email: "autre@exemple.test" }, [true, false, false, false]],
    ["activites", a, {}, [true, false, false, false]],
  ]),
  ...["attribuer", "archiver"].map(a => ["comptes", a, propre, [true, false, false, false]]),
  ...["equipe", "reglages"].flatMap(r => ["lire", "lister", "enregistrer"].map(a => [r, a, null, [true, false, false, false]])),
  ["journal", "lister", null, [true, false, false, false]],
  ["equipe", "chercher", null, [true, false, false, false]],
];
for (const [r, a, ligne, attendu] of matrice) for (const [i, role] of ROLES.entries()) test(`${role} ${r}.${a} ${JSON.stringify(ligne)}`, () => {
  assert.equal(peut({ role, email: "commercial@exemple.test" }, a, r, ligne), attendu[i]);
  assert.equal(peut({ role: "pharmacie" }, a, r, ligne), false);
});
for (const role of ROLES) for (const r of ["comptes", "contacts", "activites", "opportunites", "equipe", "reglages", "journal", "ca", "marge"]) {
  test(`action inconnue ${role}/${r}`, () => assert.equal(peut({ role }, "supprimer", r, propre), false));
}
test("aucune propriété implicite par e-mail absent", () => assert.equal(peut({ role: "commercial" }, "modifier", "activites", {}), false));
test("ressource inconnue refusée", () => assert.equal(peut({ role: "admin" }, "lire", "inconnue"), false));
test("journal non modifiable", () => assert.equal(peut({ role: "admin" }, "modifier", "journal"), false));
test("droits conditionnels", () => assert.equal(droits({ role: "commercial" }).activites.modifier, "propres"));
for (const [cp, dep] of [["75000", "75"], ["20000", "2A"], ["20190", "2A"], ["20200", "2B"], ["20600", "2B"], ["97100", "971"], ["97200", "972"], ["97300", "973"], ["97400", "974"], ["97600", "976"], ["98700", "987"], [null, null]]) test(`département ${cp}`, () => assert.equal(departement(cp), dep));
for (const s of ["01 00 00 00 00", "0033 (1) 00.00.00.00", "+33-1-00-00-00-00"]) test(`téléphone fictif ${s}`, () => assert.equal(normaliserTelephone(s), "+33100000000"));
test("téléphone outre-mer", () => assert.equal(normaliserTelephone("+262 000 000 000"), "+262000000000"));
test("normalisation compte", () => { const r = C.comptes.parse({ nom: " pharmacie-fictive-01 ", email: "COMMERCIAL@exemple.test", code_postal: "20200" }); assert.equal(r.departement, "2B"); assert.equal(r.email, "commercial@exemple.test"); assert.equal(r.statut, "prospect"); });
test("patch sans défauts", () => assert.deepEqual(M.comptes.parse({ nom: "pharmacie-fictive-02" }), { nom: "pharmacie-fictive-02" }));
test("effacer code postal efface département", () => assert.equal(M.comptes.parse({ code_postal: null }).departement, null));
const valides = { comptes: { nom: "pharmacie-fictive-01" }, contacts: { nom: "contact-fictif", compte_id: id }, activites: { compte_id: id, titre: "appel-fictif", type: "appel", auteur_email: "commercial@exemple.test" },
  opportunites: { compte_id: id, titre: "opportunite-fictive", proprietaire_email: "commercial@exemple.test" }, equipe: { utilisateur_id: id, email: "commercial@exemple.test", nom_affiche: "membre-fictif", role: "lecture" }, reglages: {} };
for (const [r, d] of Object.entries(valides)) {
  test(`création ${r}`, () => assert.equal(C[r].safeParse(d).success, true));
  test(`champ inconnu ${r}`, () => assert.equal(C[r].safeParse({ ...d, marge: 0 }).success, false));
  test(`patch vide ${r}`, () => assert.equal(M[r].safeParse({}).success, false));
  test(`patch version protégée ${r}`, () => assert.equal(M[r].safeParse({ version: 2 }).success, false));
}
for (const [r, patch] of [["comptes", { statut: "inconnu" }], ["contacts", { fonction: "inconnue" }], ["activites", { type: "inconnu" }], ["opportunites", { etape: "inconnue" }], ["equipe", { role: "inconnu" }], ["reglages", { seuils: { fictif: -1 } }], ["comptes", { email: "invalide" }], ["comptes", { telephone: "123" }], ["opportunites", { probabilite: 101 }], ["opportunites", { date_visee: "2026-02-30" }]]) test(`validation ${r}/${JSON.stringify(patch)}`, () => assert.equal(M[r].safeParse(patch).success, false));
const sensible = { marge: 0, lignes: [{ marge_brute: 0, nom: "fictif", detail: { marges: 0, ca: 0 } }] };
for (const role of ROLES) test(`masquage récursif ${role}`, () => assert.deepEqual(masquer({ role }, sensible), role === "admin" ? sensible : { lignes: [{ nom: "fictif", detail: { ca: 0 } }] }));
test("masquage sans mutation", () => assert.equal(sensible.lignes[0].detail.marges, 0));
test("jalons : dates valides seulement", () => {
  assert.equal(C.reglages.safeParse({ jalons: { "2026-12-01": 123 } }).success, true);
  assert.equal(M.reglages.safeParse({ jalons: { "2026-02-30": 123 } }).success, false);
  assert.equal(M.reglages.safeParse({ jalons: { "fictif": 123 } }).success, false);
});
console.log(`CRM règles : ${ok} ok, ${ko} ko`);
process.exitCode = ko ? 1 : 0;
