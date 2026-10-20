// Tests de « Ajouter une photo » (admin, page d'accueil) : node scripts/test-photo-manuelle.mjs
// Hors ligne, sans navigateur ni réseau : parties pures de src/components/photo-manuelle.js (contrôle du fichier, taille
// d'arrivée, anti-cache ?v=, adresse renvoyée, clés de rangement, dosages visés d'une famille, menus du catalogue) et envoi
// par product-upload-image avec un adminFetch simulé (corps envoyé, réponses de la fonction, messages d'erreur, second
// appel qui range l'adresse avec ?v= au catalogue). La réduction
// elle-même (canvas) se vérifie au banc, dans un vrai navigateur. L'adresse produite passe la règle des mises en avant
// du serveur (netlify/functions/_accueil-vedettes.js : https, 500 caractères au plus).
import { adresseRecue, auCatalogue, avecVersion, ciblesFamille, cleMiseEnAvant, controlerFichier, dimensions, envoyerPhoto, estPhotoEnvoyee,
  MAX_OCTETS, MENUS_AVEC_PHOTOS, MENUS_CATALOGUE, poseeIci, portee, typeDuFichier, versionnerAuCatalogue } from "../src/components/photo-manuelle.js";
import { ORDRE_MENUS } from "../netlify/functions/_accueil-selection.js";

process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_KEY = "cle-de-test";
globalThis.fetch = async (url) => { throw new Error(`réseau interdit dans les tests : ${url}`); };
const { verifierVedette } = await import("../netlify/functions/_accueil-vedettes.js");

let ok = 0, ko = 0;
const egal = (label, obtenu, attendu) => {
  const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
  if (a === b) ok++; else { ko++; console.log(`✗ ${label}\n    obtenu  : ${a}\n    attendu : ${b}`); }
};
const vrai = (label, v) => egal(label, !!v, true);
const fichier = (name, type, size = 200_000) => ({ name, type, size });

// ── type et contrôle du fichier ──
egal("JPG déclaré", typeDuFichier(fichier("a.jpg", "image/jpeg")), "image/jpeg");
egal("PNG sans type déclaré : extension", typeDuFichier(fichier("Photo.PNG", "")), "image/png");
egal("WebP en octet-stream : extension", typeDuFichier(fichier("a.webp", "application/octet-stream")), "image/webp");
egal("JPEG sans type : extension .jpeg", typeDuFichier(fichier("a.jpeg", "")), "image/jpeg");
egal("GIF refusé", typeDuFichier(fichier("a.gif", "image/gif")), null);
egal("PDF refusé même nommé .jpg", typeDuFichier(fichier("a.jpg", "application/pdf")), null);
egal("sans type ni extension connue", typeDuFichier(fichier("notes.txt", "")), null);
egal("fichier accepté", controlerFichier(fichier("mounjaro.jpg", "image/jpeg")), null);
egal("aucun fichier", controlerFichier(null), "Aucun fichier choisi.");
egal("PDF : message clair", controlerFichier(fichier("tarifs.pdf", "application/pdf")), "« tarifs.pdf » n'est pas une photo JPG, PNG ou WebP : choisissez une photo.");
egal("HEIC d'iPhone : message propre", controlerFichier(fichier("IMG_0042.HEIC", "image/heic")), "Photo HEIC (iPhone) non prise en charge : enregistrez-la en JPG, puis réessayez.");
egal("HEIC sans type déclaré", controlerFichier(fichier("IMG_0042.heic", "")), "Photo HEIC (iPhone) non prise en charge : enregistrez-la en JPG, puis réessayez.");
egal("fichier vide", controlerFichier(fichier("a.png", "image/png", 0)), "Fichier vide : choisissez une autre photo.");
egal("15 Mo pile : accepté", controlerFichier(fichier("a.png", "image/png", MAX_OCTETS)), null);
egal("plus de 15 Mo : refusé avec le poids", controlerFichier(fichier("a.png", "image/png", 23.4 * 1048576)), "Photo trop lourde (23,4 Mo) : 15 Mo au plus.");

// ── taille d'arrivée (900 px au plus sur le grand côté, jamais agrandie) ──
egal("paysage 4000 × 3000", dimensions(4000, 3000), { largeur: 900, hauteur: 675, reduite: true });
egal("portrait 3000 × 4000", dimensions(3000, 4000), { largeur: 675, hauteur: 900, reduite: true });
egal("déjà petite : inchangée", dimensions(600, 800), { largeur: 600, hauteur: 800, reduite: false });
egal("900 pile : inchangée", dimensions(900, 900), { largeur: 900, hauteur: 900, reduite: false });
egal("bandeau très étroit : 1 px au moins", dimensions(9000, 3), { largeur: 900, hauteur: 1, reduite: true });

// ── anti-cache et adresse renvoyée ──
const PROD = "https://abcdefgh.supabase.co/storage/v1/object/public/elixir-images/products/3400930292914.webp";
egal("?v= ajouté", avecVersion(PROD, 1760950000000), `${PROD}?v=1760950000000`);
egal("ancien v= remplacé", avecVersion(`${PROD}?v=1`, 5), `${PROD}?v=5`);
egal("autres paramètres gardés", avecVersion("https://x.test/a.jpg?w=200&v=1#ancre", 5), "https://x.test/a.jpg?w=200&v=5");
egal("adresse du banc", avecVersion("/banc-photos/elixir-images/products/a.png", 7), "/banc-photos/elixir-images/products/a.png?v=7");
egal("https accepté", adresseRecue(PROD, false), PROD);
egal("http refusé", adresseRecue("http://x.test/a.jpg", false), null);
egal("data: refusé", adresseRecue("data:image/png;base64,AAAA", true), null);
egal("javascript: refusé", adresseRecue("javascript:alert(1)", true), null);
egal("adresse du banc refusée hors du banc", adresseRecue("/banc-photos/elixir-images/products/a.png", false), null);
egal("adresse du banc acceptée sur le banc", adresseRecue("/banc-photos/elixir-images/products/a.png", true), "/banc-photos/elixir-images/products/a.png");
egal("sur le banc : adresse sans protocole refusée", adresseRecue("//autre.test/a.png", true), null);
egal("sur le banc : autre chemin local refusé", adresseRecue("/assets/a.png", true), null);
egal("guillemet refusé", adresseRecue('https://x.test/a".jpg', false), null);
egal("trop longue refusée", adresseRecue(`https://x.test/${"a".repeat(460)}.jpg`, false), null);
egal("pas une chaîne", adresseRecue({ url: PROD }, false), null);
const it = { id: "mea_essai_1", type: "produit", cip: "3400930303122", emplacement: "vitrine", titre: "", accroche: "", badge: "", image: avecVersion(PROD.replace("3400930292914", "accueil-3400930303122-mh0abc12"), Date.now()) };
egal("adresse produite valable pour une mise en avant (règle du serveur)", verifierVedette(it).erreurs, []);
vrai("photo envoyée reconnue (Storage)", estPhotoEnvoyee(`${PROD}?v=1`));
vrai("photo envoyée reconnue (banc)", estPhotoEnvoyee("/banc-photos/elixir-images/products/a.png?v=1"));
egal("photo de la banque d'images : pas envoyée ici", estPhotoEnvoyee("https://assets.medipim.fr/media/medium/abc.jpg"), false);
egal("pas d'adresse", estPhotoEnvoyee(undefined), false);
vrai("photo du catalogue posée d'ici (même fichier, ?v= différent ou absent)", poseeIci(PROD, `${PROD}?v=9`));
egal("photo du catalogue d'un autre fichier : pas posée d'ici", poseeIci(PROD.replace("2914", "2907"), `${PROD}?v=9`), false);
egal("photo d'ici de la banque d'images : jamais posée au catalogue", poseeIci("https://assets.medipim.fr/media/medium/abc.jpg", "https://assets.medipim.fr/media/medium/abc.jpg"), false);
egal("pas de photo au catalogue", poseeIci(null, `${PROD}?v=9`), false);

// ── clés de rangement des mises en avant : jamais un CIP (catalogue intact), neuve à chaque envoi ──
const t0 = 1760950000000;
egal("produit", cleMiseEnAvant({ type: "produit", cip: "3400930303122" }, t0), `accueil-3400930303122-${t0.toString(36)}`);
egal("menu promo", cleMiseEnAvant({ type: "menu", menu_id: "1759327" }, t0), `accueil-menu-1759327-${t0.toString(36)}`);
egal("caractères inattendus retirés", cleMiseEnAvant({ type: "menu", menu_id: "12/../x y" }, t0), `accueil-menu-12xy-${t0.toString(36)}`);
vrai("clé acceptée par la fonction et le banc", /^[\w-]{1,80}$/.test(cleMiseEnAvant({ type: "produit", cip: "34009302929141234" }, t0)));
vrai("deux envois : deux clés", cleMiseEnAvant({ type: "produit", cip: "1" }, t0) !== cleMiseEnAvant({ type: "produit", cip: "1" }, t0 + 1));

// ── dosages visés d'une ligne des plus commandés ──
const STO = "https://abcdefgh.supabase.co/storage/v1/object/public/elixir-images/products";
const famille = (photos = {}, catalogue = {}, montre = "B") => {
  const v = (cip) => ({ cip, image_url: catalogue[cip] || null });
  const s = { ...v(montre), variantes: ["A", "B", "C", "D", "E"].map(v) };
  return ciblesFamille(s, photos);
};
egal("aucun dosage avec photo : tous, sans doublon du dosage montré", famille(), ["B", "A", "C", "D", "E"]);
egal("dosage avec photo au catalogue : laissé", famille({}, { E: "https://x.test/e.jpg" }), ["B", "A", "C", "D"]);
egal("photo de la banque propre à un dosage : gardée", famille({ C: "https://assets.medipim.fr/media/medium/c.jpg" }), ["B", "A", "D", "E"]);
egal("photo envoyée à la main (accueil seul) : remplacée avec la famille", famille({ A: `${PROD}?v=1`, B: `${PROD}?v=1` }), ["B", "A", "C", "D", "E"]);
egal("dosage montré : toujours, même avec une photo de la banque", famille({ B: "https://assets.medipim.fr/media/medium/b.jpg" }), ["B", "A", "C", "D", "E"]);
egal("famille du catalogue posée d'ici (Mounjaro, après rechargement) : tous remplacés",
  famille(Object.fromEntries("ABCDE".split("").map(c => [c, `${STO}/${c}.webp?v=1`])), Object.fromEntries("ABCDE".split("").map(c => [c, `${STO}/${c}.webp?v=1`]))), ["B", "A", "C", "D", "E"]);
egal("photo du catalogue venue de la fiche produit (même dossier, pas posée d'ici) : gardée",
  famille({ B: `${STO}/B.webp?v=1` }, { B: `${STO}/B.webp?v=1`, D: `${STO}/D.jpg` }), ["B", "A", "C", "E"]);
egal("photo du catalogue d'ailleurs malgré une photo de la banque choisie ici : gardée", famille({ C: "https://assets.medipim.fr/media/medium/c.jpg" }, { C: `${STO}/C.jpg` }), ["B", "A", "D", "E"]);
egal("produit seul", ciblesFamille({ cip: "3400930303122", image_url: null }), ["3400930303122"]);

// ── menus du catalogue : où la photo se voit ──
egal("menus du catalogue = ordre des menus du serveur (ORDRE_MENUS)", MENUS_CATALOGUE, ORDRE_MENUS);
vrai("menus avec photos : tous au catalogue", MENUS_AVEC_PHOTOS.every(k => MENUS_CATALOGUE.includes(k)));
const o = (cip, key, label) => ({ cip, menu: { key, label } });
vrai("Mounjaro / Wegovy : au catalogue", auCatalogue(o("1", "obeso", "Mounjaro / Wegovy")));
egal("Saisie de commande : hors catalogue", auCatalogue(o("1", "saisie", "Saisie de commande")), false);
egal("menu promo : hors catalogue (photos du menu dans admin_promos)", auCatalogue(o("1", "promo_17", "Offre")), false);
egal("sans menu", auCatalogue({ cip: "1" }), false);
egal("portée : menu en grille, un libellé par menu", portee([o("1", "obeso", "Mounjaro / Wegovy"), o("2", "obeso", "Mounjaro / Wegovy")]), { catalogue: true, menus: ["Mounjaro / Wegovy"] });
egal("portée : Sélection Expert (tableau, sans photo)", portee([o("1", "expert", "Sélection Expert")]), { catalogue: true, menus: [] });
egal("portée : Saisie seule", portee([o("1", "saisie", "Saisie de commande")]), { catalogue: false, menus: [] });
egal("portée : rien", portee(undefined), { catalogue: false, menus: [] });

// ── envoi (adminFetch simulé) ──
const appels = [];
const simule = (statut, corps, { jette = false, illisible = false } = {}) => async (url, options) => {
  appels.push({ url, options });
  if (jette) throw new TypeError("Failed to fetch");
  return { status: statut, ok: statut >= 200 && statut < 300, json: async () => { if (illisible) throw new SyntaxError("x"); return corps; } };
};
const PHOTO = { base64: "QUJD", mimeType: "image/webp" };
egal("succès : adresse + ?v=", await envoyerPhoto(simule(200, { success: true, image_url: PROD }), "3400930292914", PHOTO, 42), `${PROD}?v=42`);
const a = appels.at(-1);
egal("appel : fonction du catalogue en POST", [a.url, a.options.method], ["/.netlify/functions/product-upload-image", "POST"]);
egal("appel : corps { cip, imageBase64, mimeType }", JSON.parse(a.options.body), { cip: "3400930292914", imageBase64: "QUJD", mimeType: "image/webp" });
const echec = async (fetcher) => { try { await envoyerPhoto(fetcher, "1", PHOTO, 1); return "aucune erreur"; } catch (e) { return e.message; } };
egal("session expirée", await echec(simule(401, { error: "Non autorisé" })), "Session admin expirée : reconnectez-vous, puis recommencez.");
egal("trop lourde pour la fonction", await echec(simule(413, {}, { illisible: true })), "Photo trop lourde pour l'envoi : choisissez-en une plus petite.");
egal("erreur du Storage", await echec(simule(500, { error: "Storage: quota" })), "Envoi refusé (Storage: quota) : réessayez.");
egal("réponse illisible", await echec(simule(502, {}, { illisible: true })), "Envoi refusé (erreur 502) : réessayez.");
egal("succès sans adresse (essai à blanc)", await echec(simule(200, { success: true, ok: true })), "Envoi non confirmé : le serveur n'a pas renvoyé d'adresse de photo.");
egal("adresse http refusée", await echec(simule(200, { success: true, image_url: "http://x.test/a.jpg" })), "Envoi non confirmé : le serveur n'a pas renvoyé d'adresse de photo.");
egal("réseau coupé", await echec(simule(0, {}, { jette: true })), "Envoi impossible : connexion perdue. Réessayez.");

// ── second appel : adresse avec ?v= rangée au catalogue (sans fichier) ──
egal("catalogue : adresse avec ?v= rangée", await versionnerAuCatalogue(simule(200, { success: true, image_url: `${PROD}?v=42` }), "3400930292914", `${PROD}?v=42`), true);
egal("catalogue : corps { cip, image_url }, aucun fichier renvoyé", JSON.parse(appels.at(-1).options.body), { cip: "3400930292914", image_url: `${PROD}?v=42` });
egal("catalogue : refus sans erreur levée", await versionnerAuCatalogue(simule(500, { error: "DB update: x" }), "1", PROD), false);
egal("catalogue : réseau coupé sans erreur levée", await versionnerAuCatalogue(simule(0, {}, { jette: true }), "1", PROD), false);

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
