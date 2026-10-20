// Tests de « Ajouter une photo » (admin, page d'accueil) : node scripts/test-photo-manuelle.mjs
// Hors ligne, sans navigateur ni réseau : parties pures de src/components/photo-manuelle.js (contrôle du fichier, taille
// d'arrivée, anti-cache ?v=, adresse renvoyée, clés de rangement, lien au catalogue, dosages visés d'une famille, menus du
// catalogue, question avant l'envoi, état des lignes hors des composants) et envoi par product-upload-image avec un
// adminFetch simulé (corps envoyé, réponses de la fonction, messages d'erreur, second appel qui range l'adresse avec ?v= au
// catalogue). La réduction
// elle-même (canvas) se vérifie au banc, dans un vrai navigateur. L'adresse produite passe la règle des mises en avant
// du serveur (netlify/functions/_accueil-vedettes.js : https, 500 caractères au plus).
// Affichage vérifié (incident du 20/10/2026, stockage elixir-images privé : 400 « Bucket not found ») : verifierAffichage
// avec une fausse Image (chargée, en erreur, vide, muette → délai) ; motif lu dans la réponse du stockage avec un faux fetch
// (NoSuchBucket, NoSuchKey, 5xx, réseau coupé, hors ligne, 200) et messages de l'admin qui en découlent (jamais « pas
// public » deviné, produit du catalogue jamais « Rien n'a changé sur l'accueil ») ; photos notées illisibles
// (accueil/illisibles.js : une fois par adresse, notifications regroupées, motif, oubli ; nouveaux essais hors de la page
// avec faux minuteurs : 3 s, 30 s, 5 min, 15 min, 4 au plus, « online », retour sur l'onglet) ; contrôle dédoublonné ;
// « Vérifier de nouveau » (?v= neuf) ; sonde du stockage avant l'envoi d'un produit du catalogue (fichier témoin absent :
// NoSuchKey / NoSuchBucket ; aucune adresse connue : image témoin) ; envoi complet (envoyerEtVerifier) avec un faux
// product-upload-image qui compte les POST : illisible → rien de publié, sonde privée → 0 envoi, délai → rien dans le
// brouillon, affichée → publication ; ancienne photo du catalogue remise.
import { abonnerLignes, adresseRecue, auCatalogue, auStockage, avecVersion, baseStockage, ciblesFamille, CLE_SONDE, cleDuFichier, cleEnvoi, cleMiseEnAvant,
  controlerAffichage, controlerFichier, DELAI_AFFICHAGE, diagnostiquerStockage, dimensions, envoisEnCours, envoyerEtVerifier, envoyerPhoto, estPhotoEnvoyee,
  etatLigne, expliquerIllisible, illisibleCarPrive, liee, MAX_OCTETS, memeForme, MENUS_AVEC_PHOTOS, MENUS_CATALOGUE, MESSAGE_STOCKAGE_PRIVE, messageAvantEnvoi,
  messageNonAffichee, noterLigne, oublierAdressesConnues, portee, questionCatalogue, raisonIllisible, repartitionFamille, reverifierIllisibles, sonderStockage,
  stockageLisible, suivre, typeDuFichier, verifierAffichage, versionnerAuCatalogue } from "../src/components/photo-manuelle.js";
import { abonnerIllisibles, estIllisible, illisibles, lisible, motifIllisible, noterIllisible, oublierIllisible, preciserMotif, reglerIllisibles, relancerIllisibles,
  versionIllisibles } from "../src/components/accueil/illisibles.js";
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
egal("type déclaré hors norme image/jpg (Windows)", typeDuFichier(fichier("a.jpg", "image/jpg")), "image/jpeg");
egal("type déclaré hors norme image/pjpeg", typeDuFichier(fichier("a.jpg", "image/pjpeg")), "image/jpeg");
egal("type déclaré hors norme image/x-png", typeDuFichier(fichier("a.png", "image/x-png")), "image/png");
egal("type déclaré en capitales", typeDuFichier(fichier("a.jpg", "IMAGE/JPEG")), "image/jpeg");
egal("image d'un type inconnu nommée .jpg : extension (le décodage tranche)", typeDuFichier(fichier("a.jpg", "image/x-citrix-jpeg")), "image/jpeg");
egal("image d'un type inconnu sans extension connue : refusée", typeDuFichier(fichier("a.bmp", "image/bmp")), null);
egal("HEIC renommé .jpg : refusé", typeDuFichier(fichier("IMG_1.jpg", "image/heic")), null);
egal("SVG refusé", typeDuFichier(fichier("logo.svg", "image/svg+xml")), null);
egal(".jpg en image/jpg : accepté sans message", controlerFichier(fichier("a.jpg", "image/jpg")), null);
egal("15 Mo pile (15 000 000 octets) : acceptée", controlerFichier(fichier("a.png", "image/png", MAX_OCTETS)), null);
egal("15 Mo et 1 octet : jamais « (15 Mo) : 15 Mo au plus »", controlerFichier(fichier("a.png", "image/png", 15e6 + 1)), "Photo trop lourde (15,1 Mo) : 15 Mo au plus.");
egal("15 Mio + 20 Ko : 15,8 Mo comme le Finder", controlerFichier(fichier("a.png", "image/png", 15 * 1048576 + 20480)), "Photo trop lourde (15,8 Mo) : 15 Mo au plus.");
egal("16 000 000 octets : « 16 Mo » comme le Finder", controlerFichier(fichier("a.png", "image/png", 16e6)), "Photo trop lourde (16 Mo) : 15 Mo au plus.");
egal("plus de 15 Mo : refusé avec le poids", controlerFichier(fichier("a.png", "image/png", 23.4e6)), "Photo trop lourde (23,4 Mo) : 15 Mo au plus.");

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
egal("clé du fichier envoyé", cleDuFichier(`${PROD}?v=9`), "3400930292914");
egal("clé du fichier sur le banc", cleDuFichier("/banc-photos/elixir-images/products/accueil-3400930292914-mh0abc12.png?v=1"), "accueil-3400930292914-mh0abc12");
egal("clé : photo de la banque d'images", cleDuFichier("https://assets.medipim.fr/media/medium/abc.jpg"), null);
egal("clé : pas d'adresse", cleDuFichier(undefined), null);

// ── clés de rangement des mises en avant : jamais un CIP (catalogue intact), neuve à chaque envoi ──
const t0 = 1760950000000;
egal("produit", cleMiseEnAvant({ type: "produit", cip: "3400930303122" }, t0), `accueil-3400930303122-${t0.toString(36)}`);
egal("menu promo", cleMiseEnAvant({ type: "menu", menu_id: "1759327" }, t0), `accueil-menu-1759327-${t0.toString(36)}`);
egal("outil du site (docs/accueil.md § 7.8)", cleMiseEnAvant({ type: "outil", outil: "peremption" }, t0), `accueil-outil-peremption-${t0.toString(36)}`);
egal("caractères inattendus retirés", cleMiseEnAvant({ type: "menu", menu_id: "12/../x y" }, t0), `accueil-menu-12xy-${t0.toString(36)}`);
vrai("clé acceptée par la fonction et le banc", /^[\w-]{1,80}$/.test(cleMiseEnAvant({ type: "produit", cip: "34009302929141234" }, t0)));
vrai("deux envois : deux clés", cleMiseEnAvant({ type: "produit", cip: "1" }, t0) !== cleMiseEnAvant({ type: "produit", cip: "1" }, t0 + 1));

// ── lien au catalogue : lu dans accueil.photos (stable), jamais dans l'image_url du GET (cache, PATCH en cours) ──
const STO = "https://abcdefgh.supabase.co/storage/v1/object/public/elixir-images/products";
const MEDIPIM = "https://assets.medipim.fr/media/medium/c.jpg";
const OBESO = { key: "obeso", label: "Mounjaro / Wegovy" }, SAISIE = { key: "saisie", label: "Saisie de commande" };
vrai("Mounjaro (obeso), GET sans image_url, photo envoyée sous son CIP : liée au catalogue", liee({ cip: "3400930292914", image_url: null, menu: OBESO }, { "3400930292914": `${STO}/3400930292914.webp?v=1` }));
vrai("liée aussi quand le GET a déjà l'image_url", liee({ cip: "3400930292914", image_url: `${STO}/3400930292914.webp?v=1`, menu: OBESO }, { "3400930292914": `${STO}/3400930292914.webp?v=1` }));
vrai("sur le banc", liee({ cip: "3400930292914", menu: OBESO }, { "3400930292914": "/banc-photos/elixir-images/products/3400930292914.jpg?v=2" }));
egal("autre dosage avec la photo du dosage montré (accueil seul) : pas liée", liee({ cip: "3400930292907", menu: OBESO }, { "3400930292907": `${STO}/3400930292914.webp?v=1` }), false);
egal("clé « accueil-… » : pas liée", liee({ cip: "3400930292914", menu: OBESO }, { "3400930292914": `${STO}/accueil-3400930292914-mh0abc12.webp?v=1` }), false);
egal("photo de la banque d'images : pas liée", liee({ cip: "3400930292914", menu: OBESO }, { "3400930292914": MEDIPIM }), false);
egal("Saisie : jamais au catalogue", liee({ cip: "3400930199190", menu: SAISIE }, { "3400930199190": `${STO}/3400930199190.webp?v=1` }), false);
egal("sans photo d'ici", liee({ cip: "3400930292914", menu: OBESO }, {}), false);

// ── clé d'envoi : CIP (catalogue) pour un produit d'un menu du catalogue, sinon accueil seul ──
egal("Mounjaro (obeso) : son CIP", cleEnvoi({ cip: "3400930292914", menu: OBESO }, t0), "3400930292914");
egal("Dupixent (Saisie) : clé « accueil-… », catalogue intact", cleEnvoi({ cip: "3400930199190", menu: SAISIE }, t0), `accueil-3400930199190-${t0.toString(36)}`);
egal("sans menu : accueil seul", cleEnvoi({ cip: "3400930303122" }, t0), `accueil-3400930303122-${t0.toString(36)}`);

// ── dosages visés d'une ligne des plus commandés (photo envoyée une fois, pour le dosage montré) ──
const v = (cip, { img = null, forme = "KwikPen", menu = OBESO, libelle = cip } = {}) => ({ cip, image_url: img, boite: { forme }, menu, libelle });
const mounjaro = (opt = {}) => ({ ...v("B", opt.B), variantes: ["A", "B", "C", "D", "E"].map(c => v(c, opt[c])) });
egal("aucun dosage avec photo : tous, sans doublon du dosage montré", repartitionFamille(mounjaro(), {}), { cibles: ["B", "A", "C", "D", "E"], gardees: [] });
egal("dosage avec photo au catalogue (fiche produit) : gardé", repartitionFamille(mounjaro({ E: { img: `${STO}/E.jpg` } }), {}),
  { cibles: ["B", "A", "C", "D"], gardees: [{ cip: "E", libelle: "E", raison: "catalogue" }] });
egal("photo de la banque propre à un dosage : gardée", repartitionFamille(mounjaro(), { C: MEDIPIM }),
  { cibles: ["B", "A", "D", "E"], gardees: [{ cip: "C", libelle: "C", raison: "banque" }] });
egal("photo envoyée d'ici pour l'accueil seul : remplacée avec la famille", ciblesFamille(mounjaro(), { A: `${STO}/B.webp?v=1`, B: `${STO}/B.webp?v=1` }), ["B", "A", "C", "D", "E"]);
egal("dosage montré : toujours, même avec une photo de la banque", ciblesFamille(mounjaro(), { B: MEDIPIM }), ["B", "A", "C", "D", "E"]);
egal("dosage montré lié au catalogue (après rechargement) : remplacé avec les dosages de l'accueil seul",
  ciblesFamille(mounjaro({ B: { img: `${STO}/B.webp?v=1` } }), Object.fromEntries("ABCDE".split("").map(c => [c, `${STO}/B.webp?v=1`]))), ["B", "A", "C", "D", "E"]);
egal("autre dosage lié au catalogue (montré lors d'un envoi précédent), GET sans image_url : gardé, jamais réécrit",
  repartitionFamille(mounjaro(), { B: `${STO}/accueil-B-x.webp?v=2`, D: `${STO}/D.webp?v=1` }), { cibles: ["B", "A", "C", "E"], gardees: [{ cip: "D", libelle: "D", raison: "catalogue" }] });
egal("photo du catalogue d'ailleurs malgré une photo de la banque choisie ici : gardée", ciblesFamille(mounjaro({ C: { img: `${STO}/C.jpg` } }), { C: MEDIPIM }), ["B", "A", "D", "E"]);
// Dupixent : 300 mg stylo montré ; 200 mg (forme inconnue) la reçoit ; 300 mg seringue (autre forme) ne la reçoit pas
const dupixent = { ...v("STY", { forme: "Stylo prérempli", menu: SAISIE }), variantes: [v("200", { forme: null, menu: SAISIE, libelle: "200 mg" }),
  v("STY", { forme: "Stylo prérempli", menu: SAISIE, libelle: "300 mg · stylo" }), v("SER", { forme: "Seringue préremplie", menu: SAISIE, libelle: "300 mg · seringue" })] };
egal("autre forme de boîte (stylo / seringue) : gardée", repartitionFamille(dupixent, {}), { cibles: ["STY", "200"], gardees: [{ cip: "SER", libelle: "300 mg · seringue", raison: "forme" }] });
vrai("même forme", memeForme({ boite: { forme: "KwikPen" } }, { boite: { forme: " kwikpen " } }));
vrai("forme inconnue : même famille", memeForme({ boite: { forme: null } }, { boite: { forme: "Stylo prérempli" } }));
egal("formes différentes", memeForme({ boite: { forme: "Seringue préremplie" } }, { boite: { forme: "Stylo prérempli" } }), false);
egal("produit seul", ciblesFamille({ cip: "3400930303122", image_url: null }), ["3400930303122"]);

// ── question avant le premier envoi d'un produit du catalogue ──
egal("menu en grille, 5 autres dosages", questionCatalogue({ nom_court: "MOUNJARO 5mg", menu: OBESO }, 5),
  "Cette photo deviendra aussi celle de « MOUNJARO 5mg » dans le menu « Mounjaro / Wegovy » du catalogue et ne pourra plus en être retirée d'ici (seulement remplacée)."
  + "\n\nLes 5 autres dosages la reçoivent seulement sur l'accueil.\n\nContinuer ?");
egal("tableau sans photo (Sélection Expert), produit seul", questionCatalogue({ nom_court: "VENTOLINE", menu: { key: "expert", label: "Sélection Expert" } }, 0),
  "Cette photo deviendra aussi celle de « VENTOLINE » au catalogue (fiche du produit) et ne pourra plus en être retirée d'ici (seulement remplacée).\n\nContinuer ?");

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

// ── état des lignes et envois en cours : hors des composants (onglet quitté puis rouvert) ──
let vus = 0;
const desabonner = abonnerLignes(() => { vus++; });
noterLigne("B", { occupe: "envoi", message: "Envoi de la photo…" });
egal("état gardé hors du composant", [etatLigne("B").occupe, etatLigne("B").message, etatLigne("B").ton], ["envoi", "Envoi de la photo…", "neutral"]);
const n1 = etatLigne("B").n;
noterLigne("B", { message: "« a.pdf » n'est pas une photo JPG, PNG ou WebP : choisissez une photo.", ton: "danger" });
vrai("même refus répété : nouveau numéro (relu par le lecteur d'écran)", etatLigne("B").n > n1 && etatLigne("B").occupe === null);
desabonner();
noterLigne("B", {});
egal("abonnés prévenus, puis plus après désabonnement", vus, 2);
egal("ligne inconnue", etatLigne("Z"), null);
let liberer;
const enVol = suivre(new Promise(ok => { liberer = ok; }));
vrai("envoi en cours compté (confirmation avant de quitter l'admin)", envoisEnCours());
liberer("fini");
egal("résultat transmis", await enVol, "fini");
egal("plus rien en cours", envoisEnCours(), false);
await suivre(Promise.reject(new Error("x"))).catch(() => {});
egal("échec : plus rien en cours non plus", envoisEnCours(), false);

// ── affichage vérifié : fausse Image (le navigateur charge l'adresse ; aucune lecture de pixels, aucun CORS) ──
// comportement(adresse) → "ok" (chargée), "erreur" (400 du stockage privé), "vide" (0 × 0), "rien" (jamais de réponse)
const fausseImage = (comportement) => {
  const F = class { set src(u) { F.demandes.push(u); this.s = u; const c = comportement(u);
    if (c === "ok") setTimeout(() => { this.naturalWidth = 900; this.naturalHeight = 675; this.onload?.(); }, 1);
    else if (c === "erreur") setTimeout(() => this.onerror?.(), 1);
    else if (c === "vide") setTimeout(() => { this.naturalWidth = 0; this.naturalHeight = 0; this.onload?.(); }, 1);
    else if (c === "deux") setTimeout(() => { this.onerror?.(); this.naturalWidth = 1; this.naturalHeight = 1; this.onload?.(); }, 1); }
  get src() { return this.s; } };
  F.demandes = [];
  return F;
};
const SUPA = "https://jwhbmnytrcrflavqtihj.supabase.co/storage/v1/object/public/elixir-images/products";
const DEVANT = `${SUPA}/accueil-menu-1792060000000-mvgg7ayo.jpg?v=1792486536000`;   // la carte de devant de l'incident
egal("chargée : ok", await verifierAffichage(`${SUPA}/a.jpg`, { Img: fausseImage(() => "ok") }), "ok");
egal("stockage privé (400 « Bucket not found ») : illisible", await verifierAffichage(DEVANT, { Img: fausseImage(() => "erreur") }), "illisible");
egal("image de 0 × 0 : illisible", await verifierAffichage(`${SUPA}/a.jpg`, { Img: fausseImage(() => "vide") }), "illisible");
egal("aucune réponse : délai", await verifierAffichage(`${SUPA}/a.jpg`, { Img: fausseImage(() => "rien"), delai: 20 }), "delai");
egal("erreur puis chargement : la première réponse compte", await verifierAffichage(`${SUPA}/a.jpg`, { Img: fausseImage(() => "deux") }), "illisible");
egal("sans navigateur : inconnu", await verifierAffichage(`${SUPA}/a.jpg`, { Img: undefined }), "inconnu");
egal("Image qui lève une erreur : inconnu", await verifierAffichage(`${SUPA}/a.jpg`, { Img: class { set src(u) { throw new Error(u); } } }), "inconnu");
egal("pas d'adresse : inconnu", await verifierAffichage("", { Img: fausseImage(() => "ok") }), "inconnu");
const F1 = fausseImage(() => "ok");
await verifierAffichage(DEVANT, { Img: F1 });
egal("adresse chargée telle quelle (sans crossOrigin ni réécriture)", F1.demandes, [DEVANT]);
vrai("délai par défaut : 12 s", DELAI_AFFICHAGE === 12000);

const tic = (ms = 10) => new Promise(r => setTimeout(r, ms));

// ── réponse du stockage (diagnostic) : faux fetch ; le Storage répond en JSON, même en erreur (relevé du 20/10/2026) ──
const fauxFetch = (regle) => {
  const f = async (url, options) => {
    f.appels.push({ url, options });
    const r = regle(url);
    if (r === "jette") throw new TypeError("Failed to fetch");
    return { ok: r.statut >= 200 && r.statut < 300, status: r.statut, body: null, json: async () => { if (r.corps == null) throw new SyntaxError("x"); return r.corps; } };
  };
  f.appels = [];
  return f;
};
const PRIVE = { statut: 400, corps: { statusCode: "404", error: "Bucket not found", message: "Bucket not found", code: "NoSuchBucket" } };
const ABSENT = { statut: 400, corps: { statusCode: "404", error: "not_found", message: "Object not found", code: "NoSuchKey" } };
const OK200 = { statut: 200, corps: null }, PANNE = { statut: 503, corps: null };
egal("bucket privé (code NoSuchBucket)", await diagnostiquerStockage(DEVANT, { fetch: fauxFetch(() => PRIVE) }), "prive");
egal("ancien format sans code (« Bucket not found »)", await diagnostiquerStockage(DEVANT, { fetch: fauxFetch(() => ({ statut: 400, corps: { error: "Bucket not found" } })) }), "prive");
egal("fichier absent d'un bucket public (NoSuchKey) : jamais « privé »", await diagnostiquerStockage(DEVANT, { fetch: fauxFetch(() => ABSENT) }), "introuvable");
egal("panne du stockage (503)", await diagnostiquerStockage(DEVANT, { fetch: fauxFetch(() => PANNE) }), "panne");
egal("réseau coupé, proxy, bloqueur (TypeError)", await diagnostiquerStockage(DEVANT, { fetch: fauxFetch(() => "jette") }), "connexion");
const FH = fauxFetch(() => PRIVE);
egal("hors ligne : connexion, sans requête", [await diagnostiquerStockage(DEVANT, { fetch: FH, enLigne: () => false }), FH.appels.length], ["connexion", 0]);
egal("elle répond 200 : lisible (erreur passagère du navigateur)", await diagnostiquerStockage(DEVANT, { fetch: fauxFetch(() => OK200) }), "lisible");
egal("autre réponse : inconnu", await diagnostiquerStockage(DEVANT, { fetch: fauxFetch(() => ({ statut: 403, corps: {} })) }), "inconnu");
const FC = fauxFetch(() => PRIVE);
await diagnostiquerStockage(DEVANT, { fetch: FC });
egal("adresse lue telle quelle, sans cache", [FC.appels[0].url, FC.appels[0].options], [DEVANT, { cache: "no-store" }]);

// ── messages de l'admin : motif lu dans la réponse du stockage, jamais deviné ──
egal("affichée : aucun message", messageNonAffichee("ok", { url: DEVANT }), null);
egal("pas de navigateur pour vérifier : aucun message", messageNonAffichee("inconnu", { url: DEVANT }), null);
egal("stockage privé (motif lu) : message clair, pas de « ✓ Photo ajoutée »", messageNonAffichee("illisible", { url: DEVANT, diag: "prive" }),
  "Photo reçue, mais le site ne peut pas l'afficher : le stockage des photos (Supabase, « elixir-images ») n'est pas public. "
  + "C'est un réglage à faire une seule fois dans Supabase (voir docs/accueil.md, « Stockage des photos ») ; une fois fait, ajoutez de nouveau la photo. Rien n'a changé sur l'accueil.");
egal("fichier absent : jamais « pas public »", messageNonAffichee("illisible", { url: DEVANT, diag: "introuvable" }),
  "Photo reçue, mais elle est introuvable dans le stockage des photos : ajoutez-la de nouveau. Rien n'a changé sur l'accueil.");
egal("panne : réessayer plus tard", messageNonAffichee("illisible", { url: DEVANT, diag: "panne" }),
  "Photo reçue, mais le stockage des photos est momentanément indisponible : ajoutez-la de nouveau dans quelques minutes. Rien n'a changé sur l'accueil.");
egal("connexion perdue", messageNonAffichee("illisible", { url: DEVANT, diag: "connexion" }),
  "Photo reçue, mais la connexion a été perdue avant qu'elle s'affiche : vérifiez Internet, puis ajoutez-la de nouveau. Rien n'a changé sur l'accueil.");
vrai("motif inconnu : jamais « pas public »", !messageNonAffichee("illisible", { url: DEVANT }).includes("pas public"));
vrai("banc d'essai (stockage privé simulé, motif lu) : même message", messageNonAffichee("illisible", { url: "/banc-photos/elixir-images/products/a.jpg?v=1", diag: "prive" }).includes("n'est pas public"));
egal("délai : ajouter de nouveau quand la connexion le permet, rien n'a changé", messageNonAffichee("delai", { url: DEVANT }),
  "Photo reçue, mais elle ne s'est pas affichée en 12 secondes (connexion lente ?) : ajoutez-la de nouveau quand la connexion le permet. Rien n'a changé sur l'accueil.");
const CATA = `${SUPA}/3400930292914.webp?v=1`;
for (const [v, diag] of [["illisible", "panne"], ["illisible", "prive"], ["delai", null]]) {
  const m = messageNonAffichee(v, { url: CATA, catalogue: true, diag });
  vrai(`produit du catalogue (${v}${diag ? `, ${diag}` : ""}) : jamais « Rien n'a changé sur l'accueil » (sa fiche a reçu la photo)`, !m.includes("Rien n'a changé") && m.includes("déjà la photo du produit au catalogue"));
}
vrai("produit du catalogue, délai : pas de « ajoutez-la de nouveau » pour lui seul (la photo est rangée)", messageNonAffichee("delai", { url: CATA, catalogue: true }).includes("Pour la publier aussi sur l'accueil"));
vrai("produit du catalogue, ancienne photo remise : dit, et vrai (rien n'a changé sur l'accueil)",
  messageNonAffichee("illisible", { url: CATA, catalogue: true, diag: "panne", restauree: true }).endsWith("L'ancienne photo du produit a été remise au catalogue : rien n'a changé sur l'accueil."));
egal("autre hébergeur : pas d'image", messageNonAffichee("illisible", { url: "https://x.test/a.jpg" }), "Photo reçue, mais l'adresse renvoyée ne donne pas d'image : ajoutez-la de nouveau. Rien n'a changé sur l'accueil.");
egal("refus avant l'envoi (catalogue) : « Rien n'a été envoyé » quel que soit l'état", ["prive", "panne", "connexion", "delai", "inconnu"].map(e => messageAvantEnvoi(e).startsWith("Rien n'a été envoyé : ")), [true, true, true, true, true]);
egal("refus avant l'envoi, stockage privé : le réglage", messageAvantEnvoi("prive"), MESSAGE_STOCKAGE_PRIVE);
vrai("photo du stockage reconnue (Supabase et banc)", auStockage(DEVANT) && auStockage("/banc-photos/elixir-images/products/a.jpg") && !auStockage("https://assets.medipim.fr/media/medium/a.png"));

// ── photos notées illisibles (partagé avec l'accueil et l'aperçu) : une fois par adresse, notifications regroupées ──
let prevenus = 0;
const finAbonnement = abonnerIllisibles(() => { prevenus++; });
const v0 = versionIllisibles();
vrai("première erreur : notée", noterIllisible(DEVANT));
egal("même adresse en erreur de nouveau : ignorée", noterIllisible(DEVANT), false);
vrai("liste à jour tout de suite (lue au rendu)", estIllisible(DEVANT) && illisibles().has(DEVANT));
egal("abonnés pas encore prévenus (une notification par image affichée)", prevenus, 0);
noterIllisible(`${SUPA}/lot-2.jpg`); noterIllisible(`${SUPA}/lot-3.jpg`, "prive");
await tic();
egal("3 adresses notées d'un coup : abonnés prévenus une seule fois, version + 1", [prevenus, versionIllisibles() - v0], [1, 1]);
egal("lisible : null pour une adresse notée, l'adresse sinon", [lisible(DEVANT), lisible(`${SUPA}/b.jpg`), lisible(null)], [null, `${SUPA}/b.jpg`, null]);
egal("adresse vide : jamais notée", noterIllisible(""), false);
egal("motif gardé avec l'adresse", [motifIllisible(`${SUPA}/lot-3.jpg`), motifIllisible(`${SUPA}/lot-2.jpg`)], ["prive", null]);
vrai("motif précisé après coup : redessiné", preciserMotif(`${SUPA}/lot-2.jpg`, "introuvable") && !preciserMotif(`${SUPA}/lot-2.jpg`, "introuvable"));
await tic();
egal("… une notification de plus", prevenus, 2);
finAbonnement();

// ── motif de la photo illisible (« Photo illisible : … ») ──
egal("motif : autre hébergeur", raisonIllisible("https://assets.medipim.fr/media/medium/a.png"), "l'adresse ne donne plus d'image (photo retirée par son hébergeur, ou adresse erronée)");
vrai("motif lu « privé » : le réglage, avec la marche à suivre", raisonIllisible(`${SUPA}/lot-3.jpg`).startsWith("le stockage des photos (Supabase, « elixir-images ») n'est pas public") && raisonIllisible(`${SUPA}/lot-3.jpg`).includes("docs/accueil.md"));
vrai("motif lu « introuvable » : jamais « pas public »", raisonIllisible(`${SUPA}/lot-2.jpg`).startsWith("photo introuvable") && !raisonIllisible(`${SUPA}/lot-2.jpg`).includes("pas public"));
vrai("motif pas encore lu : jamais « pas public »", !raisonIllisible(DEVANT).includes("pas public"));
egal("bandeaux : renvoi au réglage seulement pour un motif « privé »", [illisibleCarPrive(`${SUPA}/lot-3.jpg`), illisibleCarPrive(`${SUPA}/lot-2.jpg`), illisibleCarPrive(DEVANT)], [true, false, false]);
const FE = fauxFetch(() => ABSENT);
const [m1, m2] = await Promise.all([expliquerIllisible(DEVANT, { fetch: FE }), expliquerIllisible(DEVANT, { fetch: FE })]);
egal("photo notée par une miniature : motif lu une fois (dédoublonné)", [m1, m2, motifIllisible(DEVANT), FE.appels.length], ["introuvable", "introuvable", "introuvable", 1]);

// ── contrôle des photos déjà choisies : une fois par adresse, miniature chargée (variante), adresse notée avec son motif ──
const F2 = fausseImage((u) => (u.includes("retiree") ? "erreur" : "ok"));
const PHOTO_BANQUE = "https://assets.medipim.fr/media/medium/retiree.png";
egal("photo retirée par la banque : illisible", await controlerAffichage(PHOTO_BANQUE, { variante: PHOTO_BANQUE.replace("medium", "thumbnail"), Img: F2 }), "illisible");
vrai("… notée sous son adresse (pas celle de la miniature)", estIllisible(PHOTO_BANQUE) && !estIllisible(PHOTO_BANQUE.replace("medium", "thumbnail")));
egal("… miniature, puis l'adresse elle-même avant de conclure", F2.demandes, [PHOTO_BANQUE.replace("medium", "thumbnail"), PHOTO_BANQUE]);
await controlerAffichage(PHOTO_BANQUE, { Img: F2 });
egal("contrôlée une seule fois (dédoublonné)", F2.demandes.length, 2);
const VIGNETTE_SEULE = "https://assets.medipim.fr/media/medium/sans-miniature.png";
egal("miniature seule en erreur (la photo s'affiche) : pas illisible", [await controlerAffichage(VIGNETTE_SEULE, { variante: VIGNETTE_SEULE.replace("medium", "thumbnail"),
  Img: fausseImage((u) => (u.includes("thumbnail") ? "erreur" : "ok")) }), estIllisible(VIGNETTE_SEULE)], ["ok", false]);
egal("photo qui s'affiche : pas notée", [await controlerAffichage(`${SUPA}/c.jpg`, { Img: fausseImage(() => "ok") }), estIllisible(`${SUPA}/c.jpg`)], ["ok", false]);
egal("photo du stockage illisible : notée avec le motif lu (bucket privé)", [await controlerAffichage(`${SUPA}/d.jpg`, { Img: fausseImage(() => "erreur"), fetch: fauxFetch(() => PRIVE) }), motifIllisible(`${SUPA}/d.jpg`)], ["illisible", "prive"]);
egal("photo du stockage en erreur passagère (elle répond 200 et s'affiche au nouvel essai) : pas notée",
  [await controlerAffichage(`${SUPA}/e.jpg?v=1`, { Img: fausseImage((u) => (u.endsWith("?v=1") ? "erreur" : "ok")), fetch: fauxFetch(() => OK200), t: 6 }), estIllisible(`${SUPA}/e.jpg?v=1`)], ["ok", false]);

// ── « Vérifier de nouveau » (réglage fait) : ?v= neuf pour le stockage, adresse oubliée si elle s'affiche, motif relu sinon ──
const F3 = fausseImage(() => "ok");
egal("après le réglage : redevenue lisible", await reverifierIllisibles([DEVANT], { Img: F3, t: 77 }), 1);
egal("redemandée avec un ?v= neuf (jamais une erreur gardée en cache)", F3.demandes, [`${SUPA}/accueil-menu-1792060000000-mvgg7ayo.jpg?v=77`]);
vrai("oubliée : elle se montre de nouveau partout (motif effacé)", !estIllisible(DEVANT) && motifIllisible(DEVANT) === null);
noterIllisible(DEVANT);
egal("toujours privé : reste notée, motif relu", [await reverifierIllisibles([DEVANT], { Img: fausseImage(() => "erreur"), fetch: fauxFetch(() => PRIVE) }), estIllisible(DEVANT), motifIllisible(DEVANT)], [0, true, "prive"]);
const F4 = fausseImage(() => "ok");
await reverifierIllisibles([PHOTO_BANQUE], { Img: F4, t: 5 });
egal("autre hébergeur : adresse redemandée telle quelle", F4.demandes, [PHOTO_BANQUE]);
egal("adresse jamais notée : rien à refaire", await reverifierIllisibles([`${SUPA}/jamais.jpg`], { Img: fausseImage(() => "ok") }), 0);
vrai("oublier une adresse non notée : sans effet", !oublierIllisible(`${SUPA}/jamais.jpg`));
// photo du stockage qui vient de s'afficher : les autres photos du stockage notées illisibles sont réessayées
const F7 = fausseImage(() => "ok");
egal("stockage lisible : les photos du stockage notées sont réessayées et redeviennent lisibles",
  [await stockageLisible(`${SUPA}/nouvelle.jpg?v=1`, { Img: F7, t: 8 }), estIllisible(DEVANT), F7.demandes.includes(`${SUPA}/accueil-menu-1792060000000-mvgg7ayo.jpg?v=8`)], [4, false, true]);
egal("photo d'un autre hébergeur : rien n'est réessayé", await stockageLisible("https://x.test/a.jpg"), 0);

// ── nouveaux essais d'une photo notée (erreur passagère : Wi-Fi, 502, stockage rendu public page ouverte) ──
// faux minuteurs (délais relevés), fausse Image (réponse au choix), faux réseau, horloge
const faux = new Map(); let nId = 0, horloge = 1e6, enLigneSim = true;
const prevus = () => [...faux.values()].map(m => m.ms).filter(ms => ms !== 20000).sort((a, b) => a - b);
const declencher = async (ms) => { for (const [id, m] of [...faux]) if (m.ms === ms) { faux.delete(id); m.f(); } await tic(); };
let reponse = () => "erreur";
const ImgEssai = fausseImage((u) => reponse(u));
const demandesDe = (u) => ImgEssai.demandes.filter(x => x === u).length;
reglerIllisibles({ Img: () => ImgEssai, minuteur: (f, ms) => { faux.set(++nId, { f, ms }); return nId; }, arret: (id) => { faux.delete(id); },
  maintenant: () => horloge, enLigne: () => enLigneSim });
const P = `${SUPA}/passagere.jpg?v=1`;
let vusEssais = 0;
const fin2 = abonnerIllisibles(() => { vusEssais++; });
noterIllisible(P);
egal("notée : un essai hors de la page prévu dans 3 s, aucune requête tout de suite", [prevus(), demandesDe(P)], [[3000], 0]);
reponse = () => "ok";
await declencher(3000);
egal("essai réussi : oubliée (la photo revient, sans recharger), abonnés prévenus", [estIllisible(P), demandesDe(P), vusEssais >= 2, prevus()], [false, 1, true, []]);
noterIllisible(P);
egal("notée de nouveau : les essais ne repartent pas de zéro (aucune boucle)", prevus(), [30000]);
oublierIllisible(P);
egal("oubliée : essai prévu annulé", prevus(), []);
const Q = `${SUPA}/cassee.jpg`;
reponse = () => "erreur";
noterIllisible(Q);
for (const d of [3000, 30000, 300000, 900000]) await declencher(d);
egal("4 essais en échec (3 s, 30 s, 5 min, 15 min) : reste notée, plus aucun essai prévu", [estIllisible(Q), demandesDe(Q), prevus()], [true, 4, []]);
const R = `${SUPA}/hors-ligne.jpg`;
enLigneSim = false;
noterIllisible(R);
egal("hors ligne : aucun essai prévu (rien n'est gâché)", prevus(), []);
enLigneSim = true; reponse = (u) => (u === R ? "ok" : "erreur");
relancerIllisibles("online");
await tic();
egal("réseau revenu (« online ») : essai immédiat, oubliée", [demandesDe(R), estIllisible(R)], [1, false]);
egal("… et un seul essai de plus pour l'adresse épuisée, sans suite", [demandesDe(Q), estIllisible(Q), prevus()], [5, true, []]);
horloge += 20e3;
relancerIllisibles("visible");
await tic();
egal("retour sur l'onglet moins d'une minute après : rien", demandesDe(Q), 5);
horloge += 61e3;
reponse = () => "ok";
relancerIllisibles("visible");
await tic();
egal("retour sur l'onglet plus tard (stockage rendu public entre-temps) : essai, la photo revient", [demandesDe(Q), estIllisible(Q)], [6, false]);
const S2 = `${SUPA}/muette.jpg`;
reponse = () => "rien";
noterIllisible(S2);
await declencher(3000);
await declencher(20000);   // garde : un essai sans réponse compte comme un échec
egal("essai sans réponse : compté comme un échec après 20 s, essai suivant prévu", [estIllisible(S2), prevus()], [true, [30000]]);
fin2();
reglerIllisibles();
faux.clear();

// ── sonde du stockage avant l'envoi d'un produit du catalogue (l'envoi écrit l'adresse dans sa fiche) ──
oublierAdressesConnues();
egal("aucune adresse du stockage connue : « aucune » (image témoin envoyée ensuite)", await sonderStockage(["https://assets.medipim.fr/a.png"], { fetch: fauxFetch(() => ABSENT) }), "aucune");
const FS = fauxFetch(() => ABSENT);
egal("bucket public : NoSuchKey sur un fichier témoin absent → public", await sonderStockage([`${SUPA}/3400930292914.webp?v=1`], { fetch: FS, t: 9 }), "public");
egal("… sondé sur un fichier qui n'existe pas, sans cache, jamais sur une photo existante", [FS.appels.map(a => a.url), FS.appels[0].options], [[`${SUPA}/__sonde-9.jpg`], { cache: "no-store" }]);
egal("bucket privé : NoSuchBucket → privé", await sonderStockage([`${SUPA}/3400930292914.webp?v=1`], { fetch: fauxFetch(() => PRIVE) }), "prive");
egal("photo connue supprimée depuis, bucket public : public (la sonde ne la relit pas)",
  await sonderStockage([`${SUPA}/accueil-supprimee.jpg?v=1`], { fetch: fauxFetch((u) => (u.includes("__sonde") ? ABSENT : PRIVE)) }), "public");
egal("panne / réseau coupé : jamais « public »", [await sonderStockage([CATA], { fetch: fauxFetch(() => PANNE) }), await sonderStockage([CATA], { fetch: fauxFetch(() => "jette") })], ["panne", "connexion"]);
egal("adresse d'un autre hôte contenant /elixir-images/ : jamais sondée", await sonderStockage(["https://autre.test/x/elixir-images/products/a.jpg"], { fetch: fauxFetch(() => ABSENT) }), "aucune");
egal("adresse du banc : sondée sur le banc seulement", [await sonderStockage(["/banc-photos/elixir-images/products/a.jpg"], { fetch: fauxFetch(() => ABSENT), dev: true }),
  await sonderStockage(["/banc-photos/elixir-images/products/a.jpg"], { fetch: fauxFetch(() => ABSENT), dev: false })], ["public", "aucune"]);
egal("base du stockage", [baseStockage(CATA), baseStockage("https://assets.medipim.fr/a.png")], ["https://jwhbmnytrcrflavqtihj.supabase.co/storage/v1/object/public/elixir-images/", null]);

// ── envoi complet (envoyerEtVerifier, partagé par les deux éditeurs) : faux product-upload-image qui compte les POST ──
const fonction = () => {
  const f = async (url, options) => {
    const b = JSON.parse(options.body);
    f.posts.push(b);
    if (f.refus) return { status: 401, ok: false, json: async () => ({ error: "Non autorisé" }) };
    return { status: 200, ok: true, json: async () => ({ success: true, image_url: b.image_url || `${SUPA}/${b.cip}.${b.mimeType === "image/png" ? "png" : "jpg"}` }) };
  };
  f.posts = [];
  return f;
};
const PRETE = { base64: "QUJD", mimeType: "image/jpeg" };
let publies = [];
const publier = (url) => { publies.push(url); return { ok: true }; };
const resume = (af) => af.posts.map(b => (b.image_url ? `adresse:${b.image_url}` : `photo:${b.cip}`));
const CIP_M = "3400930292914", MEDI = "https://assets.medipim.fr/media/medium/mounjaro.jpg";
const etapes = [];
// produit du catalogue, aucune adresse du stockage connue : image témoin d'abord
oublierAdressesConnues();
let af = fonction();
let r = await envoyerEtVerifier({ adminFetch: af, cle: CIP_M, prete: PRETE, t: 40, catalogue: { cip: CIP_M, ancienne: null }, candidats: [MEDI], publier, etape: (m) => etapes.push(m),
  Img: fausseImage(() => "ok"), fetch: fauxFetch(() => OK200) });
egal("catalogue sans adresse connue : image témoin (clé fixe, PNG 1 × 1) affichée → envoi, adresse ?v= au catalogue, puis publication",
  [af.posts.map(b => b.image_url ? "adresse" : `${b.cip}:${b.mimeType}`), publies, r.url], [["accueil-sonde:image/png", `${CIP_M}:image/jpeg`, "adresse"], [`${SUPA}/${CIP_M}.jpg?v=40`], `${SUPA}/${CIP_M}.jpg?v=40`]);
egal("… étapes annoncées dans l'ordre", etapes, ["Vérification du stockage des photos…", "Envoi de la photo…", "Vérification de l'affichage de la photo…"]);
oublierAdressesConnues(); publies = [];
af = fonction();
r = await envoyerEtVerifier({ adminFetch: af, cle: CIP_M, prete: PRETE, t: 41, catalogue: { cip: CIP_M, ancienne: null }, publier,
  Img: fausseImage((u) => (u.includes(CLE_SONDE) ? "erreur" : "ok")), fetch: fauxFetch(() => PRIVE) });
egal("catalogue sans adresse connue, image témoin illisible (bucket privé) : la photo n'est jamais envoyée, rien de publié",
  [resume(af), publies.length, r.message], [["photo:accueil-sonde"], 0, MESSAGE_STOCKAGE_PRIVE]);
// les quatre cas de la revue
publies = []; af = fonction();
r = await envoyerEtVerifier({ adminFetch: af, cle: "accueil-menu-1-a", prete: PRETE, t: 50, publier, Img: fausseImage(() => "erreur"), fetch: fauxFetch(() => PRIVE) });
egal("illisible (stockage privé) : 1 envoi, rien dans le brouillon, motif « pas public »", [af.posts.length, publies.length, r.url, r.ton, r.message.includes("n'est pas public")], [1, 0, undefined, "danger", true]);
publies = []; af = fonction();
r = await envoyerEtVerifier({ adminFetch: af, cle: CIP_M, prete: PRETE, t: 51, catalogue: { cip: CIP_M, ancienne: null }, candidats: [CATA], publier, Img: fausseImage(() => "ok"), fetch: fauxFetch(() => PRIVE) });
egal("produit du catalogue, sonde « privé » : 0 envoi, rien de publié", [af.posts.length, publies.length, r.message], [0, 0, MESSAGE_STOCKAGE_PRIVE]);
publies = []; af = fonction();
r = await envoyerEtVerifier({ adminFetch: af, cle: "accueil-1-b", prete: PRETE, t: 52, publier, Img: fausseImage(() => "rien"), delai: 20, fetch: fauxFetch(() => OK200) });
egal("délai : 1 envoi, rien dans le brouillon", [af.posts.length, publies.length, r.verdict], [1, 0, "delai"]);
publies = []; af = fonction();
r = await envoyerEtVerifier({ adminFetch: af, cle: "accueil-1-c", prete: PRETE, t: 53, publier, Img: fausseImage(() => "ok"), fetch: fauxFetch(() => OK200) });
egal("affichée : 1 envoi, puis publication de l'adresse ?v=", [af.posts.length, publies, r.url, r.publication], [1, [`${SUPA}/accueil-1-c.jpg?v=53`], `${SUPA}/accueil-1-c.jpg?v=53`, { ok: true }]);
// produit du catalogue : sonde publique, photo envoyée illisible (panne) → ancienne photo (autre fichier) remise
publies = []; af = fonction();
r = await envoyerEtVerifier({ adminFetch: af, cle: CIP_M, prete: PRETE, t: 54, catalogue: { cip: CIP_M, ancienne: MEDI }, candidats: [CATA], publier,
  Img: fausseImage(() => "erreur"), fetch: fauxFetch((u) => (u.includes("__sonde") ? ABSENT : PANNE)) });
egal("catalogue, photo envoyée illisible : son ancienne photo lui est remise, rien de publié, dit",
  [resume(af), publies.length, r.message.endsWith("L'ancienne photo du produit a été remise au catalogue : rien n'a changé sur l'accueil.")], [[`photo:${CIP_M}`, `adresse:${MEDI}`], 0, true]);
publies = []; af = fonction();
r = await envoyerEtVerifier({ adminFetch: af, cle: CIP_M, prete: PRETE, t: 55, catalogue: { cip: CIP_M, ancienne: `${SUPA}/${CIP_M}.jpg?v=3` }, candidats: [CATA], publier,
  Img: fausseImage(() => "erreur"), fetch: fauxFetch((u) => (u.includes("__sonde") ? ABSENT : PANNE)) });
egal("catalogue, ancienne photo = même fichier (écrasé) : rien à remettre, le message dit que la fiche a la nouvelle", [resume(af), r.message.includes("déjà la photo du produit au catalogue")], [[`photo:${CIP_M}`], true]);
publies = []; af = fonction();
r = await envoyerEtVerifier({ adminFetch: af, cle: CIP_M, prete: PRETE, t: 56, catalogue: { cip: CIP_M, ancienne: MEDI }, candidats: [CATA], publier,
  Img: fausseImage(() => "rien"), delai: 20, fetch: fauxFetch((u) => (u.includes("__sonde") ? ABSENT : OK200)) });
egal("catalogue, délai : l'ancienne photo n'est pas remise (la nouvelle est sans doute bonne)", [resume(af), publies.length], [[`photo:${CIP_M}`], 0]);
publies = []; af = fonction();
r = await envoyerEtVerifier({ adminFetch: af, cle: "accueil-1-d", prete: PRETE, t: 57, publier,
  Img: fausseImage((u) => (u.endsWith("?v=57") ? "erreur" : "ok")), fetch: fauxFetch(() => OK200) });
egal("erreur passagère (l'adresse répond 200) : nouvel essai avec un ?v= neuf, publiée", [publies, r.url], [[`${SUPA}/accueil-1-d.jpg?v=57`], `${SUPA}/accueil-1-d.jpg?v=57`]);
publies = []; af = fonction(); af.refus = true;
r = await envoyerEtVerifier({ adminFetch: af, cle: "accueil-1-e", prete: PRETE, t: 58, publier, Img: fausseImage(() => "ok"), fetch: fauxFetch(() => OK200) });
egal("envoi refusé (session expirée) : message de l'envoi, rien de publié", [r.message, publies.length], ["Session admin expirée : reconnectez-vous, puis recommencez.", 0]);

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
