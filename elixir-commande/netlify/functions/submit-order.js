import { getCors } from "./cors.js";
// Soumet une commande au frontal PharmaML via l'API INFOSOFT
// POST https://pharmaml.elixirpharma.fr/commandes.php?U=admin&P=xxxx
// Format JSON : [{ identifiantPML, referenceCommande, lignes: [{ CIP, libelle, quantiteCommandee, quantiteLivree, prix }] }]

const PHARMAML_URL  = process.env.PHARMAML_URL  || "https://pharmaml.elixirpharma.fr";
const PHARMAML_USER = process.env.PHARMAML_USER || "admin";
const PHARMAML_PASS = process.env.PHARMAML_PASS || "";
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_KEY;

export const handler = async (event) => {
  const cors = getCors(event);
