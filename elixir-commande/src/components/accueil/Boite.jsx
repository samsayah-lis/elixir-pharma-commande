// ── Boîte Elixir générée (produit sans photo) : la signature de la vitrine ──
// « 3d » : vrai volume CSS (face, tranche, dessus en preserve-3d), tête de gondole sur ordinateur seulement, dans un
// conteneur qui ne défile pas. « 25d » : face plane + tranche en parallélogramme (mobile, tablette, linéaire, mouvement
// réduit). Textes fournis par le serveur (boite) ; lumière fixe, aucune animation au repos. Décorative (aria-hidden).
import React from "react";
import { CroixElixir } from "../../icons.jsx";

export default function Boite({ boite = {}, cip, teinte, mode = "25d", taille = "grande" }) {
  const dosage = boite.dosage || "";
  const long = dosage.length > 9 ? " acc-boite-dosage--long" : dosage.length > 6 ? " acc-boite-dosage--moyen" : "";
  return (
    <div className={`acc-boite acc-boite--${mode} acc-boite--${taille}`} style={teinte ? { "--acc-teinte": teinte } : undefined} aria-hidden="true">
      <div className="acc-boite-corps">
        <div className="acc-boite-face">
          <span className="acc-boite-bandeau" />
          <span className="acc-boite-marque">{boite.marque}</span>
          {dosage ? <span className={`acc-boite-dosage num${long}`}>{dosage}</span> : <span className="acc-boite-dosage acc-boite-dosage--forme">{boite.forme || ""}</span>}
          {dosage && boite.forme && <span className="acc-boite-forme">{boite.forme}</span>}
          {boite.labo && <span className="acc-boite-labo">{boite.labo}</span>}
          <CroixElixir className="acc-boite-croix" taille={34} epaisseur={90} />
        </div>
        <div className="acc-boite-tranche">
          <span className="acc-boite-cip">{cip}</span>
          <span className="acc-boite-elixir">ELIXIR</span>
        </div>
        {mode === "3d" && <div className="acc-boite-dessus" />}
      </div>
    </div>
  );
}
