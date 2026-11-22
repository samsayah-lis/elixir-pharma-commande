// Node >= 18. Secret exclusivement dans l'environnement ; jamais dans les arguments.
// ELIXIR_SITE_URL=https://votre-site.example node scripts/alerte-admin-exemple.mjs
import { createHmac } from "node:crypto";

const secret = process.env.PUSH_ALERTE_ADMIN_SECRET || "";
if (secret.length < 32) throw new Error("PUSH_ALERTE_ADMIN_SECRET doit contenir au moins 32 caractères.");
const site = new URL(process.env.ELIXIR_SITE_URL || "");
if (site.protocol !== "https:" || site.username || site.password) throw new Error("ELIXIR_SITE_URL doit être une adresse HTTPS sans identifiants.");
const body = JSON.stringify({ titre: "Elixir Admin : alerte", corps: "Une question est à traiter dans le groupe des pharmacies.", tag: "question-groupe" });
const horodatage = String(Math.floor(Date.now() / 1000));
const signature = createHmac("sha256", secret).update(`${horodatage}.${body}`).digest("hex");
const reponse = await fetch(new URL("/.netlify/functions/push-alerte-admin", site), {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
  headers: { "Content-Type": "application/json", "X-Elixir-Horodatage": horodatage, "X-Elixir-Signature": `sha256=${signature}` }, body,
});
console.log(reponse.status, await reponse.json());
if (!reponse.ok) process.exitCode = 1;
