// Import one-shot Mölnlycke
// GET /.netlify/functions/molnlycke-import?token=elixir2026
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

const PRODUCTS = [
  {
    "cip": "7323190273690",
    "name": "Exufiber 5cm x 10cm (forme plaque)",
    "pv": 11.27,
    "pct": 10.0,
    "pn": 10.14,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7333350350543",
    "name": "Exufiber 10cm x 10cm (forme plaque)",
    "pv": 22.7,
    "pct": 10.0,
    "pn": 20.43,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190273706",
    "name": "Exufiber 12cm x 13cm (forme plaque)",
    "pv": 34.45,
    "pct": 10.0,
    "pn": 31.01,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190273713",
    "name": "Exufiber 10cm x 20cm (forme plaque)",
    "pv": 45.52,
    "pct": 10.0,
    "pn": 40.97,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190273720",
    "name": "Exufiber 20cm x 20cm (forme plaque)",
    "pv": 68.58,
    "pct": 10.0,
    "pn": 61.72,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190213795",
    "name": "Exufiber 20cm x 30cm (forme plaque)",
    "pv": 102.76,
    "pct": 10.0,
    "pn": 92.48,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190273737",
    "name": "Exufiber 2,5cm x 40cm (forme mèche)",
    "pv": 22.7,
    "pct": 10.0,
    "pn": 20.43,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190273744",
    "name": "Exufiber 5cm x 40cm (forme mèche)",
    "pv": 45.52,
    "pct": 10.0,
    "pn": 40.97,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190177639",
    "name": "Melgisorb Plus 10 cm x 12 cm",
    "pv": 18.62,
    "pct": 10.0,
    "pn": 16.76,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190042296",
    "name": "Melgisorb Plus 10 cm x 20 cm",
    "pv": 30.11,
    "pct": 10.0,
    "pn": 27.1,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190042319",
    "name": "Melgisorb Plus 1 Mèche : 3 cm x 45 cm",
    "pv": 18.62,
    "pct": 10.0,
    "pn": 16.76,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190180783",
    "name": "Mextra Superabsorbant 12,5 cm x 12,5 cm",
    "pv": 22.54,
    "pct": 10.0,
    "pn": 20.29,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190224654",
    "name": "Mextra Superabsorbant 12,5 cm x 22,5 cm",
    "pv": 31.55,
    "pct": 10.0,
    "pn": 28.39,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190098187",
    "name": "Mextra Superabsorbant 17,5 cm x 22,5 cm",
    "pv": 42.06,
    "pct": 10.0,
    "pn": 37.85,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190098163",
    "name": "Mextra Superabsorbant 22,5 cm x 27,5 cm",
    "pv": 76.77,
    "pct": 10.0,
    "pn": 69.09,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190224708",
    "name": "Mextra Superabsorbant 22,5 cm x 42,5 cm",
    "pv": 76.77,
    "pct": 10.0,
    "pn": 69.09,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7333350935825",
    "name": "Mepiform 4 cm x 30 cm",
    "pv": 33.92,
    "pct": 10.0,
    "pn": 30.53,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7333350488376",
    "name": "Mepiform 5 cm x 7,5 cm",
    "pv": 18.81,
    "pct": 10.0,
    "pn": 16.93,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7333350274443",
    "name": "Mepiform 10 cm x 18 cm",
    "pv": 43.23,
    "pct": 10.0,
    "pn": 38.91,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7333350117085",
    "name": "Mepitel 5 cm x 7,5 cm",
    "pv": 7.11,
    "pct": 10.0,
    "pn": 6.4,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7333350359386",
    "name": "Mepitel 7,5 cm x 10 cm",
    "pv": 13.6,
    "pct": 10.0,
    "pn": 12.24,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7310792910108",
    "name": "Mepitel 10 cm x 18 cm",
    "pv": 32.78,
    "pct": 10.0,
    "pn": 29.5,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332430485557",
    "name": "Mepitel 20 cm x 31 cm",
    "pv": 59.54,
    "pct": 10.0,
    "pn": 53.59,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332551023720",
    "name": "Mepitel One 5 cm x 7,5 cm",
    "pv": 7.11,
    "pct": 10.0,
    "pn": 6.4,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7333350974435",
    "name": "Mepitel One 7,5 cm x 10 cm",
    "pv": 13.6,
    "pct": 10.0,
    "pn": 12.24,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332551023768",
    "name": "Mepitel One 10 cm x 18 cm",
    "pv": 32.78,
    "pct": 10.0,
    "pn": 29.5,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7333350337353",
    "name": "Mepitel One 24 cm x 27,5 cm",
    "pv": 63.35,
    "pct": 10.0,
    "pn": 57.02,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190180769",
    "name": "Mepilex Transfer 7,5 cm x 8,5 cm",
    "pv": 9.52,
    "pct": 10.0,
    "pn": 8.57,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190180776",
    "name": "Mepilex Transfer 14 cm x 15 cm",
    "pv": 29.34,
    "pct": 10.0,
    "pn": 26.41,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332430872128",
    "name": "Mepilex Transfer 17,5 cm x 17,5 cm",
    "pv": 42.68,
    "pct": 10.0,
    "pn": 38.41,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190123582",
    "name": "Mepilex XT 14 cm x 15 cm",
    "pv": 43.79,
    "pct": 10.0,
    "pn": 39.41,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190123551",
    "name": "Mepilex XT 10 cm x 21 cm",
    "pv": 34.15,
    "pct": 10.0,
    "pn": 30.73,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190123568",
    "name": "Mepilex XT 17,5 cm x 17,5 cm",
    "pv": 45.5,
    "pct": 10.0,
    "pn": 40.95,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190123575",
    "name": "Mepilex XT 21 cm x 22 cm",
    "pv": 65.64,
    "pct": 10.0,
    "pn": 59.08,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7333350497019",
    "name": "Mepilex Up 14 cm x 15 cm",
    "pv": 31.28,
    "pct": 10.0,
    "pn": 28.15,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7333350465346",
    "name": "Mepilex Up 10 cm x 21 cm",
    "pv": 31.28,
    "pct": 10.0,
    "pn": 28.15,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7333350675981",
    "name": "Mepilex Up 17,5 cm x 17,5 cm",
    "pv": 45.5,
    "pct": 10.0,
    "pn": 40.95,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7333350797881",
    "name": "Mepilex Up 21 cm x 22 cm",
    "pv": 65.64,
    "pct": 10.0,
    "pn": 59.08,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332430727572",
    "name": "Mepilex Talon 13 cm x 21 cm",
    "pv": 36.63,
    "pct": 10.0,
    "pn": 32.97,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332551617998",
    "name": "Mepilex Talon 15 cm x 22 cm",
    "pv": 44.48,
    "pct": 10.0,
    "pn": 40.03,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7333350020477",
    "name": "Mepilex e.m. 7,5 cm x 8,5 cm",
    "pv": 9.52,
    "pct": 10.0,
    "pn": 8.57,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190180752",
    "name": "Mepilex e.m. 14 cm x 15 cm",
    "pv": 29.34,
    "pct": 10.0,
    "pn": 26.41,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7333350062569",
    "name": "Mepilex e.m. 17,5 cm x 17,5 cm",
    "pv": 42.68,
    "pct": 10.0,
    "pn": 38.41,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190196562",
    "name": "Mepilex Border Flex Carré 7,5 cm x 8,5 cm (Compresse : 4,5 cm x 4,5 cm)",
    "pv": 13.01,
    "pct": 10.0,
    "pn": 11.71,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190250561",
    "name": "Mepilex Border Flex Carré 10 cm x 10 cm (Compresse : 6,5 cm x 6,5 cm)",
    "pv": 20.65,
    "pct": 10.0,
    "pn": 18.59,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190196555",
    "name": "Mepilex Border Flex Carré 14 cm x 15 cm (Compresse : 10 cm x 11 cm)",
    "pv": 40.06,
    "pct": 10.0,
    "pn": 36.05,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190196579",
    "name": "Mepilex Border Flex Carré 17,5 cm x 17,5 cm (Compresse : 11 cm x 11 cm)",
    "pv": 41.64,
    "pct": 10.0,
    "pn": 37.48,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190196586",
    "name": "Mepilex Border Flex Carré 17,5 cm x 23 cm (Compresse : 11 cm x 16 cm)",
    "pv": 53.85,
    "pct": 10.0,
    "pn": 48.47,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7333350070717",
    "name": "Mepilex Border Flex Oval 7,8 cm x10 cm (Compresse : 3,5 cm x 5,5 cm)",
    "pv": 13.01,
    "pct": 10.0,
    "pn": 11.71,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190220465",
    "name": "Mepilex Border Flex Oval 13,5 cm x 16,5 cm (Compresse : 9 cm x 12 cm)",
    "pv": 31.25,
    "pct": 10.0,
    "pn": 28.12,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7333350546625",
    "name": "Mepilex Border Flex Oval 15 cm x 19 cm (Compresse : 11 cm x 15,4 cm)",
    "pv": 40.06,
    "pct": 10.0,
    "pn": 36.05,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7333350643645",
    "name": "Mepilex Border Flex Oval 18 cm x 22 cm (Compresse : 13 cm x 17,2 cm)",
    "pv": 41.64,
    "pct": 10.0,
    "pn": 37.48,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190234646",
    "name": "Mepilex Border Flex EM 5 cm x 5 cm (Compresse : 3 cm x 3 cm)",
    "pv": 3.46,
    "pct": 10.0,
    "pn": 3.11,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190234653",
    "name": "Mepilex Border Flex EM 6 cm x 12 cm (Compresse : 3 cm x 8 cm )",
    "pv": 8.72,
    "pct": 10.0,
    "pn": 7.85,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190234660",
    "name": "Mepilex Border Flex EM 9 cm x 15 cm  (Compresse : 4,5 cm x 10 cm)",
    "pv": 16.1,
    "pct": 10.0,
    "pn": 14.49,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190234677",
    "name": "Mepilex Border Flex EM 10 cm x 20 cm (Compresse : 5 cm x 15 cm)",
    "pv": 26.84,
    "pct": 10.0,
    "pn": 24.16,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190204922",
    "name": "Mepilex Border Flex 10 cm x 25 cm (Compresse : 5 cm x 20 cm)",
    "pv": 31.23,
    "pct": 10.0,
    "pn": 28.11,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190204939",
    "name": "Mepilex Border Flex 10 cm x 30 cm (Compresse : 5 cm x 25 cm)",
    "pv": 41.64,
    "pct": 10.0,
    "pn": 37.48,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190244676",
    "name": "Mepilex Border Sacrum Protect 16 cm x 20 cm",
    "pv": 35.59,
    "pct": 10.0,
    "pn": 32.03,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190218189",
    "name": "Mepilex Border Sacrum Protect 22 cm x 25 cm",
    "pv": 58.83,
    "pct": 10.0,
    "pn": 52.95,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190218196",
    "name": "Mepilex Border Talon Protect 22 cm x 23 cm",
    "pv": 61.61,
    "pct": 10.0,
    "pn": 55.45,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332430931993",
    "name": "Mepilex Ag 12,5 cm x 12,5 cm",
    "pv": 14.63,
    "pct": 10.0,
    "pn": 13.17,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332551971373",
    "name": "Mepilex Border Ag 7,5 cm x 8,5 cm (Compresse : 4,5 cm x 4,5 cm)",
    "pv": 18.57,
    "pct": 10.0,
    "pn": 16.71,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332551974367",
    "name": "Mepitel Film  10,5 cm x 12 cm",
    "pv": 7.88,
    "pct": 10.0,
    "pn": 7.09,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332551974381",
    "name": "Mepitel Film  10,5 cm x 25 cm",
    "pv": 9.68,
    "pct": 10.0,
    "pn": 8.71,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332551974404",
    "name": "Mepitel Film  15,5 cm x 20 cm",
    "pv": 11.39,
    "pct": 10.0,
    "pn": 10.25,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332551879464",
    "name": "Tubifast with 2-Way Stretch 7,5 cm x 10 m (ligne bleue)  circonf. 24 - 40 cm",
    "pv": 6.32,
    "pct": 10.0,
    "pn": 5.69,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332551879518",
    "name": "Tubifast with 2-Way Stretch 10,75 cm x 10 m (ligne jaune) circonf. 35 - 64 cm",
    "pv": 7.37,
    "pct": 10.0,
    "pn": 6.63,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332551880132",
    "name": "Tubifast with 2-Way Stretch 20 cm x 10 m (ligne violette) circonf. 64 - 130 cm",
    "pv": 11.7,
    "pct": 10.0,
    "pn": 10.53,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "5055158008403",
    "name": "Tubifast with 2-Way Stretch 3,5 cm x 1 m (ligne rouge) circonf. 9-18 cm",
    "pv": 1.16,
    "pct": 10.0,
    "pn": 1.04,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "5055158008441",
    "name": "Tubifast with 2-Way Stretch 5 cm x 1 m (ligne verte) circonf. 14-24 cm",
    "pv": 1.16,
    "pct": 10.0,
    "pn": 1.04,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "5055158000759",
    "name": "Tubifast Garments with 2-Way Stretch Tee-shirt 6-24 mois (+ moufles) - Taille de 74 à 86 cm",
    "pv": 14.2,
    "pct": 10.0,
    "pn": 12.78,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "5055158000766",
    "name": "Tubifast Garments with 2-Way Stretch Tee-shirt 2-5 ans - Taille de 86 à 110 cm",
    "pv": 18.92,
    "pct": 10.0,
    "pn": 17.03,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "5055158000773",
    "name": "Tubifast Garments with 2-Way Stretch Tee-shirt 5-8 ans - Taille de 110 à 128 cm",
    "pv": 21.0,
    "pct": 10.0,
    "pn": 18.9,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "5055158000780",
    "name": "Tubifast Garments with 2-Way Stretch Tee-shirt 8-11 ans - Taille de 128 à 146 cm",
    "pv": 23.65,
    "pct": 10.0,
    "pn": 21.29,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "5055158000797",
    "name": "Tubifast Garments with 2-Way Stretch Tee-shirt 11-14 ans - Taille de 146 à 164 cm",
    "pv": 23.65,
    "pct": 10.0,
    "pn": 21.29,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "5055158000704",
    "name": "Tubifast Garments with 2-Way Stretch Collants 6-24 mois - Taille de 74 à 86 cm",
    "pv": 14.2,
    "pct": 10.0,
    "pn": 12.78,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "5055158000711",
    "name": "Tubifast Garments with 2-Way Stretch Leggings 2-5 ans - Taille de 86 à 110 cm",
    "pv": 18.92,
    "pct": 10.0,
    "pn": 17.03,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "5055158000728",
    "name": "Tubifast Garments with 2-Way Stretch Leggings 5-8 ans - Taille de 110 à 128 cm",
    "pv": 21.29,
    "pct": 10.0,
    "pn": 19.16,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "5055158000735",
    "name": "Tubifast Garments with 2-Way Stretch Leggings 8-11 ans - Taille de 128 à 146 cm",
    "pv": 23.65,
    "pct": 10.0,
    "pn": 21.29,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "5055158000742",
    "name": "Tubifast Garments with 2-Way Stretch Leggings 11-14 ans - Taille de 146 à 164 cm",
    "pv": 23.65,
    "pct": 10.0,
    "pn": 21.29,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "5055158001268",
    "name": "Tubifast Garments with 2-Way Stretch Chaussettes - Taille Unique 2 à 14 ans (1 paire)",
    "pv": 5.92,
    "pct": 10.0,
    "pn": 5.33,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332551870706",
    "name": "Tubifast Gloves with 2-Way Stretch Enfants XS (1 paire)",
    "pv": 6.81,
    "pct": 10.0,
    "pn": 6.13,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332551896126",
    "name": "Tubifast Gloves with 2-Way Stretch Enfants S (1 paire)",
    "pv": 6.81,
    "pct": 10.0,
    "pn": 6.13,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332551870652",
    "name": "Tubifast Gloves with 2-Way Stretch Enfants M-L/adulte S (1 paire)",
    "pv": 6.81,
    "pct": 10.0,
    "pn": 6.13,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332551870607",
    "name": "Tubifast Gloves with 2-Way Stretch Adulte M-L (1 paire)",
    "pv": 6.81,
    "pct": 10.0,
    "pn": 6.13,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190254187",
    "name": "Mesorb 10 cm x 10 cm",
    "pv": 3.51,
    "pct": 10.0,
    "pn": 3.16,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190254200",
    "name": "Mesorb 10 cm x 20 cm",
    "pv": 6.21,
    "pct": 10.0,
    "pn": 5.59,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190254217",
    "name": "Mesorb 15 cm x 20 cm",
    "pv": 8.9,
    "pct": 10.0,
    "pn": 8.01,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190254224",
    "name": "Mesorb 20 cm x 25 cm",
    "pv": 14.29,
    "pct": 10.0,
    "pn": 12.86,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7323190046096",
    "name": "BARRIER Masque Chirurgical Type II avec élastiques",
    "pv": 5.0,
    "pct": 10.0,
    "pn": 4.5,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332551093471",
    "name": "BARRIER Champ opératoire non adhésif 37,5 x 45 cm",
    "pv": 7.56,
    "pct": 10.0,
    "pn": 6.8,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  },
  {
    "cip": "7332551039820",
    "name": "BARRIER Champ opératoire non adhésif 45 x 75 cm",
    "pv": 7.25,
    "pct": 10.0,
    "pn": 6.53,
    "section": "molnlycke",
    "active": true,
    "source": "import_molnlycke_2026"
  }
];

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const { token } = event.queryStringParameters || {};
  if (token !== "elixir2026") return { statusCode: 403, headers: cors, body: "Forbidden" };

  const now = new Date().toISOString();
  let upserted = 0, errors = [];

  // 1. Désactiver tous les molnlycke existants
  await fetch(`${SUPABASE_URL}/rest/v1/elixir_products?section=eq.molnlycke`, {
    method: "PATCH",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify({ active: false, updated_at: now })
  });

  // 2. Upsert tous les nouveaux produits
  for (const p of PRODUCTS) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/elixir_products`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({ ...p, updated_at: now, created_at: now })
    });
    if (res.ok) upserted++;
    else errors.push({ cip: p.cip, err: await res.text() });
  }

  return {
    statusCode: 200, headers: cors,
    body: JSON.stringify({ success: true, total: PRODUCTS.length, upserted, errors: errors.length, details: errors.slice(0,5) })
  };
};
