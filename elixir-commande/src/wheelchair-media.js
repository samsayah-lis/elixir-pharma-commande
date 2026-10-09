// ── Photos et vidéos des gammes du menu d'aide au choix (fiches produit du fabricant) ──
// Images affichées depuis le site du fabricant (dhcare.fr, versions redimensionnées ~10-35 Ko, bandeau 160 Ko ;
// l'original, plus lourd, seulement à l'agrandissement) et vidéos YouTube chargées au clic.
// Fiches : …/fauteuil-roulant-manuel-invacare-action-2ng et …-action-2ng-transit-lite (09/10/2026).
// Une image qui ne répond plus est simplement masquée (ProductMedia).
const F = "https://www.dhcare.fr/sites/fr/files";
const pic = (file, itok, { full = true, style = "category_image_800x550" } = {}) => ({
  src: `${F}/styles/${style}/public/csv_migration/pictures/${file}?itok=${itok}`,
  full: full ? `${F}/csv_migration/pictures/${file}` : null,
});
const high = (file, itok, title, text) => ({ src: `${F}/styles/product_highlights/public/csv_migration/highlights/${file}?itok=${itok}`, title, text });

export const MEDIA = {
  fauteuil: {
    photos: [
      pic("MPIC011400_A2.jpg", "MZOKQ6Ao"),
      // originaux de ~2 Mo : agrandissement sur la version 800 px
      pic("MPIC001383_Action2_2.jpg", "3Qr4aPZ1", { full: false }),
      pic("MPIC001388_Action2_3.jpg", "Z0dy_LY4", { full: false }),
      pic("MPIC001393_Action2_4.jpg", "fPeE6WJ-", { full: false }),
    ],
    // pas de vidéo sur la fiche : présentation de la chaîne officielle du fabricant
    video: { youtube: "9Q0Y2BIRpBw", title: "Action 2NG — présentation (DHCare)" },
    highlights: [
      high("HIGH000744_010-c.jpg", "K95evHuN", "Repose-jambes standard", "Structure en acier et réglage en angle robuste ; articulation avec point de pivot à compensation."),
      high("HIGH002456_A2NG%20CV17.jpg", "66PIHFWL", "2 types de dossier", "Fixe ou inclinable par crémaillère, pour plus de confort."),
      high("HIGH002457_A2NG%20CV16.jpg", "Aeen62Df", "Simple et confortable", "16,2 kg, châssis aluminium pliant par croisillon : facile à manipuler et à transporter."),
    ],
  },
  transfert: {
    photos: [
      pic("MPIC017016_FR-Action2NG-Transit-Lite-2200x2200.jpg", "SAo2YA-w"),
      pic("MPIC017017_ACTION2%20NG%20TRANSIT%20LITE%20CV07.jpg", "gzkny70o"),
      pic("MPIC017018_ACTION2%20NG%20TRANSIT%20LITE%20CV01.jpg", "FPOzqHjw"),
      pic("MPIC017019_ACTION2%20NG%20TRANSIT%20LITE%20CV03.jpg", "Gqxgwnll"),
      pic("MPIC017020_ACTION2%20NG%20TRANSIT%20LITE%20BE04.jpg", "0XQ9uIXJ"),
      pic("MPIC017021_ACTION2%20NG%20TRANSIT%20LITE%20BE08.jpg", "4aiYODDd"),
      // bandeau 1600×550 : l'original a la même taille (plus lourd) ; vignette sur la version mobile
      { ...pic("MPIC017015_Action2NG-Transit-Lite-inspirational-V1.jpg", "vXd86IkO", { style: "slide_desktop", full: false }),
        thumb: `${F}/styles/slide_mobile/public/csv_migration/pictures/MPIC017015_Action2NG-Transit-Lite-inspirational-V1.jpg?itok=Zd8MzHOs` },
    ],
    video: { youtube: "dWoAdUsYdJY", title: "Invacare Action2 NG Transit Lite (DHCare France)" },
    highlights: [
      high("HIGH002992_FR-Action2NG-Transit-Lite-fold.jpg", "rNDEk2qr", "Compact", "Poids et taille du châssis réduits."),
      high("HIGH002993_FR-Action2NG-Transit-Lite-parking-brake.jpg", "1ORpKb2J", "Nouveau frein", "Frein de stationnement facilement accessible."),
      high("HIGH002994_Action2NG-Transit-Lite-backrestTopSection.jpg", "K3RbZe_V", "Confort supplémentaire", "Dossier en forme de Y."),
    ],
  },
};
