// Tests de « Ajouter une photo » (admin, page d'accueil) : node scripts/test-photo-manuelle.mjs
// Hors ligne, sans navigateur ni réseau : parties pures de src/components/photo-manuelle.js (contrôle du fichier, taille
// d'arrivée, anti-cache ?v=, adresse renvoyée, clés de rangement, lien au catalogue, dosages visés d'une famille, menus du
// catalogue, question avant l'envoi, état des lignes hors des composants) et envoi par product-upload-image avec un
// adminFetch simulé (corps envoyé, réponses de la fonction, messages d'erreur, second appel qui range l'adresse avec ?v= au
// catalogue). La réduction
// elle-même (canvas) se vérifie au banc, dans un vrai navigateur. L'adresse produite passe la règle des mises en avant
// du serveur (netlify/functions/_accueil-vedettes.js : https, 500 caractères au plus).
// Affichage vérifié (incident du 20/10/2026, stockage elixir-images privé : 400 « Bucket not found ») : verifierAffichage
// avec une fausse Image (chargée, en erreur, vide, muette → délai), messages de l'admin (stockage privé, catalogue,
// délai), photos notées illisibles (accueil/illisibles.js : une fois par adresse, abonnés prévenus une fois, oubli),
// contrôle dédoublonné, « Vérifier de nouveau » (?v= neuf pour le stockage), sonde avant l'envoi d'un produit du catalogue.
import { abonnerLignes, adresseRecue, auCatalogue, auStockage, avecVersion, ciblesFamille, cleDuFichier, cleEnvoi, cleMiseEnAvant, controlerAffichage,
  controlerFichier, DELAI_AFFICHAGE, dimensions, envoisEnCours, envoyerPhoto, estPhotoEnvoyee, etatLigne, liee, MAX_OCTETS, memeForme, MENUS_AVEC_PHOTOS,
  MENUS_CATALOGUE, MESSAGE_STOCKAGE_PRIVE, messageNonAffichee, noterEchecStockage, noterLigne, portee, questionCatalogue, raisonIllisible, repartitionFamille,
  reverifierIllisibles, sonderStockage, stockageLisible, suivre, typeDuFichier, verifierAffichage, versionnerAuCatalogue } from "../src/components/photo-manuelle.js";
import { abonnerIllisibles, estIllisible, illisibles, lisible, noterIllisible, oublierIllisible, versionIllisibles } from "../src/components/accueil/illisibles.js";
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

// ── messages de l'admin ──
egal("affichée : aucun message", messageNonAffichee("ok", { url: DEVANT }), null);
egal("pas de navigateur pour vérifier : aucun message", messageNonAffichee("inconnu", { url: DEVANT }), null);
egal("stockage privé : message clair, pas de « ✓ Photo ajoutée »", messageNonAffichee("illisible", { url: DEVANT }),
  "Photo reçue, mais le site ne peut pas l'afficher : le stockage des photos (Supabase, « elixir-images ») n'est pas public. "
  + "C'est un réglage à faire une seule fois dans Supabase (voir docs/accueil.md, « Stockage des photos ») ; une fois fait, ajoutez de nouveau la photo. Rien n'a changé sur l'accueil.");
vrai("produit du catalogue : la fiche a déjà reçu l'adresse, la photo y apparaîtra après le réglage",
  messageNonAffichee("illisible", { url: `${SUPA}/3400930292914.webp?v=1`, catalogue: true }).endsWith("la photo y apparaîtra d'elle-même une fois le réglage fait."));
vrai("banc d'essai (stockage privé simulé) : même message", messageNonAffichee("illisible", { url: "/banc-photos/elixir-images/products/a.jpg?v=1" }).includes("n'est pas public"));
egal("délai : réessayer, rien n'a changé", messageNonAffichee("delai", { url: DEVANT }),
  "Photo reçue, mais elle ne s'est pas affichée en 12 secondes (connexion lente ?) : ajoutez-la de nouveau. Rien n'a changé sur l'accueil.");
egal("autre hébergeur : pas d'image", messageNonAffichee("illisible", { url: "https://x.test/a.jpg" }), "Photo reçue, mais l'adresse renvoyée ne donne pas d'image : ajoutez-la de nouveau. Rien n'a changé sur l'accueil.");
vrai("refus avant l'envoi (catalogue, stockage privé) : rien n'a été envoyé", MESSAGE_STOCKAGE_PRIVE.startsWith("Rien n'a été envoyé : le stockage des photos"));
vrai("photo du stockage reconnue (Supabase et banc)", auStockage(DEVANT) && auStockage("/banc-photos/elixir-images/products/a.jpg") && !auStockage("https://assets.medipim.fr/media/medium/a.png"));
vrai("motif : stockage pas public, avec la marche à suivre", raisonIllisible(DEVANT).startsWith("le stockage des photos (Supabase, « elixir-images ») n'est pas public") && raisonIllisible(DEVANT).includes("docs/accueil.md"));
egal("motif : autre hébergeur", raisonIllisible("https://assets.medipim.fr/media/medium/a.png"), "l'adresse ne donne plus d'image (photo retirée par son hébergeur, ou adresse erronée)");

// ── photos notées illisibles (partagé avec l'accueil et l'aperçu) : une fois par adresse, jamais de boucle ──
let prevenus = 0;
const finAbonnement = abonnerIllisibles(() => { prevenus++; });
const v0 = versionIllisibles();
vrai("première erreur : notée", noterIllisible(DEVANT));
egal("même adresse en erreur de nouveau : ignorée (aucun nouveau rendu)", [noterIllisible(DEVANT), prevenus, versionIllisibles() - v0], [false, 1, 1]);
egal("lisible : null pour une adresse notée, l'adresse sinon", [lisible(DEVANT), lisible(`${SUPA}/b.jpg`), lisible(null)], [null, `${SUPA}/b.jpg`, null]);
vrai("ensemble partagé", illisibles().has(DEVANT) && estIllisible(DEVANT) && !estIllisible(undefined));
egal("adresse vide : jamais notée", noterIllisible(""), false);
finAbonnement();

// ── contrôle des photos déjà choisies : une fois par adresse, miniature chargée (variante), adresse notée ──
const F2 = fausseImage((u) => (u.includes("thumbnail") ? "erreur" : "ok"));
const PHOTO_BANQUE = "https://assets.medipim.fr/media/medium/retiree.png";
egal("photo retirée par la banque : illisible", await controlerAffichage(PHOTO_BANQUE, { variante: PHOTO_BANQUE.replace("medium", "thumbnail"), Img: F2 }), "illisible");
vrai("… notée sous son adresse (pas celle de la miniature)", estIllisible(PHOTO_BANQUE) && !estIllisible(PHOTO_BANQUE.replace("medium", "thumbnail")));
await controlerAffichage(PHOTO_BANQUE, { Img: F2 });
egal("contrôlée une seule fois (dédoublonné)", F2.demandes.length, 1);
egal("photo qui s'affiche : pas notée", [await controlerAffichage(`${SUPA}/c.jpg`, { Img: fausseImage(() => "ok") }), estIllisible(`${SUPA}/c.jpg`)], ["ok", false]);

// ── « Vérifier de nouveau » (réglage fait) : ?v= neuf pour le stockage, adresse oubliée si elle s'affiche ──
const F3 = fausseImage(() => "ok");
egal("après le réglage : redevenue lisible", await reverifierIllisibles([DEVANT], { Img: F3, t: 77 }), 1);
egal("redemandée avec un ?v= neuf (jamais une erreur gardée en cache)", F3.demandes, [`${SUPA}/accueil-menu-1792060000000-mvgg7ayo.jpg?v=77`]);
vrai("oubliée : elle se montre de nouveau partout", !estIllisible(DEVANT));
noterIllisible(DEVANT);
egal("toujours privé : reste notée", [await reverifierIllisibles([DEVANT], { Img: fausseImage(() => "erreur") }), estIllisible(DEVANT)], [0, true]);
const F4 = fausseImage(() => "ok");
await reverifierIllisibles([PHOTO_BANQUE], { Img: F4, t: 5 });
egal("autre hébergeur : adresse redemandée telle quelle", F4.demandes, [PHOTO_BANQUE]);
egal("adresse jamais notée : rien à refaire", await reverifierIllisibles([`${SUPA}/jamais.jpg`], { Img: fausseImage(() => "ok") }), 0);
vrai("oublier une adresse non notée : sans effet", !oublierIllisible(`${SUPA}/jamais.jpg`));

// ── sonde du stockage avant l'envoi d'un produit du catalogue (l'envoi écrit l'adresse dans sa fiche) ──
egal("aucune photo du stockage connue : inconnu (envoi, vérifié ensuite)", await sonderStockage(["https://assets.medipim.fr/a.png"], { Img: fausseImage(() => "ok") }), "inconnu");
const F5 = fausseImage(() => "erreur");
egal("photo publiée qui répond 400 : privé (rien n'est envoyé)", await sonderStockage([`${SUPA}/3400930292914.webp?v=1`], { Img: F5, t: 9 }), "prive");
egal("sondée avec un ?v= neuf", F5.demandes, [`${SUPA}/3400930292914.webp?v=9`]);
noterEchecStockage(`${SUPA}/accueil-1-x.jpg?v=3`);
const F6 = fausseImage(() => "ok");
egal("dernier envoi non affiché de la session : sondé en premier ; public", await sonderStockage([`${SUPA}/3400930292914.webp?v=1`], { Img: F6, t: 4 }), "public");
egal("… c'est bien lui qui a été sondé", F6.demandes, [`${SUPA}/accueil-1-x.jpg?v=4`]);
egal("sans réponse : inconnu (envoi, vérifié ensuite)", await sonderStockage([`${SUPA}/a.jpg`], { Img: fausseImage(() => "rien"), delai: 20 }), "inconnu");
// photo du stockage qui vient de s'afficher : les autres photos du stockage notées illisibles sont réessayées
noterIllisible(DEVANT);
const F7 = fausseImage(() => "ok");
egal("stockage lisible : les photos du stockage notées sont réessayées et redeviennent lisibles",
  [await stockageLisible(`${SUPA}/nouvelle.jpg?v=1`, { Img: F7, t: 8 }), estIllisible(DEVANT), F7.demandes], [1, false, [`${SUPA}/accueil-menu-1792060000000-mvgg7ayo.jpg?v=8`]]);
egal("photo d'un autre hébergeur : rien n'est réessayé", await stockageLisible("https://x.test/a.jpg"), 0);

console.log(`${ok} OK, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
