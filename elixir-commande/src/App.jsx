import React, { useState, useMemo, useEffect, useCallback } from "react";
import emailjs from "@emailjs/browser";
import { EMAILJS_CONFIG, DEFAULT_RECIPIENT } from "./emailjsConfig";
import { PHARMACIES_DB } from "./pharmaciesDb";
import AdminPanel from "./AdminPanel";

const CATALOG = {
  expert: {
    label: "Sélection Expert",
    subtitle: "Médicaments chers – Abandon de marge fixe 30€/boîte",
    color: "#1a3a4a",
    accent: "#2d7d9a",
    icon: "💊",
    columns: ["CIP13", "Désignation", "Prix Vente", "Remise %", "Remise €", "Prix net"],
    products: [
      { cip: "3400930083048", name: "ALECENSA 150MG GELU BT 224",                      pv:  3660.04, remise: 30,    pn:  3630.04, note: "Limité" },
      { cip: "3400930260494", name: "AMVUTTRA 25MG INJ SRG 0,5ML BT 1",               pv: 65128.84, remise: 30,    pn: 65098.84, note: "Sur commande" },
      { cip: "3400930073537", name: "CABOMETYX 40MG CPR FL 30",                        pv:  4008.82, remise: 30,    pn:  3978.82 },
      { cip: "3400930073544", name: "CABOMETYX 60MG CPR FL 30",                        pv:  4008.82, remise: 30,    pn:  3978.82 },
      { cip: "3400930067314", name: "EPCLUSA 400MG/100MG COMPRIME 28",                 pv:  7232.50, remise: 30,    pn:  7202.50, note: "Limité" },
      { cip: "3400930167267", name: "ERLEADA 60MG CPR BT 120",                         pv:  2333.87, remise: 30,    pn:  2303.87 },
      { cip: "3400930229385", name: "EVRYSDI 0,75MG/ML PDR BUV FL 1",                 pv:  8881.20, remise: 30,    pn:  8851.20, note: "Limité" },
      { cip: "3400926783501", name: "EYLEA 40MG/ML SOL INJ SERING 1",                  pv:   506.15, remise: 15.93, pn:   490.22, note: "Limité" },
      { cip: "3400930283325", name: "EYLEA 114,3MG/ML FLACON BT 1",                    pv:   613.90, remise: 30,    pn:   583.90, note: "Limité" },
      { cip: "3400930076279", name: "HEMLIBRA 150MG/ML INJ FL 0,4ML BT 1",            pv:  3157.82, remise: 30,    pn:  3127.82, note: "Limité" },
      { cip: "3400930141434", name: "HEMLIBRA 150MG/ML INJ FL 0,7ML BT 1",            pv:  5501.34, remise: 30,    pn:  5471.34, note: "Limité" },
      { cip: "3400930141441", name: "HEMLIBRA 150MG/ML INJ FL 1ML BT 1",              pv:  7844.86, remise: 30,    pn:  7814.86, note: "Limité" },
      { cip: "3400930075296", name: "IBRANCE 100MG GELU BT 21",                        pv:  1523.80, remise: 30,    pn:  1493.80 },
      { cip: "3400930075302", name: "IBRANCE 125MG GELU BT 21",                        pv:  1523.80, remise: 30,    pn:  1493.80 },
      { cip: "3400930075272", name: "IBRANCE 75MG GELU BT 21",                         pv:  1523.80, remise: 30,    pn:  1493.80 },
      { cip: "3400930182482", name: "IMBRUVICA 140MG COMPRIME 30",                     pv:  1540.17, remise: 30,    pn:  1510.17, note: "Limité" },
      { cip: "3400930182505", name: "IMBRUVICA 280MG COMPRIME 30",                     pv:  3047.83, remise: 30,    pn:  3017.83, note: "Limité" },
      { cip: "3400930156162", name: "IMBRUVICA 420MG COMPRIME 30",                     pv:  4555.00, remise: 30,    pn:  4525.00, note: "Limité" },
      { cip: "3400930156179", name: "IMBRUVICA 560MG COMPRIME 30",                     pv:  6063.17, remise: 30,    pn:  6033.17, note: "Limité" },
      { cip: "3400930144824", name: "JULUCA 50MG/25MG CPR FL 30",                      pv:   539.28, remise: 30,    pn:   509.28, note: "Limité" },
      { cip: "3400930226971", name: "KESIMPTA 20MG INJ STYLO 0,4ML BT 1",             pv:  1084.75, remise: 30,    pn:  1054.75 },
      { cip: "3400930109359", name: "KISQALI 200MG CPR BT 63",                         pv:  2319.15, remise: 30,    pn:  2289.15 },
      { cip: "3400930144213", name: "LYNPARZA 150MG CPR BT 112",                       pv:  4020.24, remise: 30,    pn:  3990.24, note: "Limité" },
      { cip: "3400930108765", name: "MAVIRET 100MG/40MG CPR BT 84",                   pv: 10832.50, remise: 30,    pn: 10802.50 },
      { cip: "3400927944703", name: "MEKINIST 2MG CPR FL 30",                          pv:  4175.61, remise: 30,    pn:  4145.61 },
      { cip: "3400930203545", name: "NUBEQA 300MG CPR BT 112",                         pv:  3119.06, remise: 30,    pn:  3089.06 },
      { cip: "3400927722097", name: "REVESTIVE 5MG PDR SOL INJ BT 28",                pv: 15480.09, remise: 30,    pn: 15450.09 },
      { cip: "3400935728951", name: "SOMATULINE LP 120MG AMP 1",                       pv:  1011.78, remise: 30,    pn:   981.78 },
      { cip: "3400935728722", name: "SOMATULINE LP 60MG AMP 1",                        pv:   756.41, remise: 30,    pn:   726.41 },
      { cip: "3400935728890", name: "SOMATULINE LP 90MG AMP 1",                        pv:   884.14, remise: 30,    pn:   854.14 },
      { cip: "3400930212608", name: "TAKHZYRO 300MG SOL INJ SERINGUE PRE-REMPLIE",    pv: 11513.13, remise: 30,    pn: 11483.13 },
      { cip: "3400927497940", name: "TECFIDERA 240MG GELU BT 56",                      pv:   744.44, remise: 30,    pn:   714.44 },
      { cip: "3400930202074", name: "VYNDAQEL 61MG CAPSULE MOLLE 30",                  pv:  7014.02, remise: 30,    pn:  6984.02 },
      { cip: "3400930117644", name: "XTANDI 40MG COMPRIME 112",                        pv:  2804.50, remise: 30,    pn:  2774.50 },
      { cip: "3400930076279", name: "ZYTIGA 500MG CPR BT 60",                          pv:  1442.58, remise: 30,    pn:  1412.58, note: "Limité" },
    ]
  },
  stratege: {
    label: "Sélection Stratège",
    subtitle: "Cartons standard – Top 50 rotations nationales",
    color: "#2d5a27",
    accent: "#4a9e42",
    icon: "📦",
    columns: ["CIP", "Désignation", "Colis", "Prix", "Remise %", "Remise €", "Prix net", "Prix carton"],
    products: [
      { cip: "3400933640620", name: "ADVILMED ENF/BB SUSP FL 200ML",                    colis:  24, prix: 2.38, pct:  9.24, pn: 2.16, carton:  51.84 },
      { cip: "3400931499787", name: "BETADINE DERMIQUE 10% SOL LOC FL 125ML BT 1",      colis:  60, prix: 1.66, pct: 15.06, pn: 1.41, carton:  84.60 },
      { cip: "3400930108611", name: "BETADINE SCRUB 4% SOL APP CUTANEE MOUSS 125ML",    colis:  60, prix: 1.51, pct: 14.57, pn: 1.29, carton:  77.40 },
      { cip: "3400934796708", name: "DACUDOSES S LAV OCUL 24 UNID/10ML",                colis:  24, prix: 2.28, pct: 10.96, pn: 2.03, carton:  48.72 },
      { cip: "3400936158832", name: "DAFALGAN 1G BTE 8 CPR PELL",                       colis: 160, prix: 1.06, pct: 24.53, pn: 0.80, carton: 128.00 },
      { cip: "3400930186947", name: "DAFALGAN 1000MG GELU BT 8",                        colis: 160, prix: 1.06, pct: 24.53, pn: 0.80, carton: 128.00 },
      { cip: "3400932679041", name: "DAFALGAN 500MG BTE 16 GELU",                       colis: 160, prix: 1.06, pct: 24.53, pn: 0.80, carton: 128.00 },
      { cip: "3400933275815", name: "DAFALGAN CODEINE BTE 16 CPR PELL",                 colis:  80, prix: 1.56, pct: 14.10, pn: 1.34, carton: 107.20 },
      { cip: "3400933316778", name: "DAFALGAN CODEINE EFF TUBE 16 CPR CS-96",           colis:  96, prix: 1.56, pct: 14.10, pn: 1.34, carton: 128.64 },
      { cip: "3400934615467", name: "DOLIPRANE 2,4% SUSP BUV 100ML",                    colis:  24, prix: 1.26, pct: 19.84, pn: 1.01, carton:  24.24 },
      { cip: "3400935955838", name: "DOLIPRANE ADULTE 1000MG BTE 8 CPR",                colis: 160, prix: 1.06, pct: 24.53, pn: 0.80, carton: 128.00 },
      { cip: "3400941533969", name: "DOLIPRANE ADULTE 1000MG BTE 8 GELU",               colis: 240, prix: 1.06, pct: 24.53, pn: 0.80, carton: 192.00 },
      { cip: "3400935294227", name: "DOLIPRANE ADULTE 1000MG EFF TUBE 8 CPR",           colis: 144, prix: 1.06, pct: 24.53, pn: 0.80, carton: 115.20 },
      { cip: "3400932320189", name: "DOLIPRANE ADULTE 500MG BTE 16 CPR",                colis: 160, prix: 1.06, pct: 24.53, pn: 0.80, carton: 128.00 },
      { cip: "3400934507786", name: "DOLIPRANE ADULTE 500MG BTE 16 GELU",               colis: 160, prix: 1.06, pct: 24.53, pn: 0.80, carton: 128.00 },
      { cip: "3400935291783", name: "EFFERALGANMED 1G EFF TUBE 8 CPR",                  colis:  96, prix: 1.06, pct: 24.53, pn: 0.80, carton:  76.80 },
      { cip: "3400932570010", name: "EFFERALGANMED 500MG EFF BTE 16 CPR",               colis: 100, prix: 1.06, pct: 24.53, pn: 0.80, carton:  80.00 },
      { cip: "3400936895744", name: "ELUDRIL G SOL FL 90ML",                             colis: 100, prix: 1.43, pct: 15.38, pn: 1.21, carton: 121.00 },
      { cip: "3400937784214", name: "FLECTOR 1% GEL FL 100G BT 1",                      colis:  42, prix: 2.42, pct:  9.09, pn: 2.20, carton:  92.40 },
      { cip: "3400933095253", name: "GAVISCON SUSP BUV SACH BT 24",                     colis:  12, prix: 3.60, pct:  6.11, pn: 3.38, carton:  40.56 },
      { cip: "3400922385624", name: "HELICIDINE SS 10% SIROP 250ML",                    colis:  24, prix: 2.52, pct:  9.13, pn: 2.29, carton:  54.96 },
      { cip: "3400935528988", name: "IBUFETUM GEL 5% TUBE 60G",                         colis: 126, prix: 1.79, pct: 13.97, pn: 1.54, carton: 194.04 },
      { cip: "3400949605538", name: "IZALGI MYLAN 500MG/25MG BTE 16",                   colis: 100, prix: 1.43, pct: 17.48, pn: 1.18, carton: 118.00 },
      { cip: "3400933247379", name: "KARDEGIC 160MG POUD BTE 30 SACHETS",               colis: 120, prix: 1.47, pct: 17.01, pn: 1.22, carton: 146.40 },
      { cip: "3400934744198", name: "KARDEGIC 75MG POUD BTE 30 SACHETS",                colis: 120, prix: 1.47, pct: 17.01, pn: 1.22, carton: 146.40 },
      { cip: "3400935154958", name: "LAMALINE MYLAN 300MG/10MG BTE 16 GELU",            colis: 100, prix: 1.28, pct: 19.53, pn: 1.03, carton: 103.00 },
      { cip: "3400930065556", name: "LEVOTHYROX 25MCG BTE 30 CPR",                      colis: 120, prix: 0.68, pct: 32.35, pn: 0.46, carton:  55.20 },
      { cip: "3400930065570", name: "LEVOTHYROX 25MCG BTE 90 CPR",                      colis: 120, prix: 1.44, pct: 15.28, pn: 1.22, carton: 146.40 },
      { cip: "3400930065662", name: "LEVOTHYROX 50MCG BTE 30 CPR",                      colis: 120, prix: 1.03, pct: 21.36, pn: 0.81, carton:  97.20 },
      { cip: "3400930065686", name: "LEVOTHYROX 50MCG BTE 90 CPR",                      colis: 120, prix: 2.49, pct:  8.84, pn: 2.27, carton: 272.40 },
      { cip: "3400930065785", name: "LEVOTHYROX 75MCG BTE 30 CPR",                      colis: 120, prix: 1.41, pct: 15.60, pn: 1.19, carton: 142.80 },
      { cip: "3400933254063", name: "METEOSPASMYL BTE 20 CAPS",                         colis: 192, prix: 2.36, pct: 10.59, pn: 2.11, carton: 405.12 },
      { cip: "3400926738266", name: "MONOPROST 50MCG/ML COLLY DOS 30",                  colis:  32, prix: 8.02, pct:  4.99, pn: 7.62, carton: 243.84 },
      { cip: "3400931307372", name: "NORMACOL LAVEMENT ADULTES FL 130ML",               colis:  50, prix: 1.41, pct: 15.60, pn: 1.19, carton:  59.50 },
      { cip: "3400934464171", name: "PAROEX BAIN DE BOUCHE 300ML",                      colis:  24, prix: 2.20, pct: 10.00, pn: 1.98, carton:  47.52 },
      { cip: "3400930986080", name: "SPASFON COMPRIME ENROBE BTE 30",                   colis: 240, prix: 1.93, pct: 13.47, pn: 1.67, carton: 400.80 },
      { cip: "3400941686245", name: "SPASFON LYOC 160MG LYOPHILISAT ORAL BTE 5",        colis: 240, prix: 1.30, pct: 18.46, pn: 1.06, carton: 254.40 },
      { cip: "3400931863014", name: "SPASFON LYOC 80MG LYOT ORAL BTE 10",               colis: 160, prix: 1.30, pct: 18.46, pn: 1.06, carton: 169.60 },
      { cip: "3400934438738", name: "VENTOLINE 100µG/DOSE SUSP 120 DOSES",              colis: 120, prix: 3.24, pct:  7.72, pn: 2.99, carton: 358.80 },
    ]
  },
  master: {
    label: "Sélection Master",
    subtitle: "Paliers – 100 références à forte rotation",
    color: "#4a2070",
    accent: "#8b5cf6",
    icon: "⭐",
    columns: ["CIP13", "Désignation", "Palier", "Prix brut", "Remise %", "Remise €", "Prix remisé"],
    products: [
      { cip: "3400935766052", name: "ACIDE FOLIQUE CCD 5MG CPR BT 20",              palier:  20, pb: 1.20, pct: 18.33, pn: 0.98 },
      { cip: "3400935845856", name: "ACIDE FOLIQUE CCD 0,40MG CPR BT 30",           palier:  30, pb: 2.59, pct:  8.49, pn: 2.37 },
      { cip: "3400932676729", name: "ANTADYS 100MG CPR BT 15",                      palier:  20, pb: 2.22, pct:  9.91, pn: 2.00 },
      { cip: "3400926939939", name: "ASPIRINE PROTECT 100MG BTE 30 CPR",            palier:  20, pb: 1.54, pct: 14.29, pn: 1.32 },
      { cip: "3400930081372", name: "ATARAX 25MG CPR PELLIC BT 30",                 palier:  20, pb: 1.63, pct: 13.50, pn: 1.41 },
      { cip: "3400932913282", name: "BISEPTINE 0,25/0,025 PULV 100ML",              palier:  48, pb: 1.91, pct: 11.52, pn: 1.69 },
      { cip: "3400932935345", name: "CLARADOL CAFEINE 500MG CPR SECAB BT 16",      palier:  20, pb: 1.33, pct: 16.54, pn: 1.11 },
      { cip: "3400938709544", name: "CLARELUX G CREME TUBE 10G",                    palier:  20, pb: 1.21, pct: 18.18, pn: 0.99 },
      { cip: "3400933220754", name: "CODOLIPRANE 400MG/20MG AD. CPR BT 16",        palier:  20, pb: 1.56, pct: 14.10, pn: 1.34 },
      { cip: "3400927562396", name: "CODOLIPRANE 500MG/30MG CPR BT 16",            palier:  20, pb: 1.56, pct: 14.10, pn: 1.34 },
      { cip: "3400930264546", name: "COUMADINE 2MG BTE 20 CPR",                     palier:  30, pb: 1.41, pct: 15.60, pn: 1.19 },
      { cip: "3400935291035", name: "DAFALGAN 1000MG CPR EFFV TB 8",               palier:  20, pb: 1.06, pct: 23.58, pn: 0.81 },
      { cip: "3400930184844", name: "DAFALGAN 500MG GELU TB 16",                    palier:  20, pb: 1.06, pct: 23.58, pn: 0.81 },
      { cip: "3400932905997", name: "DIFFU-K 600MG BTE 40 CAPS",                    palier:  30, pb: 1.79, pct: 13.41, pn: 1.55 },
      { cip: "3400936246980", name: "DOLIPRANE ADULTE 1000MG BUV BTE 8 SACH",      palier:  30, pb: 1.06, pct: 23.58, pn: 0.81 },
      { cip: "3400933071998", name: "DOLIPRANE ADULTE 500MG EFF TUBE 16 CPR",      palier:  20, pb: 1.06, pct: 23.58, pn: 0.81 },
      { cip: "3400932331536", name: "DOLIPRANE ADULTE 500MG POUD BTE 12",          palier:  30, pb: 1.06, pct: 23.58, pn: 0.81 },
      { cip: "3400934999451", name: "DOLIPRANE ENF 300MG POUD BTE 12 SACHETS",     palier:  30, pb: 1.30, pct: 19.23, pn: 1.05 },
      { cip: "3400932192946", name: "DUPHASTON 10MG CPR BT 10",                     palier:  20, pb: 2.49, pct:  8.84, pn: 2.27 },
      { cip: "3400930348444", name: "EDUCTYL AD. SUP EFFV BT 12",                   palier:  20, pb: 1.47, pct: 14.97, pn: 1.25 },
      { cip: "3400922257204", name: "ELUDRILPERIO BAIN BCHE 200ML",                 palier:  30, pb: 2.20, pct: 10.00, pn: 1.98 },
      { cip: "3400937784214", name: "FLECTOR GEL 1% FL 100G",                       palier:  20, pb: 2.42, pct:  9.09, pn: 2.20 },
      { cip: "3400933384616", name: "FLECTORGEL 1% TUBE 60G",                       palier:  20, pb: 1.87, pct: 11.76, pn: 1.65 },
      { cip: "3400935528988", name: "IBUFETUM GEL 5% TUBE 60G",                     palier:  30, pb: 1.79, pct: 11.73, pn: 1.58 },
      { cip: "3400934646683", name: "INDOCOLLYRE 0,1% COLLY DOS BT 20",             palier:  20, pb: 2.68, pct:  8.21, pn: 2.46 },
      { cip: "3400930204870", name: "KLIPAL CODEINE 300MG/25MG CPR BTE 16",        palier:  30, pb: 1.47, pct: 14.97, pn: 1.25 },
      { cip: "3400930204887", name: "KLIPAL CODEINE 600MG/50MG BTE 12 CPR",        palier:  30, pb: 1.56, pct: 14.10, pn: 1.34 },
      { cip: "3400938479324", name: "LEELOO 0,1MG/0,02MG CPR BT 63",               palier:  20, pb: 3.41, pct:  6.45, pn: 3.19 },
      { cip: "3400930065891", name: "LEVOTHYROX 100MCG BTE 30 CPR",                 palier:  20, pb: 1.77, pct: 12.43, pn: 1.55 },
      { cip: "3400930066010", name: "LEVOTHYROX 125MCG EXC CPR BT 30",             palier:  20, pb: 2.13, pct: 11.27, pn: 1.89 },
      { cip: "3400930065556", name: "LEVOTHYROX 25µG BTE 30 CPR",                   palier:  30, pb: 0.68, pct: 30.88, pn: 0.47 },
      { cip: "3400930065570", name: "LEVOTHYROX 25MCG CPR BT 90 EXC",              palier:  30, pb: 1.44, pct: 14.58, pn: 1.23 },
      { cip: "3400930065662", name: "LEVOTHYROX 50µG BTE 30 CPR",                   palier:  30, pb: 1.03, pct: 20.39, pn: 0.82 },
      { cip: "3400930065785", name: "LEVOTHYROX 75µG BTE 30 CPR",                   palier:  30, pb: 1.41, pct: 14.89, pn: 1.20 },
      { cip: "3400933254063", name: "METEOSPASMYL 60MG/300MG CAPS BT 20",          palier:  96, pb: 2.36, pct:  9.75, pn: 2.13 },
      { cip: "3400930669334", name: "METEOXANE GELU BT 60",                         palier:  20, pb: 2.90, pct:  7.59, pn: 2.68 },
      { cip: "3400926738266", name: "MONOPROST 50MCG/ML COLLY DOS 30",              palier:  20, pb: 8.00, pct:  5.00, pn: 7.60 },
      { cip: "3400922179049", name: "OPTILOVA 20µG/100µG CPR BT 84",               palier:  20, pb: 3.41, pct:  6.45, pn: 3.19 },
      { cip: "3400927406980", name: "OPTIMIZETTE 0,075MG CPR BT 84",               palier:  20, pb: 2.72, pct:  8.09, pn: 2.50 },
      { cip: "3400933484132", name: "PREVISCAN 20MG BTE 30 CPR",                    palier:  30, pb: 1.94, pct: 11.34, pn: 1.72 },
      { cip: "3400930013953", name: "RESITUNE 75MG CPR FL 30",                      palier:  20, pb: 1.54, pct: 14.29, pn: 1.32 },
      { cip: "3400935887559", name: "SERESTA 10MG BT 30",                           palier:  40, pb: 1.14, pct: 19.30, pn: 0.92 },
      { cip: "3400930959695", name: "SERESTA 50MG BT 20",                           palier:  40, pb: 1.71, pct: 12.87, pn: 1.49 },
      { cip: "3400936251373", name: "SPIFEN 400MG CPR BT 20",                       palier:  20, pb: 1.74, pct: 12.64, pn: 1.52 },
      { cip: "3400931927501", name: "STAGID 700MG CPR BT 30",                       palier:  20, pb: 2.04, pct: 10.78, pn: 1.82 },
      { cip: "3400931384144", name: "STERDEX POM OPHT UNIDOS BT 12",               palier:  20, pb: 2.21, pct:  9.95, pn: 1.99 },
      { cip: "3400927400209", name: "TANGANIL G 500MG BTE 30 CPR",                  palier:  30, pb: 2.65, pct:  8.30, pn: 2.43 },
      { cip: "3400933518004", name: "TARDYFERON 80MG BTE 30 CPR",                   palier:  30, pb: 2.45, pct:  8.98, pn: 2.23 },
      { cip: "3400932963898", name: "TERCIAN 25MG CPR BT 30",                       palier:  20, pb: 4.18, pct:  6.22, pn: 3.92 },
      { cip: "3400934424021", name: "TRANSIPEG 5,9G BUV SACH BT 20",               palier:  20, pb: 2.67, pct:  8.24, pn: 2.45 },
      { cip: "3400933316259", name: "VOGALENE LYOC 7,5MG LYOPH ORAL BTE 16",       palier:  30, pb: 2.50, pct:  8.80, pn: 2.28 },
      { cip: "3400935358363", name: "ZYMAD 10000U BUV GTT 10ML BT 1",              palier:  20, pb: 1.71, pct: 12.87, pn: 1.49 },
    ]
  },
  obeso: {
    label: "Mounjaro / Wegovy",
    subtitle: "Traitements obésité – Quotas Novo Nordisk & Eli Lilly",
    color: "#1a3a5c",
    accent: "#3b82f6",
    icon: "💉",
    columns: ["Désignation", "Prix catalogue", "Remise", "Prix remisé"],
    products: [
      { cip: "3400930258620", name: "WEGOVY 0,25mg", pv: 187.00, pct: "-31%", pn: 129.03, note: "Stock limité", groupe: "Wegovy (sémaglutide)" },
      { cip: "3400930317815", name: "WEGOVY 0,5mg",  pv: 187.00, pct: "-20%", pn: 149.60, note: "Stock limité", groupe: "Wegovy (sémaglutide)" },
      { cip: "3400930258644", name: "WEGOVY 1mg",    pv: 187.00, pct: "-20%", pn: 149.60, note: "Stock limité", groupe: "Wegovy (sémaglutide)" },
      { cip: "3400930260241", name: "WEGOVY 1,7mg",  pv: 198.00, pct: "-10%", pn: 178.20, note: "Stock limité", groupe: "Wegovy (sémaglutide)" },
      { cip: "3400930258668", name: "WEGOVY 2,4mg",  pv: 240.00, pct: "-10%", pn: 216.00, note: "Stock limité", groupe: "Wegovy (sémaglutide)" },
      { cip: "3400930292907", name: "MOUNJARO 2,5mg",  pv: 172.00, pct: "-7,5%", pn: 159.10, groupe: "Mounjaro (tirzépatide)" },
      { cip: "3400930292914", name: "MOUNJARO 5mg",    pv: 227.00, pct: "-7,5%", pn: 209.97, groupe: "Mounjaro (tirzépatide)" },
      { cip: "3400930292938", name: "MOUNJARO 7,5mg",  pv: 320.00, pct: "-7,5%", pn: 296.00, groupe: "Mounjaro (tirzépatide)" },
      { cip: "3400930292945", name: "MOUNJARO 10mg",   pv: 320.00, pct: "-7,5%", pn: 296.00, groupe: "Mounjaro (tirzépatide)" },
      { cip: "3400930292952", name: "MOUNJARO 12,5mg", pv: 409.00, pct: "-7,5%", pn: 378.32, groupe: "Mounjaro (tirzépatide)" },
      { cip: "3400930292976", name: "MOUNJARO 15mg",   pv: 409.00, pct: "-7,5%", pn: 378.32, groupe: "Mounjaro (tirzépatide)" },
    ]
  },
  nr: {
    label: "Autres NR",
    subtitle: "Vaccins, contraception & maximisation de marges",
    color: "#1a4a3a",
    accent: "#10b981",
    icon: "🔬",
    columns: ["CIP13", "Désignation", "Prix catalogue", "Remise", "Prix remisé"],
    products: [
      { cip: "3400930141861", name: "SHINGRIX Vaccin Zona HZ/su — 1 dose",    pv: 175.18, pct: "-3,83%",  pn: 168.44 },
      { cip: "3400930288849", name: "DELIPROCT SUPPOSITOIRE BT 6",              pv:   7.94, pct: "-11%",    pn:   7.07 },
      { cip: "3400935356062", name: "DERINOX GTT AERO FL PULV 15ML",           pv:   4.93, pct: "-8%",     pn:   4.54 },
      { cip: "3400937640053", name: "JASMINELLE 3x21",                          pv:  29.93, pct: "-11%",    pn:  26.64 },
      { cip: "3400934444760", name: "KETUM GEL 2,5% TUBE DOSEUR 120G",         pv:   6.98, pct: "-10,1%",  pn:   6.27 },
      { cip: "3400933354978", name: "KETUM GEL 2,5% TUBE 60G",                 pv:   3.66, pct: "-10,1%",  pn:   3.29 },
      { cip: "3400930632192", name: "LUMIRELAX CPR 500MG BT 20",               pv:   8.72, pct: "-15%",    pn:   7.41 },
      { cip: "3400938724332", name: "MILDAC COMPRIMÉ 600MG BT 15",             pv:  19.68, pct: "-10,1%",  pn:  17.69 },
      { cip: "3400939094908", name: "QLAIRA 3x21",                              pv:  31.88, pct: "-10%",    pn:  28.69 },
      { cip: "3400932162901", name: "SKIACOL COLLYRE FL/0,5ML",                pv:   7.39, pct: "-9%",     pn:   6.72 },
      { cip: "3400930192757", name: "SLINDA 4MG CPR PEL BT 3X28",              pv:  29.74, pct: "-12,5%",  pn:  26.02 },
      { cip: "3400938840575", name: "YAZ 0,02MG/3MG CPR PELL BT 3X28",        pv:  29.93, pct: "-12%",    pn:  26.34 },
    ]
  },
  molnlycke: {
    label: "Offre Mölnlycke",
    subtitle: "Pansements & dispositifs médicaux – -10% dès la 1re boîte",
    color: "#1e3a5f",
    accent: "#3b82f6",
    icon: "🩹",
    columns: ["Réf.", "Désignation", "Prix Tarif HT", "Prix remisé -10%"],
    products: [
      { cip: "MOL-EXU-5X5",       name: "Exufiber 5x5cm BT10",                        pv:  28.50, pn:  25.65 },
      { cip: "MOL-EXU-10X10",     name: "Exufiber 10x10cm BT10",                      pv:  52.80, pn:  47.52 },
      { cip: "MOL-EXU-15X15",     name: "Exufiber 15x15cm BT10",                      pv:  89.50, pn:  80.55 },
      { cip: "MOL-EXU-Ag5X5",     name: "Exufiber Ag 5x5cm BT10",                     pv:  38.50, pn:  34.65 },
      { cip: "MOL-EXU-Ag10X10",   name: "Exufiber Ag 10x10cm BT10",                   pv:  72.00, pn:  64.80 },
      { cip: "MOL-MEL-7X9",       name: "Melgisorb Plus 7x9cm BT10",                  pv:  22.40, pn:  20.16 },
      { cip: "MOL-MEL-10X10",     name: "Melgisorb Plus 10x10cm BT10",                pv:  35.60, pn:  32.04 },
      { cip: "MOL-MEL-15X15",     name: "Melgisorb Plus 15x15cm BT10",                pv:  62.00, pn:  55.80 },
      { cip: "MOL-MEX-STD",       name: "Mextra Superabsorbant 10x20cm BT10",         pv:  29.80, pn:  26.82 },
      { cip: "MOL-MEX-LRG",       name: "Mextra Superabsorbant 20x30cm BT10",         pv:  51.50, pn:  46.35 },
      { cip: "MOL-MFO-4X30",      name: "Mepiform 4x30cm B5",                         pv:  38.60, pn:  34.74 },
      { cip: "MOL-MFO-5X7.5",     name: "Mepiform 5x7,5cm B5",                        pv:  18.90, pn:  17.01 },
      { cip: "MOL-MFO-10X18",     name: "Mepiform 10x18cm B5",                        pv:  68.50, pn:  61.65 },
      { cip: "MOL-MEP-5X7",       name: "Mepitel 5x7cm BT10",                         pv:  19.80, pn:  17.82 },
      { cip: "MOL-MEP-10X18",     name: "Mepitel 10x18cm BT5",                        pv:  32.40, pn:  29.16 },
      { cip: "MOL-MEP-20X30",     name: "Mepitel 20x30cm BT5",                        pv:  78.00, pn:  70.20 },
      { cip: "MOL-MXT-10X12",     name: "Mepilex Transfer 10x12cm BT10",              pv:  42.00, pn:  37.80 },
      { cip: "MOL-MXT-20X50",     name: "Mepilex Transfer 20x50cm BT5",               pv:  89.00, pn:  80.10 },
      { cip: "MOL-MXX-10X10",     name: "Mepilex XT 10x10cm BT5",                     pv:  25.50, pn:  22.95 },
      { cip: "MOL-MXX-20X20",     name: "Mepilex XT 20x20cm BT5",                     pv:  58.00, pn:  52.20 },
      { cip: "MOL-MXU-10X10",     name: "Mepilex Up 10x10cm BT5",                     pv:  27.90, pn:  25.11 },
      { cip: "MOL-MXU-15X15",     name: "Mepilex Up 15x15cm BT5",                     pv:  52.00, pn:  46.80 },
      { cip: "MOL-MBF-7.5X7.5",   name: "Mepilex Border Flex 7,5x7,5cm BT5",          pv:  19.50, pn:  17.55 },
      { cip: "MOL-MBF-10X10",     name: "Mepilex Border Flex 10x10cm BT5",            pv:  28.00, pn:  25.20 },
      { cip: "MOL-MBF-10X15",     name: "Mepilex Border Flex 10x15cm BT5",            pv:  39.00, pn:  35.10 },
      { cip: "MOL-MBF-10X20",     name: "Mepilex Border Flex 10x20cm BT5",            pv:  51.00, pn:  45.90 },
      { cip: "MOL-MBF-15X15",     name: "Mepilex Border Flex 15x15cm BT5",            pv:  52.50, pn:  47.25 },
      { cip: "MOL-MBF-15X20",     name: "Mepilex Border Flex 15x20cm BT5",            pv:  65.00, pn:  58.50 },
      { cip: "MOL-MBS-17X18",     name: "Mepilex Border Sacrum 17x18cm BT5",          pv:  68.00, pn:  61.20 },
      { cip: "MOL-MBS-23X23",     name: "Mepilex Border Sacrum 23x23cm BT5",          pv:  98.00, pn:  88.20 },
      { cip: "MOL-MBT-STD",       name: "Mepilex Border Talon 13x20cm BT5",           pv:  72.00, pn:  64.80 },
      { cip: "MOL-MAG-10X10",     name: "Mepilex Ag 10x10cm BT5",                     pv:  42.50, pn:  38.25 },
      { cip: "MOL-MAG-15X15",     name: "Mepilex Ag 15x15cm BT5",                     pv:  78.00, pn:  70.20 },
      { cip: "MOL-MAG-20X20",     name: "Mepilex Ag 20x20cm BT5",                     pv: 112.00, pn: 100.80 },
      { cip: "MOL-MFI-4X5",       name: "Mepitel Film 4x5cm BT10",                    pv:  14.80, pn:  13.32 },
      { cip: "MOL-MFI-10X12",     name: "Mepitel Film 10x12cm BT10",                  pv:  32.00, pn:  28.80 },
      { cip: "MOL-MFI-15X20",     name: "Mepitel Film 15x20cm B5",                    pv:  28.50, pn:  25.65 },
      { cip: "MOL-TUB-GREEN",     name: "Tubifast 2-WAY STRETCH Vert 3,5cm BT1R",    pv:  12.50, pn:  11.25 },
      { cip: "MOL-TUB-BLUE",      name: "Tubifast 2-WAY STRETCH Bleu 5cm BT1R",      pv:  14.80, pn:  13.32 },
      { cip: "MOL-TUB-RED",       name: "Tubifast 2-WAY STRETCH Rouge 7,5cm BT1R",   pv:  16.90, pn:  15.21 },
      { cip: "MOL-TUB-YELLOW",    name: "Tubifast 2-WAY STRETCH Jaune 10,75cm BT1R", pv:  21.50, pn:  19.35 },
      { cip: "MOL-MSB-10X15",     name: "Mesorb 10x15cm BT10",                        pv:  18.50, pn:  16.65 },
      { cip: "MOL-MSB-20X20",     name: "Mesorb 20x20cm BT10",                        pv:  35.80, pn:  32.22 },
      { cip: "MOL-BAR-FLO",       name: "BARRIER Protection Film 50ml",               pv:   8.50, pn:   7.65 },
      { cip: "MOL-BAR-WIPES",     name: "BARRIER Film Protecteur Lingettes B30",      pv:  22.00, pn:  19.80 },
      { cip: "MOL-ZFL-STD",       name: "Z-Flo Fluidised Positioning Cushion",        pv:  42.00, pn:  37.80 },
    ]
  },
  blanche: {
    label: "Gamme Blanche",
    subtitle: "Consommables médicaux – Euromedis (-35%)",
    color: "#3d2b1f",
    accent: "#d97706",
    icon: "🏥",
    columns: ["Désignation", "Réf.", "Cond.", "Prix net", "Prix carton"],
    products: [
      { name: "Compresses stériles 5x5cm BT25",              cip: "EUR-CPS-5X5-25",    colis: 1, pn:  1.43, carton:  1.43 },
      { name: "Compresses stériles 5x5cm BT50",              cip: "EUR-CPS-5X5-50",    colis: 1, pn:  2.47, carton:  2.47 },
      { name: "Compresses stériles 10x10cm BT25",            cip: "EUR-CPS-10X10-25",  colis: 1, pn:  2.27, carton:  2.27 },
      { name: "Compresses stériles 10x10cm BT50",            cip: "EUR-CPS-10X10-50",  colis: 1, pn:  3.84, carton:  3.84 },
      { name: "Compresses non stériles 5x5cm BT100",         cip: "EUR-CNS-5X5-100",   colis: 1, pn:  1.17, carton:  1.17 },
      { name: "Compresses non stériles 10x10cm BT100",       cip: "EUR-CNS-10X10-100", colis: 1, pn:  1.89, carton:  1.89 },
      { name: "Compresses non stériles 10x10cm BT500",       cip: "EUR-CNS-10X10-500", colis: 1, pn:  6.83, carton:  6.83 },
      { name: "Gants latex poudré S BT100",                  cip: "EUR-GNT-LAT-S-100", colis: 1, pn:  2.93, carton:  2.93 },
      { name: "Gants latex poudré M BT100",                  cip: "EUR-GNT-LAT-M-100", colis: 1, pn:  2.93, carton:  2.93 },
      { name: "Gants latex poudré L BT100",                  cip: "EUR-GNT-LAT-L-100", colis: 1, pn:  2.93, carton:  2.93 },
      { name: "Gants vinyle sans poudre S BT100",            cip: "EUR-GNT-VNL-S-100", colis: 1, pn:  3.12, carton:  3.12 },
      { name: "Gants vinyle sans poudre M BT100",            cip: "EUR-GNT-VNL-M-100", colis: 1, pn:  3.12, carton:  3.12 },
      { name: "Gants vinyle sans poudre L BT100",            cip: "EUR-GNT-VNL-L-100", colis: 1, pn:  3.12, carton:  3.12 },
      { name: "Gants nitrile non poudré S BT100",            cip: "EUR-GNT-NTR-S-100", colis: 1, pn:  3.84, carton:  3.84 },
      { name: "Gants nitrile non poudré M BT100",            cip: "EUR-GNT-NTR-M-100", colis: 1, pn:  3.84, carton:  3.84 },
      { name: "Gants nitrile non poudré L BT100",            cip: "EUR-GNT-NTR-L-100", colis: 1, pn:  3.84, carton:  3.84 },
      { name: "Bande crépon extensible 5cm BT1",             cip: "EUR-BND-CREPE-5",   colis: 1, pn:  0.55, carton:  0.55 },
      { name: "Bande crépon extensible 10cm BT1",            cip: "EUR-BND-CREPE-10",  colis: 1, pn:  0.78, carton:  0.78 },
      { name: "Bande Velpeau 5cmx4m BT1",                    cip: "EUR-BND-VELPEAU-5", colis: 1, pn:  0.72, carton:  0.72 },
      { name: "Bande Velpeau 10cmx4m BT1",                   cip: "EUR-BND-VELPEAU-10",colis: 1, pn:  1.04, carton:  1.04 },
      { name: "Bande contention 10cm BT1",                   cip: "EUR-BND-CONTON-10", colis: 1, pn:  2.27, carton:  2.27 },
      { name: "Pansements assortis BT100",                   cip: "EUR-PAN-ASSORT",    colis: 1, pn:  2.47, carton:  2.47 },
      { name: "Pansements larges 6x10cm BT50",               cip: "EUR-PAN-LARGE",     colis: 1, pn:  2.73, carton:  2.73 },
      { name: "Sparadrap microporeux 5cmx5m BT1",            cip: "EUR-SPA-MED-5M",    colis: 1, pn:  1.89, carton:  1.89 },
      { name: "Sparadrap microporeux 10cmx5m BT1",           cip: "EUR-SPA-MED-10M",   colis: 1, pn:  2.93, carton:  2.93 },
      { name: "Sparadrap tissu 5cmx5m BT1",                  cip: "EUR-SPA-TIS-5M",    colis: 1, pn:  2.08, carton:  2.08 },
      { name: "Gants de toilette mousse BT50",               cip: "EUR-GTT-MOUSSE-50", colis: 1, pn:  3.58, carton:  3.58 },
      { name: "Gants de toilette mousse BT250",              cip: "EUR-GTT-MOUSSE-250",colis: 1, pn: 14.30, carton: 14.30 },
      { name: "Gants de toilette savonneux BT50",            cip: "EUR-GTT-SAVON-50",  colis: 1, pn:  4.88, carton:  4.88 },
      { name: "Gants de toilette secs BT50",                 cip: "EUR-GTT-DRY-50",    colis: 1, pn:  4.42, carton:  4.42 },
      { name: "Rebelle Good Cola Acidulé 100g",              cip: "REB-COLA-ACID",     colis: 1, pn:  1.67, carton:  1.67 },
      { name: "Rebelle Oursons Fruity Bears 100g",           cip: "REB-OURS-FRUITY",   colis: 1, pn:  1.67, carton:  1.67 },
      { name: "Rebelle Bonbons Mango Power 100g",            cip: "REB-MANGO",         colis: 1, pn:  1.67, carton:  1.67 },
      { name: "Rebelle Bonbons Berries Power 100g",          cip: "REB-BERRIES",       colis: 1, pn:  1.67, carton:  1.67 },
      { name: "Rebelle Sucettes Magic Lollipops",            cip: "REB-LOLLY",         colis: 1, pn:  1.67, carton:  1.67 },
      { name: "Rebelle Pêches sans sucres 100g",             cip: "REB-PECHE-SS",      colis: 1, pn:  1.67, carton:  1.67 },
      { name: "Rebelle Oursons acidulés sans sucres 100g",   cip: "REB-OURS-SS",       colis: 1, pn:  1.67, carton:  1.67 },
      { name: "Rebelle Bouteilles roses & bleues ss sucres", cip: "REB-BOUT-SS",       colis: 1, pn:  1.67, carton:  1.67 },
      { name: "Sacs plastique médical standards BT100",      cip: "EUR-BAG-STD",       colis: 1, pn:  5.53, carton:  5.53 },
      { name: "Sacs PEBD transparents BT200",                cip: "EUR-BAG-LDPE",      colis: 1, pn:  4.42, carton:  4.42 },
      { name: "Haricots plastique BT10",                     cip: "EUR-HARICOT",       colis: 1, pn:  2.73, carton:  2.73 },
      { name: "Plateaux plastique usage unique BT10",        cip: "EUR-PLATEAU",       colis: 1, pn:  2.34, carton:  2.34 },
    ]
  },
  covid: {
    label: "Diagnostic & Covid",
    subtitle: "Tests antigéniques, auto-tests, masques, oxymètres, tensiomètres",
    color: "#3d1a2e",
    accent: "#ec4899",
    icon: "🦠",
    columns: ["Réf.", "Désignation", "Prix catalogue", "Remise", "Prix net"],
    products: [
      { cip: "DIAG-THERM-01",    name: "Thermomètre infrarouge frontal",          pv:   1.59, pct: "-40%", pn:  0.95 },
      { cip: "DIAG-PREG-01",     name: "Test de grossesse urinaire unitaire",     pv:   0.79, pct: "-40%", pn:  0.47 },
      { cip: "DIAG-NEB-01",      name: "Nébuliseur à air comprimé complet",       pv:  39.99, pct: "-20%", pn: 31.99 },
      { cip: "DIAG-TRLAIT-SYM",  name: "Tire-lait électrique Medela Symphony",    pv: 699.00, pct: "-15%", pn: 594.15 },
      { cip: "DIAG-TRLAIT-KIT",  name: "Kit accessoires Medela Symphony",         pv:  25.99, pct: "-15%", pn: 22.09 },
      { cip: "DIAG-MSQ-CHIR-BT", name: "Masques chirurgicaux BT50 Type II",       pv:   1.99, pct: "-25%", pn:  1.49 },
      { cip: "DIAG-OXY-01",      name: "Oxymètre de pouls digital",               pv:  10.99, pct: "-30%", pn:  7.69 },
      { cip: "DIAG-FFP2-B20",    name: "Masques FFP2 NR Boîte/20",                pv:   3.80, pct: "-30%", pn:  2.66 },
      { cip: "DIAG-COV-AUTO",    name: "Autotest COVID-19 Antigénique unitaire",  pv:   3.50, pct: "-35%", pn:  2.27 },
      { cip: "DIAG-COV-GRIPE",   name: "Test Combo Covid/Grippe antigénique",     pv:   5.90, pct: "-35%", pn:  3.84 },
      { cip: "DIAG-TRIPLEX",     name: "Test Triplex Covid/Grippe A+B",           pv:   7.50, pct: "-35%", pn:  4.88 },
      { cip: "DIAG-ANT-BT5",     name: "Tests antigéniques nasaux BT5",           pv:  14.50, pct: "-35%", pn:  9.43 },
      { cip: "DIAG-ANT-BT25",    name: "Tests antigéniques nasaux BT25",          pv:  62.50, pct: "-35%", pn: 40.62 },
      { cip: "DIAG-GLC-CTRL",    name: "Lecteur glycémie + bandelettes BT50",     pv:  18.90, pct: "-20%", pn: 15.12 },
      { cip: "DIAG-TA-DIG",      name: "Tensiomètre digital bras automatique",    pv:  29.90, pct: "-20%", pn: 23.92 },
      { cip: "DIAG-TA-POIG",     name: "Tensiomètre digital poignet",             pv:  24.90, pct: "-20%", pn: 19.92 },
      { cip: "DIAG-STR-TEST",    name: "Autotest Streptocoque A rapide",          pv:   8.50, pct: "-30%", pn:  5.95 },
      { cip: "DIAG-INF-TEST",    name: "Autotest Grippe Influenza A/B rapide",    pv:   9.90, pct: "-30%", pn:  6.93 },
      { cip: "DIAG-VRS-TEST",    name: "Test VRS rapide antigénique",             pv:   9.50, pct: "-30%", pn:  6.65 },
      { cip: "DIAG-MAL-TEST",    name: "Test paludisme rapide",                   pv:  12.00, pct: "-25%", pn:  9.00 },
    ]
  },
  otc: {
    label: "Centrale OTC / Para",
    subtitle: "Promotions ciblées – dès la 1re unité",
    color: "#1f3a5f",
    accent: "#0ea5e9",
    icon: "💙",
    columns: ["CIP13", "Désignation", "CIP13", "Prix catalogue", "Remise", "Prix remisé"],
    sort: "alpha",
    products: [
      // — A —
      { name: "Angispray flacon",                              cip: "3400930425657", pv:  7.86, pct: "-50%",   pn:  3.93 },
      { name: "Aqualarm U.P. Collyre 10ml",                    cip: "3614790000583", pv:  7.60, pct: "-45%",   pn:  4.18 },
      { name: "Arnican Crème 50g",                             cip: "3400934163913", pv:  6.25, pct: "-40%",   pn:  3.75 },
      { name: "Arnigel 45g",                                   cip: "3400930199848", pv:  5.99, pct: "-45%",   pn:  3.29 },
      { name: "Arnigel 120g",                                  cip: "3400930199855", pv: 13.30, pct: "-45%",   pn:  7.32 },
      { name: "Atovaquone/Proguanil EG BT100",                 cip: "3400922473192", pv: 16.81, pct: "-60%",   pn:  6.72 },
      { name: "Audispray lot de 2",                            cip: "3614810001934", pv: 15.48, pct: "-45%",   pn:  8.51 },
      // — B —
      { name: "Baume Aroma 50g",                               cip: "3400930065174", pv:  5.60, pct: "-40%",   pn:  3.36 },
      { name: "Baume Aroma 100g",                              cip: "3400938414387", pv:  8.51, pct: "-40%",   pn:  5.11 },
      { name: "Biocidan Collyre Unidoses BT10",                cip: "3400933834968", pv:  6.89, pct: "-40%",   pn:  4.13 },
      { name: "Biogaia Protectis Drops 5ml",                   cip: "7350012556341", pv: 13.99, pct: "-25%",   pn: 10.49 },
      // — C —
      { name: "Calyptol Inhalant 10 ampoules",                 cip: "3400930174555", pv:  5.10, pct: "-25%",   pn:  3.82 },
      { name: "Camilia 10 unidoses",                           cip: "3400936096295", pv:  6.45, pct: "-30%",   pn:  4.51 },
      { name: "Camilia 30 unidoses",                           cip: "3400939472898", pv: 13.91, pct: "-30%",   pn:  9.74 },
      { name: "Chondrosulf 400mg BT180",                       cip: "3400930174555", pv: 26.20, pct: "-22%",   pn: 20.44 },
      { name: "Chondrosulf 800mg BT60",                        cip: "3400930281178", pv: 24.90, pct: "-22%",   pn: 19.42 },
      { name: "Circadin 2mg BT30",                             cip: "3400922499857", pv: 22.30, pct: "-50%",   pn: 11.15 },
      { name: "Citrate Bétaïne Citron BT20",                   cip: "3400934965852", pv:  5.85, pct: "-35%",   pn:  3.80 },
      { name: "Coalgan Mèche 30cm",                            cip: "3401073757667", pv:  3.01, pct: "-35%",   pn:  1.96 },
      { name: "Cocculine 40 comprimés",                        cip: "3400939560120", pv:  8.05, pct: "-35%",   pn:  5.23 },
      { name: "Cocculine Unidoses BT8",                        cip: "3401073757667", pv: 10.25, pct: "-35%",   pn:  6.66 },
      { name: "Compeed Ampoules Assortiment BT5",              cip: "3574660720242", pv:  8.55, pct: "-36%",   pn:  5.47 },
      { name: "Compeed Ampoules Assortiment BT10",             cip: "3663555004960", pv: 13.69, pct: "-36%",   pn:  8.76 },
      { name: "Compeed Ampoules Extreme BT5",                  cip: "3574660634297", pv:  9.99, pct: "-36%",   pn:  6.39 },
      { name: "Compeed Ampoules Moyen Format BT5",             cip: "3574660115420", pv:  8.22, pct: "-36%",   pn:  5.26 },
      { name: "Compeed Ampoules Moyen Format BT10",            cip: "3663555004991", pv: 13.49, pct: "-36%",   pn:  8.63 },
      { name: "Compeed Ampoules Petit Format BT6",             cip: "3574660115390", pv:  8.41, pct: "-36%",   pn:  5.38 },
      { name: "Compeed Anti-Imperfections Grand BT7",          cip: "3663555005325", pv: 10.55, pct: "-36%",   pn:  6.75 },
      { name: "Compeed Anti-Imperfections Petit BT15",         cip: "3663555005370", pv: 10.55, pct: "-36%",   pn:  6.75 },
      { name: "Compeed Cors + Hydratant BT6",                  cip: "3574660696318", pv:  8.33, pct: "-36%",   pn:  5.33 },
      { name: "Compeed Cors Moyen Format BT10",                cip: "3574660115451", pv:  7.81, pct: "-36%",   pn:  5.00 },
      { name: "Compeed Durillons BT6",                         cip: "3574660115482", pv:  8.33, pct: "-36%",   pn:  5.33 },
      { name: "Compeed Patch Bouton Fièvre BT15",              cip: "3663555003536", pv: 10.67, pct: "-36%",   pn:  6.83 },
      { name: "Crème au Calendula 50ml",                       cip: "3400930617007", pv: 12.44, pct: "-35%",   pn:  8.09 },
      // — D —
      { name: "Delabarre Gel Gingival 20ml",                   cip: "3331300000825", pv:  6.56, pct: "-35%",   pn:  4.26 },
      { name: "Désmédine Flacon 10ml",                         cip: "3400930093832", pv:  7.14, pct: "-40%",   pn:  4.28 },
      { name: "Donormyl Comprimés Secs BT15",                  cip: "3400936751934", pv:  3.20, pct: "-40%",   pn:  1.92 },
      { name: "Drosetux Sirop 200ml",                          cip: "3400930043318", pv:  7.80, pct: "-45%",   pn:  4.29 },
      // — E —
      { name: "Efferalgan Vitamine C BT16",                    cip: "3400936373242", pv:  2.70, pct: "-30%",   pn:  1.89 },
      { name: "Elixya Gel 30ml",                               cip: "3614790000712", pv:  7.07, pct: "-14%",   pn:  6.08 },
      { name: "Eludrilpro Bain de Bouche 200ml",               cip: "3400934823824", pv:  5.64, pct: "-25%",   pn:  4.23 },
      { name: "Endotelon 60 comprimés",                        cip: "3400936367098", pv: 12.12, pct: "-10%",   pn: 10.91 },
      { name: "Euphoneo Miel-Citron 20 pastilles",             cip: "3760001043228", pv:  6.76, pct: "-40%",   pn:  4.06 },
      { name: "Euphoneo Menthe-Eucalyptus 20 pastilles",       cip: "3760001043181", pv:  6.76, pct: "-40%",   pn:  4.06 },
      { name: "Euphoneo Orange-Mandarine 20 pastilles",        cip: "3760001043181", pv:  6.76, pct: "-40%",   pn:  4.06 },
      { name: "Euphytose Nuit BT15",                           cip: "3401581631091", pv: 12.31, pct: "-15%",   pn: 10.46 },
      // — F —
      { name: "Fanolyte SRO 6 sachets",                        cip: "3401578630465", pv:  4.30, pct: "-40%",   pn:  2.58 },
      { name: "Fervex Sachet avec sucre BT8",                  cip: "3400932705917", pv:  6.50, pct: "-42%",   pn:  3.77 },
      { name: "Fervex Sachet sans sucre BT8",                  cip: "3400933359591", pv:  6.50, pct: "-42%",   pn:  3.77 },
      { name: "Flector Tissugel 140mg BT4",                    cip: "3400937822336", pv: 14.25, pct: "-22%",   pn: 11.12 },
      // — H —
      { name: "Homeoplasmine 18g",                             cip: "3400930137413", pv:  5.51, pct: "-25%",   pn:  4.13 },
      { name: "Homeoplasmine 40g",                             cip: "3400930137420", pv:  7.68, pct: "-25%",   pn:  5.76 },
      { name: "Homeoptic Collyre 10 unidoses",                 cip: "3400935875143", pv:  7.60, pct: "-35%",   pn:  4.94 },
      { name: "Hyalugel Forte Gel 20ml",                       cip: "3614819999867", pv:  9.95, pct: "-45%",   pn:  5.47 },
      // — M —
      { name: "Mercryl Antiseptique 200ml",                    cip: "3400935456748", pv:  6.12, pct: "-50%",   pn:  3.06 },
      { name: "Microlax 12 canules",                           cip: "3400934968815", pv: 10.50, pct: "-21%",   pn:  8.29 },
      { name: "Mildac 600mg BT30",                             cip: "3400938724332", pv: 23.07, pct: "-50%",   pn: 11.54 },
      { name: "Movicol Citron 20 sachets",                     cip: "3400930023421", pv:  8.55, pct: "-35%",   pn:  5.56 },
      { name: "Movicol Chocolat 20 sachets",                   cip: "3400930023422", pv:  8.55, pct: "-35%",   pn:  5.56 },
      { name: "Movicol Sans Arôme 20 sachets",                 cip: "3400930023423", pv:  8.55, pct: "-35%",   pn:  5.56 },
      { name: "Movigo 10 sachets",                             cip: "5012748616967", pv:  6.50, pct: "-33%",   pn:  4.35 },
      { name: "Movigo 20 sachets",                             cip: "5012748616974", pv:  7.90, pct: "-33%",   pn:  5.29 },
      // — N —
      { name: "Nausicalm Gélules BT15",                        cip: "3400933594923", pv:  5.49, pct: "-35%",   pn:  3.57 },
      { name: "Nausicalm Sirop 90ml",                          cip: "3400932760565", pv:  5.49, pct: "-35%",   pn:  3.57 },
      { name: "Neovis Total Collyre 15ml",                     cip: "3401060210120", pv:  9.35, pct: "-14%",   pn:  8.04 },
      { name: "Neovis Total Multi Collyre 15ml",               cip: "3664490000086", pv: 10.35, pct: "-30%",   pn:  7.24 },
      { name: "Nereya Flacon 10ml",                            cip: "3614790001054", pv:  6.70, pct: "-4,5%",  pn:  6.40 },
      // — O —
      { name: "ODM 5 Solution Oculaire 10ml",                  cip: "3664490022507", pv:  9.41, pct: "-14%",   pn:  8.09 },
      // — P —
      { name: "Perubore Inhalation 15 capsules",               cip: "3400949317066", pv:  6.04, pct: "-40%",   pn:  3.62 },
      { name: "Polysilane Gel 20 sachets",                     cip: "3400933657598", pv:  5.20, pct: "-25%",   pn:  3.90 },
      { name: "Prontalgine 500mg BT18",                        cip: "3400936171497", pv:  6.50, pct: "-35%",   pn:  4.23 },
      { name: "Prostamol BT30",                                cip: "3401560315189", pv: 22.05, pct: "-50%",   pn: 11.03 },
      { name: "Prostamol BT90",                                cip: "3664951000068", pv: 44.07, pct: "-50%",   pn: 22.04 },
      { name: "Pyralvex Solution 10ml",                        cip: "3400933698522", pv:  6.91, pct: "-30%",   pn:  4.84 },
      // — Q —
      { name: "Quietude Comprimés BT30",                       cip: "3400949317066", pv:  6.04, pct: "-35%",   pn:  3.93 },
      // — R —
      { name: "Rebelle Bonbons Berries Power 100g",            cip: "3770028156009", pv:  2.61, pct: "-36%",   pn:  1.67 },
      { name: "Rebelle Bonbons Mango Power 100g",              cip: "3770028156016", pv:  2.61, pct: "-36%",   pn:  1.67 },
      { name: "Rebelle Bouteilles Roses & Bleues ss sucres",   cip: "3770028156177", pv:  2.61, pct: "-36%",   pn:  1.67 },
      { name: "Rebelle Good Cola Acidulé 100g",                cip: "3770028156139", pv:  2.61, pct: "-36%",   pn:  1.67 },
      { name: "Rebelle Oursons Acidulés sans sucres 100g",     cip: "3770028156160", pv:  2.61, pct: "-36%",   pn:  1.67 },
      { name: "Rebelle Oursons Fruity Bears 100g",             cip: "3770028156023", pv:  2.61, pct: "-36%",   pn:  1.67 },
      { name: "Rebelle Pêches sans sucres 100g",               cip: "3770028156153", pv:  2.61, pct: "-36%",   pn:  1.67 },
      { name: "Rebelle Sucettes Magic Lollipops",              cip: "3770028156146", pv:  2.61, pct: "-36%",   pn:  1.67 },
      { name: "Rhinallergy Comprimés BT30",                    cip: "3400939172132", pv:  7.19, pct: "-35%",   pn:  4.67 },
      // — S —
      { name: "Sédatif PC BT90",                               cip: "3400930217542", pv: 11.63, pct: "-30%",   pn:  8.14 },
      { name: "Sedorrhoïde Crème Rectale 30g",                 cip: "3400937625845", pv:  5.97, pct: "-45%",   pn:  3.28 },
      { name: "Sedorrhoïde Suppositoires BT12",                cip: "3400930007877", pv:  6.47, pct: "-45%",   pn:  3.56 },
      { name: "Smectalia 12 sachets",                          cip: "3400930007877", pv:  5.88, pct: "-30%",   pn:  4.12 },
      { name: "Smectalia 18 sachets",                          cip: "3400949313792", pv:  4.85, pct: "-30%",   pn:  3.39 },
      { name: "Sportenine BT40",                               cip: "3400930066348", pv: 14.84, pct: "-45%",   pn:  8.16 },
      { name: "Stodal Sirop 200ml",                            cip: "3400930157886", pv:  7.70, pct: "-45%",   pn:  4.24 },
      { name: "Stodaline Sirop 200ml",                         cip: "3400927999413", pv:  8.16, pct: "-45%",   pn:  4.49 },
      // — T —
      { name: "Tiger Balm Baume Nuque Épaules 50g",            cip: "8888650407217", pv:  8.25, pct: "-37%",   pn:  5.20 },
      { name: "Tiger Balm Blanc 19g",                          cip: "8888650403066", pv:  7.60, pct: "-37%",   pn:  4.79 },
      { name: "Tiger Balm Blanc 30g",                          cip: "8888650414031", pv: 11.58, pct: "-37%",   pn:  7.30 },
      { name: "Tiger Balm Fluide 90ml",                        cip: "8888650500178", pv:  8.25, pct: "-37%",   pn:  5.20 },
      { name: "Tiger Balm Lotion 28ml",                        cip: "8888650420025", pv:  7.60, pct: "-37%",   pn:  4.79 },
      { name: "Tiger Balm Rouge 19g",                          cip: "8888650404063", pv:  7.60, pct: "-37%",   pn:  4.79 },
      { name: "Tiger Balm Rouge 30g",                          cip: "3400933038304", pv: 11.58, pct: "-37%",   pn:  7.30 },
      // — U —
      { name: "Ultra Baby 14 sachets",                         cip: "3401560200683", pv:  8.44, pct: "-31%",   pn:  5.82 },
      { name: "Ultra Protect ATB 10 gélules",                  cip: "3583310000610", pv:  8.82, pct: "-31%",   pn:  6.09 },
      { name: "Ultra-Levure 100mg Sachet BT10",                cip: "3400934379444", pv:  6.38, pct: "-31%",   pn:  4.40 },
      { name: "Ultra-Levure 200mg BT10",                       cip: "3400922096612", pv:  6.25, pct: "-31%",   pn:  4.31 },
      { name: "Ultra-Levure 200mg BT30",                       cip: "3400937607407", pv: 14.17, pct: "-31%",   pn:  9.78 },
      // — V —
      { name: "Vismed Gel Multi 15ml",                         cip: "4028694001413", pv: 10.35, pct: "-14%",   pn:  8.90 },
      { name: "Vismed Gel Unidose BT20",                       cip: "3614810001644", pv: 10.35, pct: "-14%",   pn:  8.90 },
      { name: "Vismed Multi 15ml",                             cip: "4028694001468", pv: 10.35, pct: "-16%",   pn:  8.69 },
      { name: "Vismed Unidose BT20",                           cip: "3401074936030", pv:  6.71, pct: "-14%",   pn:  5.77 },
      { name: "Vit C 1000mg UPSA Effervescent BT20",           cip: "3585550000535", pv:  5.20, pct: "-40%",   pn:  3.12 },
      { name: "Vitascorbol à Croquer 24 comprimés",            cip: "3614810001644", pv:  4.80, pct: "-50%",   pn:  2.40 },
      { name: "Vocadys Pâtes à Sucer BT30",                    cip: "3400932684472", pv:  7.90, pct: "-40%",   pn:  4.74 },
    ]
  }
};
const fmt = (n) => n != null ? n.toFixed(2).replace(".", ",") + " €" : "–";

// ── Copy CIP button ──────────────────────────────────────────────────────────
function CipCell({ cip }) {
  const [copied, setCopied] = React.useState(false);
  if (!cip || cip === "–") return <span style={{ fontFamily:"monospace", fontSize:11, color:"#bbb" }}>–</span>;
  const copy = () => {
    navigator.clipboard.writeText(cip).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
      <span style={{ fontFamily:"monospace", fontSize:11, color:"#888" }}>{cip}</span>
      <button onClick={copy} title="Copier CIP" style={{
        background: copied ? "#dcfce7" : "#f0f2f5", border:"none", borderRadius:4,
        padding:"1px 5px", cursor:"pointer", fontSize:9, color: copied ? "#166534" : "#999",
        fontWeight:700, lineHeight:"14px", transition:"all 0.2s"
      }}>{copied ? "✓" : "⎘"}</button>
    </span>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState("expert");
  const [quantities, setQuantities] = useState({});
  const [cartOpen, setCartOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [sendStatus, setSendStatus] = useState(null);
  const [showAdmin, setShowAdmin] = useState(false);

  const [adminProducts, setAdminProducts] = useState(() => {
    try { return JSON.parse(localStorage.getItem("admin_products") || "[]"); } catch { return []; }
  });

  const [adminOverrides, setAdminOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem("admin_overrides") || "{}"); } catch { return {}; }
  });
  const [promoSections, setPromoSections] = useState(() => {
    try { return JSON.parse(localStorage.getItem("admin_promos") || "[]"); } catch { return []; }
  });
  const [promoPopupOpen, setPromoPopupOpen] = useState(false);
  const [stockData, setStockData] = useState({}); // { [cip]: { dispo, stock } }
  const [stockUpdatedAt, setStockUpdatedAt] = useState(null);

  // Stock : chargement et actualisation manuelle
  const [stockLoading, setStockLoading] = useState(false);

  const fetchStock = useCallback(async () => {
    setStockLoading(true);
    try {
      const res = await fetch("/.netlify/functions/stock-get", { signal: AbortSignal.timeout(20000) });
      const data = await res.json();
      if (data.error) console.warn("[stock] Erreur Odoo:", data.error);
      if (data.stocks) {
        const count = Object.values(data.stocks).filter(s => s.dispo === 0).length;
        console.log(`[stock] ${Object.keys(data.stocks).length} produits, ${count} rupture(s)`);
        setStockData(data.stocks);
        setStockUpdatedAt(data.updatedAt || new Date().toISOString());
      }
    } catch(e) { console.warn("[stock] fetch error:", e.message); }
    finally { setStockLoading(false); }
  }, []);

  useEffect(() => {
    fetchStock();
    const interval = setInterval(fetchStock, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchStock]);

  const CATALOG_WITH_ADMIN = useMemo(() => {
    const merged = {};
    Object.entries(CATALOG).forEach(([k, v]) => {
      const patched = v.products.map(p => {
        const key = `${k}::${p.cip || p.name}`;
        const ov = adminOverrides[key];
        if (!ov) return p;
        return {
          ...p,
          ...(ov.cip    != null ? { cip: ov.cip }                         : {}),
          ...(ov.pv     != null ? { pv: ov.pv }                          : {}),
          ...(ov.pct    != null ? { pct: `-${ov.pct}%`, remise: ov.pct } : {}),
          ...(ov.pn     != null ? { pn: ov.pn, pb: ov.pn }               : {}),
          ...(ov.palier != null ? { palier: ov.palier, colis: ov.palier } : {}),
          ...(ov.note   != null ? { note: ov.note }                       : {}),
          _overridden: true,
        };
      });
      const extras = adminProducts.filter(p => p.section === k).map(p => ({
        name: p.name, cip: p.cip, pv: p.pv, pct: p.pct, pn: p.pn,
        palier: p.palier, colis: p.palier, note: p.note, isAdmin: true
      }));
      merged[k] = { ...v, products: [...patched, ...extras] };
    });
    // Inject active promo sections as dynamic tabs
    promoSections.filter(ps => ps.active).forEach(ps => {
      merged[`promo_${ps.id}`] = {
        label: ps.name,
        icon: ps.icon || "🏷️",
        subtitle: ps.description || "",
        color: ps.color || "#7c3aed",
        accent: ps.accentColor || "#a855f7",
        columns: ["CIP", "Désignation", "Prix", "Remise", "Prix net"],
        products: (ps.products || []),
        isPromo: true,
        promoId: ps.id,
      };
    });
    return merged;
  }, [adminProducts, adminOverrides, promoSections]);

  // Onboarding
  const [onboardingDone, setOnboardingDone] = useState(() => !!localStorage.getItem("session_email"));
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  // Onboarding flow: "email" | "confirm" | "new_client"
  const [obStep, setObStep] = useState("email");
  const [emailInput, setEmailInput] = useState("");
  const [foundPharmacy, setFoundPharmacy] = useState(null);
  const [pharmacyName, setPharmacyName] = useState(() => localStorage.getItem("session_name") || "");
  const [pharmacyEmail, setPharmacyEmail] = useState(() => localStorage.getItem("session_email") || "");
  const [isClient, setIsClient] = useState(null);
  const [ribFile, setRibFile] = useState(null);
  const [ribBase64, setRibBase64] = useState(null);
  const [onboardingError, setOnboardingError] = useState("");
  // New client form
  const [ncName, setNcName] = useState("");
  const [ncTel, setNcTel] = useState("");
  const [ncVille, setNcVille] = useState("");
  const [ncSending, setNcSending] = useState(false);
  const [ncSent, setNcSent] = useState(false);

  const getStep = (catKey, p) => {
    if (catKey === "stratege") return p.colis || 1;
    if (catKey === "master") return p.palier || 1;
    if (catKey === "blanche") return p.colis || 1;
    return 1;
  };

  const setQty = (key, val, step = 1) => {
    const raw = Math.max(0, parseInt(val) || 0);
    // Snap to nearest multiple of step
    const snapped = step > 1 ? Math.round(raw / step) * step : raw;
    setQuantities(prev => ({ ...prev, [key]: snapped }));
  };

  const cartItems = useMemo(() => {
    const items = [];
    Object.entries(CATALOG_WITH_ADMIN).forEach(([catKey, cat]) => {
      cat.products.forEach((p, idx) => {
        const key = `${catKey}-${idx}`;
        const qty = quantities[key] || 0;
        if (qty > 0 && p.pn != null) {
          items.push({
            key,
            cat: cat.label,
            name: p.name,
            cip: p.cip || null,
            pn: p.pn,
            qty,
            total: p.pn * qty,
            color: cat.accent,
            step: getStep(catKey, p),
          });
        }
      });
    });
    return items;
  }, [quantities, CATALOG_WITH_ADMIN]);

  const cartTotal = cartItems.reduce((s, i) => s + i.total, 0);
  const cartCount = cartItems.reduce((s, i) => s + i.qty, 0);

  const cat = CATALOG_WITH_ADMIN[activeTab];

  const globalResults = globalSearch.trim().length >= 2
    ? Object.entries(CATALOG_WITH_ADMIN).flatMap(([catKey, c]) =>
        c.products
          .filter(p => p.name.toLowerCase().includes(globalSearch.toLowerCase()) || (p.cip||"").includes(globalSearch))
          .map(p => ({ ...p, _catKey: catKey, _catLabel: c.label, _catIcon: c.icon, _catAccent: c.accent,
            _idx: c.products.indexOf(p) }))
      )
    : [];

  const filteredProducts = (() => {
    const filtered = cat.products.filter(p =>
      search === "" || p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.cip && p.cip.includes(search))
    );
    if (activeTab === "otc" || activeTab === "nr") {
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name, "fr"));
    }
    return filtered;
  })();

  const handlePrint = () => {
    window.print();
  };

  const [copyStatus, setCopyStatus] = useState("");
  const handleCopy = () => {
    if (cartItems.length === 0) return;
    const date = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const lines = [
      `BON DE COMMANDE — ELIXIR PHARMA`,
      `Publication 6 — Février 2026`,
      `Date : ${date}`,
      `Pharmacie : ${pharmacyName}`,
      ``,
      `${"─".repeat(70)}`,
      `CIP/Réf           Désignation                            Qté  P.Net    Total`,
      `${"─".repeat(70)}`,
      ...cartItems.map(i => {
        const cip = (i.cip || "—").substring(0, 16).padEnd(18);
        const nm  = i.name.substring(0, 36).padEnd(38);
        const qty = String(i.qty).padStart(4);
        const pn  = (i.pn != null ? i.pn.toFixed(2)+"€" : "—").padStart(9);
        const tot = (i.pn != null ? (i.pn*i.qty).toFixed(2)+"€" : "—").padStart(9);
        return `${cip}${nm}${qty}${pn}${tot}`;
      }),
      `${"─".repeat(70)}`,
      `TOTAL : ${cartItems.reduce((s,i)=>s+(i.pn||0)*i.qty,0).toFixed(2)} €`,
    ].join("\n");
    navigator.clipboard.writeText(lines).then(() => {
      setCopyStatus("✓ Copié !");
      setTimeout(() => setCopyStatus(""), 2500);
    }).catch(() => setCopyStatus("Erreur copie"));
  };

  const handleRibUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setRibFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setRibBase64(ev.target.result.split(",")[1]);
    reader.readAsDataURL(file);
  };

  const handleEmailLookup = () => {
    const email = emailInput.trim().toLowerCase();
    if (!email || !email.includes("@")) { setOnboardingError("Veuillez saisir une adresse e-mail valide."); return; }
    setOnboardingError("");
    const found = PHARMACIES_DB[email] || null;
    if (found) {
      setFoundPharmacy(found);
      setObStep("confirm");
    } else {
      setObStep("new_client");
    }
  };

  const handleConfirmPharmacy = () => {
    setPharmacyName(foundPharmacy.name);
    setPharmacyEmail(foundPharmacy.email);
    localStorage.setItem("session_name", foundPharmacy.name);
    localStorage.setItem("session_email", foundPharmacy.email);
    setIsClient(true);
    setOnboardingDone(true);
    // Show promo popup if active promos exist
    try {
      const promos = JSON.parse(localStorage.getItem("admin_promos") || "[]");
      if (promos.some(p => p.active)) setPromoPopupOpen(true);
    } catch {}
  };

  const handleNewClientSubmit = async () => {
    if (!ncName.trim()) { setOnboardingError("Veuillez saisir le nom de la pharmacie."); return; }
    setOnboardingError("");
    setNcSending(true);
    // Send via EmailJS to notify Elixir Pharma of new prospect
    try {
      await emailjs.send(
        EMAILJS_CONFIG.SERVICE_ID,
        EMAILJS_CONFIG.TEMPLATE_ID,
        {
          to_email: DEFAULT_RECIPIENT,
          pharmacy_name: ncName,
          pharmacy_email: emailInput.trim().toLowerCase(),
          is_client: "Non – NOUVEAU PROSPECT",
          order_date: new Date().toLocaleDateString("fr-FR"),
          order_lines: `Demande d'accès nouvelle pharmacie:\n  Nom : ${ncName}\n  Email : ${emailInput.trim()}\n  Tél : ${ncTel}\n  Ville : ${ncVille}`,
          total_ht: "—",
          nb_lignes: 0,
          nb_unites: 0,
        },
        EMAILJS_CONFIG.PUBLIC_KEY
      );
    } catch(e) { console.error(e); }
    setNcSending(false);
    setNcSent(true);
  };

  const handleOnboarding = () => {
    // legacy fallback — not used anymore
    setOnboardingDone(true);
  };

  const handleSend = async () => {
    if (cartItems.length === 0) return;
    setSendStatus("sending");

    const date = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const lignes = cartItems.map(i =>
      `• ${i.name}\n  Qté : ${i.qty}  |  PU : ${i.pn.toFixed(2).replace(".", ",")} €  |  Total : ${i.total.toFixed(2).replace(".", ",")} €`
    ).join("\n\n");

    // Build CSV and save order to localStorage for admin
    // Build catalog CIP lookup for fallback
    const cipLookup = {};
    Object.values(CATALOG_WITH_ADMIN).forEach(section => {
      (section.products || []).forEach(p => {
        if (p.cip && p.name) cipLookup[p.name.trim().toLowerCase()] = p.cip;
      });
    });
    const csvLines = [];
    cartItems.forEach(i => {
      let cip = i.cip || cipLookup[i.name?.trim().toLowerCase()] || "—";
      csvLines.push(`${cip.replace(/;/g,"")};${i.qty}`);
    });
    const csvContent = csvLines.join("\n");

    const templateParams = {
      to_email:      DEFAULT_RECIPIENT,
      pharmacy_name: pharmacyName,
      pharmacy_email: pharmacyEmail,
      is_client:     isClient ? "Oui" : "Non (nouveau client – RIB joint)",
      order_date:    date,
      order_lines:   lignes,
      total_ht:      cartTotal.toFixed(2).replace(".", ",") + " €",
      nb_lignes:     cartItems.length,
      nb_unites:     cartCount,
    };

    try {
      await emailjs.send(
        EMAILJS_CONFIG.SERVICE_ID,
        EMAILJS_CONFIG.TEMPLATE_ID,
        templateParams,
        EMAILJS_CONFIG.PUBLIC_KEY
      );
      setSendStatus("success");
      // Save order to localStorage for admin panel
      try {
        const order = {
          id: Date.now(),
          date: new Date().toISOString(),
          pharmacyName,
          pharmacyEmail,
          isClient,
          items: cartItems.map(i => ({ cip: i.cip || null, name: i.name, qty: i.qty, pn: i.pn, total: i.total })),
          totalHt: cartTotal,
          nbLignes: cartItems.length,
          csv: csvContent,
          processed: false,
        };
        const existing = JSON.parse(localStorage.getItem("admin_orders") || "[]");
        localStorage.setItem("admin_orders", JSON.stringify([order, ...existing]));

        // ── Auto-submit vers PharmaML ──
        // Essaie d'abord l'agent local (port 3001), sinon fallback Netlify Function
        (async () => {
          const payload = JSON.stringify({
            csvContent, pharmacyName, pharmacyEmail, orderId: order.id,
          });
          const endpoints = [
            { url: "http://localhost:3001", label: "agent local" },
            { url: "/.netlify/functions/submit-order", label: "Netlify Function" },
          ];
          for (const ep of endpoints) {
            try {
              const res = await fetch(ep.url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: payload,
                signal: AbortSignal.timeout(5000),
              });
              const json = await res.json().catch(() => ({}));
              if (res.ok && json.success) {
                console.log(`[PharmaML] ✓ Commande transmise via ${ep.label} — ${json.nbLignes} ligne(s)`);
                return;
              }
              console.warn(`[PharmaML] ${ep.label} error :`, json.error || res.status);
            } catch (err) {
              console.warn(`[PharmaML] ${ep.label} injoignable :`, err.message);
            }
          }
          console.warn("[PharmaML] Tous les endpoints ont échoué.");
        })();

      } catch(e) { console.error("Order save error", e); }
      setTimeout(() => {
        setSendStatus(null);
        setQuantities({});
        setCartOpen(false);
      }, 3000);
    } catch (err) {
      console.error("EmailJS error:", err);
      setSendStatus("error");
      setTimeout(() => setSendStatus(null), 5000);
    }
  };

  // ── ONBOARDING SCREEN ──────────────────────────────────────────────
  const obBg = { minHeight:"100vh", background:"linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 60%, #16637a 100%)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans','Segoe UI',sans-serif", padding:24 };
  const obCard = { background:"white", borderRadius:20, padding:"40px 44px", maxWidth:480, width:"100%", boxShadow:"0 24px 64px rgba(0,0,0,0.35)" };
  const obInput = { width:"100%", border:"1.5px solid #e2e8f0", borderRadius:10, padding:"10px 14px", fontSize:14, outline:"none", boxSizing:"border-box" };
  const obBtn = { width:"100%", background:"linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 100%)", color:"white", border:"none", borderRadius:12, padding:"14px", fontWeight:800, fontSize:15, cursor:"pointer" };
  const obLabel = { fontSize:12, fontWeight:700, color:"#444", display:"block", marginBottom:6 };
  const obLogo = (
    <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:28 }}>
      <div style={{ background:"#0f2d3d", borderRadius:10, padding:"6px 14px", fontWeight:800, fontSize:20, letterSpacing:2, color:"white" }}>ELIXIR</div>
      <div>
        <div style={{ fontWeight:700, fontSize:13, color:"#0f2d3d", letterSpacing:1 }}>PHARMA</div>
        <div style={{ fontSize:11, color:"#aaa" }}>Bon de commande – Catalogue Février 2026</div>
      </div>
    </div>
  );
  const obFooter = (
    <>
      <div style={{ fontSize:11, color:"#bbb", textAlign:"center", marginTop:14 }}>Elixir Pharma · pharmacien@elixirpharma.fr · 01 86 04 39 95</div>
      <div style={{ textAlign:"center", marginTop:8 }}>
        <button onClick={() => setShowAdminLogin(true)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:11, color:"#ddd", textDecoration:"underline", padding:0 }}>Accès administrateur</button>
      </div>
    </>
  );

  if (!onboardingDone) return (
    <div style={obBg}>

      {/* ── STEP 1 : EMAIL ── */}
      {obStep === "email" && (
        <div style={obCard}>
          {obLogo}
          <div style={{ fontWeight:800, fontSize:20, color:"#0f2d3d", marginBottom:6 }}>Bienvenue 👋</div>
          <div style={{ fontSize:13, color:"#666", marginBottom:28 }}>Saisissez votre adresse e-mail pour accéder au catalogue</div>
          <label style={obLabel}>Adresse e-mail</label>
          <input
            type="email" value={emailInput}
            onChange={e => { setEmailInput(e.target.value); setOnboardingError(""); }}
            onKeyDown={e => e.key==="Enter" && handleEmailLookup()}
            placeholder="pharmacie@exemple.fr"
            style={{ ...obInput, marginBottom:16 }}
            autoFocus
          />
          {onboardingError && <div style={{ background:"#fff5f5", border:"1px solid #fed7d7", borderRadius:10, padding:"10px 14px", fontSize:13, color:"#c53030", marginBottom:16 }}>⚠️ {onboardingError}</div>}
          <button onClick={handleEmailLookup} style={obBtn}>Continuer →</button>
          {obFooter}
        </div>
      )}

      {/* ── STEP 2 : CONFIRM ── */}
      {obStep === "confirm" && foundPharmacy && (
        <div style={obCard}>
          {obLogo}
          <div style={{ fontWeight:800, fontSize:20, color:"#0f2d3d", marginBottom:6 }}>Pharmacie reconnue ✓</div>
          <div style={{ fontSize:13, color:"#666", marginBottom:20 }}>Nous avons trouvé un compte associé à cet e-mail :</div>
          <div style={{ background:"#f0fdf4", border:"2px solid #86efac", borderRadius:14, padding:"18px 20px", marginBottom:24 }}>
            <div style={{ fontWeight:800, fontSize:17, color:"#0f2d3d", marginBottom:4 }}>🏥 {foundPharmacy.name}</div>
            {foundPharmacy.street && <div style={{ fontSize:13, color:"#555" }}>{foundPharmacy.street}</div>}
            <div style={{ fontSize:13, color:"#555" }}>{foundPharmacy.cp} {foundPharmacy.ville}</div>
            {foundPharmacy.tel && <div style={{ fontSize:12, color:"#888", marginTop:4 }}>📞 {foundPharmacy.tel}</div>}
          </div>
          <div style={{ fontSize:14, fontWeight:700, color:"#0f2d3d", marginBottom:14, textAlign:"center" }}>
            Êtes-vous bien cette pharmacie ?
          </div>
          <div style={{ display:"flex", gap:12 }}>
            <button onClick={handleConfirmPharmacy} style={{ ...obBtn, flex:1 }}>✅ Oui, c'est moi</button>
            <button onClick={() => { setObStep("email"); setFoundPharmacy(null); setEmailInput(""); }} style={{ flex:1, background:"#f0f2f5", color:"#374151", border:"none", borderRadius:12, padding:"14px", fontWeight:700, fontSize:14, cursor:"pointer" }}>
              ← Retour
            </button>
          </div>
          {obFooter}
        </div>
      )}

      {/* ── STEP 3 : NEW CLIENT ── */}
      {obStep === "new_client" && (
        <div style={obCard}>
          {obLogo}
          <div style={{ fontWeight:800, fontSize:18, color:"#0f2d3d", marginBottom:4 }}>Pharmacie non reconnue</div>
          <div style={{ fontSize:13, color:"#666", marginBottom:24 }}>
            L'adresse <strong>{emailInput}</strong> n'est pas encore dans notre base clients.
          </div>
          <div style={{ background:"#eff6ff", border:"2px solid #93c5fd", borderRadius:14, padding:"20px", marginBottom:24, textAlign:"center" }}>
            <div style={{ fontSize:32, marginBottom:10 }}>📋</div>
            <div style={{ fontWeight:700, fontSize:15, color:"#1e40af", marginBottom:8 }}>Devenez client Elixir Pharma</div>
            <div style={{ fontSize:13, color:"#3b82f6", marginBottom:18 }}>Remplissez notre formulaire de demande d'accès — notre équipe vous contactera sous 24h ouvrées.</div>
            <a
              href="https://form.asana.com/?k=9APiLAEcOh9v6OrT8il4mg&d=1208646355437005"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display:"inline-block", background:"linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 100%)", color:"white", borderRadius:12, padding:"13px 28px", fontWeight:800, fontSize:14, textDecoration:"none" }}
            >
              Accéder au formulaire →
            </a>
          </div>
          <button onClick={() => { setObStep("email"); setOnboardingError(""); }} style={{ width:"100%", background:"none", border:"none", cursor:"pointer", fontSize:12, color:"#999", textDecoration:"underline" }}>← Retour</button>
          {obFooter}
        </div>
      )}

      {showAdminLogin && (
        <AdminPanel
          catalog={CATALOG}
          onClose={() => {
            setShowAdminLogin(false);
            try { setAdminProducts(JSON.parse(localStorage.getItem("admin_products") || "[]")); } catch {}
            try { setAdminOverrides(JSON.parse(localStorage.getItem("admin_overrides") || "{}")); } catch {}
            try { setPromoSections(JSON.parse(localStorage.getItem("admin_promos") || "[]")); } catch {}
          }}
        />
      )}
    </div>
  );

  return (
    <div style={{ fontFamily: "'DM Sans', 'Segoe UI', sans-serif", minHeight: "100vh", background: "#f0f4f8", display: "flex", flexDirection: "column" }}>

      {/* ── PROMO POPUP ── */}
      {promoPopupOpen && promoSections.some(p => p.active) && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", padding:16, backdropFilter:"blur(4px)" }}>
          <div style={{ background:"white", borderRadius:20, padding:"36px 40px", maxWidth:480, width:"100%", boxShadow:"0 24px 64px rgba(0,0,0,0.4)", fontFamily:"'DM Sans','Segoe UI',sans-serif" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
              <div>
                <div style={{ fontWeight:800, fontSize:20, color:"#0f2d3d" }}>🎉 Offres du moment</div>
                <div style={{ fontSize:13, color:"#666", marginTop:4 }}>Des promotions exclusives sont disponibles cette semaine !</div>
              </div>
              <button onClick={() => setPromoPopupOpen(false)} style={{ background:"#f0f2f5", border:"none", borderRadius:8, width:32, height:32, cursor:"pointer", fontSize:16 }}>✕</button>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {promoSections.filter(p => p.active).map(ps => (
                <button key={ps.id} onClick={() => { setActiveTab(`promo_${ps.id}`); setPromoPopupOpen(false); }} style={{
                  display:"flex", alignItems:"center", gap:14, background:`linear-gradient(135deg, ${ps.color}15, ${ps.accentColor || ps.color}25)`,
                  border:`2px solid ${ps.color}40`, borderRadius:14, padding:"14px 18px", cursor:"pointer", textAlign:"left", width:"100%"
                }}>
                  <span style={{ fontSize:28 }}>{ps.icon || "🏷️"}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:800, fontSize:15, color:"#0f2d3d" }}>{ps.name}</div>
                    {ps.description && <div style={{ fontSize:12, color:"#666", marginTop:2 }}>{ps.description}</div>}
                    {ps.endDate && <div style={{ fontSize:11, color:"#e07b39", marginTop:3, fontWeight:600 }}>⏰ Jusqu'au {ps.endDate}</div>}
                    <div style={{ fontSize:11, color:ps.color, fontWeight:700, marginTop:4 }}>{(ps.products||[]).length} référence(s) → Voir les offres</div>
                  </div>
                  <span style={{ fontSize:18, color:ps.color }}>→</span>
                </button>
              ))}
            </div>
            <button onClick={() => setPromoPopupOpen(false)} style={{ width:"100%", background:"#f0f2f5", border:"none", borderRadius:12, padding:"12px", fontWeight:700, fontSize:13, cursor:"pointer", marginTop:20, color:"#555" }}>
              Continuer vers le catalogue
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header style={{
        background: "linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 60%, #16637a 100%)",
        color: "white", padding: "0", position: "sticky", top: 0, zIndex: 100,
        boxShadow: "0 4px 20px rgba(0,0,0,0.3)"
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ background: "#2d9cbc", borderRadius: 10, padding: "6px 12px", fontWeight: 800, fontSize: 20, letterSpacing: 2 }}>
              ELIXIR
            </div>
            <div>
              <div style={{ fontSize: 13, opacity: 0.7, letterSpacing: 1 }}>PHARMA</div>
              <div style={{ fontSize: 11, opacity: 0.5 }}>
                Bon de commande – Catalogue Février 2026
                {stockUpdatedAt && (
                  <span style={{ marginLeft: 8, opacity: 0.7 }}>· stocks mis à jour {new Date(stockUpdatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                )}
                <button
                  onClick={fetchStock}
                  disabled={stockLoading}
                  title="Actualiser les stocks"
                  style={{ marginLeft: 8, background: "none", border: "none", cursor: stockLoading ? "default" : "pointer", padding: "0 2px", opacity: stockLoading ? 0.4 : 0.8, fontSize: 13, color: "inherit" }}
                >{stockLoading ? "⏳" : "🔄"}</button>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{
              background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 8, color: "rgba(255,255,255,0.9)", padding: "6px 14px", fontSize: 13, fontWeight: 600
            }}>
              🏥 {pharmacyName}
            </div>
            <button onClick={handlePrint} style={{
              background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)",
              color: "white", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 12
            }}>🖨 Imprimer</button>
            <button onClick={() => setShowAdmin(true)} style={{
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
              color: "rgba(255,255,255,0.5)", borderRadius: 8, padding: "6px 10px",
              cursor: "pointer", fontSize: 12, title: "Administration"
            }} title="Administration">⚙️</button>
            <button onClick={() => setCartOpen(!cartOpen)} style={{
              background: cartCount > 0 ? "#10b981" : "rgba(255,255,255,0.15)",
              border: "none", color: "white", borderRadius: 10, padding: "8px 16px",
              cursor: "pointer", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8,
              transition: "all 0.2s"
            }}>
              🛒 Panier {cartCount > 0 && <span style={{
                background: "white", color: "#10b981", borderRadius: 20,
                padding: "2px 8px", fontSize: 12, fontWeight: 800
              }}>{cartCount}</span>}
            </button>
          </div>
        </div>

        {/* Global search bar */}
        <div style={{ padding: "8px 24px 0", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ position: "relative", maxWidth: 480 }}>
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:14, opacity:0.6 }}>🔍</span>
            <input
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
              placeholder="Recherche toutes sections — nom ou CIP..."
              style={{
                width: "100%", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 10, color: "white", padding: "7px 14px 7px 34px", fontSize: 13,
                outline: "none", boxSizing: "border-box",
              }}
            />
            {globalSearch && (
              <button onClick={() => setGlobalSearch("")} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"rgba(255,255,255,0.5)", cursor:"pointer", fontSize:16, padding:0 }}>✕</button>
            )}
          </div>
        </div>

        {/* Tab nav */}
        <div style={{ display: "flex", overflowX: "auto", paddingBottom: 0, borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: 8 }}>
          {Object.entries(CATALOG_WITH_ADMIN).map(([key, c]) => (
            <button key={key} onClick={() => { setActiveTab(key); setSearch(""); }} style={{
              background: activeTab === key ? "rgba(255,255,255,0.15)" : "transparent",
              border: "none", color: activeTab === key ? "white" : "rgba(255,255,255,0.55)",
              padding: "10px 16px", cursor: "pointer", fontSize: 12, fontWeight: 600,
              whiteSpace: "nowrap", borderBottom: activeTab === key ? `3px solid ${c.accent}` : "3px solid transparent",
              transition: "all 0.2s"
            }}>
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, position: "relative" }}>
        {/* Main content */}
        <main style={{ flex: 1, padding: "20px 24px", minWidth: 0 }}>

          {/* ── GLOBAL SEARCH RESULTS ── */}
          {globalSearch.trim().length >= 2 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: "#0f2d3d", marginBottom: 12, display:"flex", alignItems:"center", gap:10 }}>
                🔍 Résultats pour « {globalSearch} »
                <span style={{ fontSize:12, fontWeight:400, color:"#888", background:"#f0f2f5", borderRadius:8, padding:"2px 10px" }}>
                  {globalResults.length} produit(s) trouvé(s)
                </span>
              </div>
              {globalResults.length === 0 ? (
                <div style={{ background:"white", borderRadius:14, padding:"32px", textAlign:"center", color:"#aaa", fontSize:14 }}>
                  Aucun produit trouvé pour « {globalSearch} »
                </div>
              ) : (
                <div style={{ background:"white", borderRadius:14, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse" }}>
                    <thead>
                      <tr style={{ background:"#0f2d3d" }}>
                        {["Section","CIP","Désignation","Prix net",""].map(h => (
                          <th key={h} style={{ color:"white", padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:700, letterSpacing:0.5 }}>{h.toUpperCase()}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {globalResults.map((p, i) => {
                        const qKey = `${p._catKey}-${p._idx}`;
                        const qty = quantities[qKey] || 0;
                        const step = getStep(p._catKey, p);
                        return (
                          <tr key={i} style={{ background: i%2===0?"white":"#fafbfc", borderBottom:"1px solid #f0f2f5" }}
                            onMouseEnter={e => e.currentTarget.style.background=`${p._catAccent}10`}
                            onMouseLeave={e => e.currentTarget.style.background=i%2===0?"white":"#fafbfc"}>
                            <td style={{ padding:"10px 14px" }}>
                              <button onClick={() => { setActiveTab(p._catKey); setGlobalSearch(""); }} style={{ background:`${p._catAccent}20`, border:"none", borderRadius:6, padding:"3px 8px", fontSize:11, fontWeight:700, color:p._catAccent, cursor:"pointer", whiteSpace:"nowrap" }}>
                                {p._catIcon} {p._catLabel}
                              </button>
                            </td>
                            <td style={{ padding:"10px 14px" }}><CipCell cip={p.cip} /></td>
                            <td style={{ padding:"10px 14px", fontWeight:600, color:"#0f2d3d", maxWidth:300 }}>
                              {p.name}
                              {p.note && <span style={{ marginLeft:6, fontSize:10, color:"#e07b39", background:"#fef3ec", borderRadius:4, padding:"1px 5px" }}>{p.note}</span>}
                              {p._overridden && <span style={{ marginLeft:6, fontSize:10, color:"#f59e0b", background:"#fffbeb", borderRadius:4, padding:"1px 5px" }}>✎ modifié</span>}
                            </td>
                            <td style={{ padding:"10px 14px", textAlign:"right", fontWeight:800, color:"#0f2d3d", whiteSpace:"nowrap" }}>
                              {p.pn != null ? fmt(p.pn) : "—"}
                            </td>
                            <td style={{ padding:"10px 14px", textAlign:"center" }}>
                              <div style={{ display:"flex", alignItems:"center", gap:6, justifyContent:"center" }}>
                                <button onClick={() => setQty(qKey, qty - step, step)} style={{ background:"#f0f2f5", border:"none", borderRadius:6, width:26, height:26, cursor:"pointer", fontWeight:800, fontSize:14, color:"#555" }}>−</button>
                                <span style={{ minWidth:28, textAlign:"center", fontWeight:700, fontSize:13, color: qty>0?"#10b981":"#aaa" }}>{qty||0}</span>
                                <button onClick={() => setQty(qKey, qty + step, step)} style={{ background: qty>0?"#10b981":"#0f2d3d", border:"none", borderRadius:6, width:26, height:26, cursor:"pointer", fontWeight:800, fontSize:14, color:"white" }}>+</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Category header */}
          <div style={{
            background: `linear-gradient(135deg, ${cat.color} 0%, ${cat.accent}33 100%)`,
            borderRadius: 16, padding: "20px 28px", marginBottom: 20,
            border: `1px solid ${cat.accent}40`
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "white", display: "flex", alignItems: "center", gap: 12 }}>
                  <span>{cat.icon}</span> {cat.label}
                </div>
                <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 4 }}>{cat.subtitle}</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 10, padding: "8px 16px", textAlign: "right" }}>
                <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}>Lignes dans cette gamme</div>
                <div style={{ color: "white", fontWeight: 700, fontSize: 22 }}>{cat.products.length}</div>
              </div>
            </div>
            {/* Search */}
            <div style={{ marginTop: 16 }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="🔍  Rechercher par nom ou CIP..."
                style={{
                  width: "100%", background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: 10, color: "white", padding: "8px 16px", fontSize: 13,
                  outline: "none", boxSizing: "border-box"
                }}
              />
            </div>
          </div>

          {/* Products table */}
          <div style={{ background: "white", borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 16px rgba(0,0,0,0.08)" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: cat.color }}>
                    {cat.columns.map(col => (
                      <th key={col} style={{
                        color: "white", padding: "12px 14px", textAlign: "left",
                        fontSize: 11, fontWeight: 700, letterSpacing: 0.5, whiteSpace: "nowrap"
                      }}>{col.toUpperCase()}</th>
                    ))}
                    <th style={{ color: "white", padding: "12px 14px", fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>QTÉ</th>
                    <th style={{ color: "white", padding: "12px 14px", fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>SOUS-TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((p, idx) => {
                    const realIdx = cat.products.indexOf(p);
                    const key = `${activeTab}-${realIdx}`;
                    const qty = quantities[key] || 0;
                    const subtotal = p.pn != null ? p.pn * qty : null;

                    const isRupture = p.cip && stockData[p.cip]?.dispo === 0;
                    const ruptureBadge = isRupture ? <span style={{ marginLeft: 6, fontSize: 10, color: "#dc2626", background: "#fee2e2", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>⚠️ Rupture</span> : null;
                    return (
                      <tr key={key} style={{
                        background: isRupture ? "#fff8f8" : idx % 2 === 0 ? "white" : "#fafbfc",
                        borderBottom: "1px solid #f0f2f5",
                        transition: "background 0.15s"
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = `${cat.accent}10`}
                        onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? "white" : "#fafbfc"}
                      >
                        {/* Render cells based on category */}
                        {activeTab === "expert" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 300 }}>
                            {p.name}
                            {p.note && <span style={{ marginLeft: 6, fontSize: 10, color: "#e07b39", background: "#fef3ec", borderRadius: 4, padding: "1px 5px" }}>{p.note}</span>}
                            {ruptureBadge}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{fmt(p.pv)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>
                            {p.pv && p.remise ? (p.remise/p.pv*100).toFixed(1)+"%" : p.pct ? p.pct : "—"}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>
                            {p.remise ? fmt(p.remise) : (p.pv && p.pct ? fmt(parseFloat(p.pv)*parseFloat(p.pct)/100) : "—")}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#1a1a1a" }}>{fmt(p.pn)}</td>
                        </>}
                        {activeTab === "stratege" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 280 }}>{p.name}{ruptureBadge}</td>
                          <td style={{ ...tdStyle, textAlign: "center" }}>{p.colis}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{fmt(p.prix)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>{p.pct}%</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>
                            {p.prix && p.pct ? fmt((p.prix * p.pct / 100)) : "—"}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{fmt(p.pn)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: "#666" }}>{fmt(p.carton)}</td>
                        </>}
                        {activeTab === "master" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 280 }}>{p.name}{ruptureBadge}</td>
                          <td style={{ ...tdStyle, textAlign: "center", color: cat.accent, fontWeight: 700 }}>×{p.palier}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{fmt(p.pb)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>{p.pct}%</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>
                            {p.pb && p.pct ? fmt((p.pb * p.pct / 100)) : "—"}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#1a1a1a" }}>{fmt(p.pn)}</td>
                        </>}
                        {activeTab === "obeso" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 280 }}>
                            {p.groupe && (
                              <div style={{ fontSize: 9, color: "#3b82f6", fontWeight: 700, letterSpacing: 0.5, marginBottom: 2 }}>{p.groupe.toUpperCase()}</div>
                            )}
                            {p.name}
                            {p.note && <span style={{ marginLeft: 6, fontSize: 10, color: "#e07b39", background: "#fef3ec", borderRadius: 4, padding: "1px 5px" }}>{p.note}</span>}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{p.pv != null ? fmt(p.pv) : "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: "#3b82f6", fontWeight: 700 }}>{p.pct}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#1a1a1a" }}>{p.pn != null ? fmt(p.pn) : "–"}</td>
                        </>}
                        {activeTab === "nr" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 280 }}>
                            {p.name}
                            {p.note && <span style={{ marginLeft: 6, fontSize: 10, color: "#e07b39", background: "#fef3ec", borderRadius: 4, padding: "1px 5px" }}>{p.note}</span>}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{p.pv != null ? fmt(p.pv) : "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>{p.pct}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#1a1a1a" }}>{p.pn != null ? fmt(p.pn) : "–"}</td>
                        </>}
                        {activeTab === "molnlycke" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 350 }}>{p.name}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{fmt(p.pv)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: cat.accent }}>{fmt(p.pn)}</td>
                        </>}
                        {activeTab === "blanche" && <>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 300 }}>{p.name}</td>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, textAlign: "center", color: "#666" }}>{p.colis}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#1a1a1a" }}>{p.pn != null ? fmt(p.pn) : "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>{p.carton != null ? fmt(p.carton) : "–"}</td>
                        </>}
                        {activeTab === "covid" && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 320 }}>{p.name}{ruptureBadge}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{p.pv != null ? fmt(p.pv) : "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>{p.pct || "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 800, color: "#1a1a1a" }}>{p.pn != null ? fmt(p.pn) : "–"}</td>
                        </>}
                        {activeTab === "otc" && <>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 260 }}>{p.name}{ruptureBadge}</td>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{p.pv != null ? fmt(p.pv) : "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>{p.pct || "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 800, color: "#1a1a1a" }}>{p.pn != null ? fmt(p.pn) : "–"}</td>
                        </>}
                        {cat.isPromo && <>
                          <td style={tdStyle}><CipCell cip={p.cip} /></td>
                          <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 280 }}>
                            {p.name}
                            {p.note && <span style={{ marginLeft: 6, fontSize: 10, color: "#e07b39", background: "#fef3ec", borderRadius: 4, padding: "1px 5px" }}>{p.note}</span>}
                            {ruptureBadge}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{p.pv != null ? fmt(p.pv) : "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: cat.accent, fontWeight: 700 }}>{p.pct || "–"}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 800, color: "#1a1a1a" }}>{p.pn != null ? fmt(p.pn) : "–"}</td>
                        </>}

                        {/* Qty input */}
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          {(() => {
                            const step = getStep(activeTab, p);
                            return (
                              <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center", flexDirection: "column" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <button onClick={() => setQty(key, (quantities[key] || 0) - step, step)} style={qtyBtnStyle(cat.accent)}>−</button>
                                  <input
                                    type="number" min="0" step={step} value={quantities[key] || ""}
                                    onChange={e => setQty(key, e.target.value, step)}
                                    onBlur={e => setQty(key, e.target.value, step)}
                                    placeholder="0"
                                    style={{
                                      width: 50, textAlign: "center", border: `1.5px solid ${qty > 0 ? cat.accent : "#ddd"}`,
                                      borderRadius: 6, padding: "4px 4px", fontSize: 13,
                                      fontWeight: qty > 0 ? 700 : 400, color: qty > 0 ? cat.color : "#999",
                                      outline: "none"
                                    }}
                                  />
                                  <button onClick={() => setQty(key, (quantities[key] || 0) + step, step)} style={qtyBtnStyle(cat.accent)}>+</button>
                                </div>
                                {step > 1 && <span style={{ fontSize: 9, color: "#aaa" }}>par {step}</span>}
                              </div>
                            );
                          })()}
                        </td>
                        {/* Subtotal */}
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                          {qty > 0 && subtotal != null
                            ? <span style={{ color: cat.color, background: `${cat.accent}15`, borderRadius: 6, padding: "2px 8px" }}>{fmt(subtotal)}</span>
                            : <span style={{ color: "#ccc" }}>–</span>
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredProducts.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px", color: "#999" }}>Aucun produit trouvé</div>
            )}
          </div>
        </main>

        {/* Cart panel */}
        <aside style={{
          width: cartOpen ? 360 : 0, minWidth: cartOpen ? 360 : 0,
          background: "white", borderLeft: cartOpen ? "1px solid #e8edf2" : "none",
          overflow: "hidden", transition: "all 0.3s ease",
          display: "flex", flexDirection: "column",
          boxShadow: cartOpen ? "-4px 0 20px rgba(0,0,0,0.08)" : "none"
        }}>
          {cartOpen && (
            <>
              <div style={{ padding: "20px 20px 0", borderBottom: "1px solid #f0f2f5" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 800, fontSize: 18, color: "#1a2a3a" }}>🛒 Panier commun</div>
                  <button onClick={() => setCartOpen(false)} style={{
                    background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#888"
                  }}>×</button>
                </div>
                {pharmacyName && (
                  <div style={{ fontSize: 12, color: "#666", marginTop: 4, marginBottom: 12 }}>📍 {pharmacyName}</div>
                )}
                <div style={{ display: "flex", gap: 12, paddingBottom: 16 }}>
                  <div style={{ flex: 1, background: "#f0f9ff", borderRadius: 10, padding: "10px 14px" }}>
                    <div style={{ fontSize: 11, color: "#666" }}>Lignes</div>
                    <div style={{ fontWeight: 800, fontSize: 20, color: "#0ea5e9" }}>{cartItems.length}</div>
                  </div>
                  <div style={{ flex: 1, background: "#f0fdf4", borderRadius: 10, padding: "10px 14px" }}>
                    <div style={{ fontSize: 11, color: "#666" }}>Unités</div>
                    <div style={{ fontWeight: 800, fontSize: 20, color: "#10b981" }}>{cartCount}</div>
                  </div>
                </div>
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
                {cartItems.length === 0 ? (
                  <div style={{ textAlign: "center", color: "#bbb", padding: 40, fontSize: 14 }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>🛒</div>
                    Aucun produit sélectionné
                  </div>
                ) : (
                  cartItems.map(item => (
                    <div key={item.key} style={{
                      background: "#fafbfc", borderRadius: 10, padding: "10px 12px",
                      marginBottom: 8, border: `1px solid ${item.color}20`
                    }}>
                      {/* Category + delete button */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                        <div style={{ fontSize: 10, color: item.color, fontWeight: 700, letterSpacing: 0.5 }}>
                          {item.cat.toUpperCase()}
                        </div>
                        <button onClick={() => setQty(item.key, 0)} style={{
                          background: "none", border: "none", cursor: "pointer",
                          color: "#ccc", fontSize: 15, lineHeight: 1, padding: "0 2px"
                        }} title="Supprimer">✕</button>
                      </div>
                      {/* Product name */}
                      <div style={{ fontWeight: 600, fontSize: 12, color: "#1a2a3a", lineHeight: 1.3, marginBottom: 8 }}>{item.name}</div>
                      {/* Qty controls + subtotal */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <button onClick={() => setQty(item.key, item.qty - item.step, item.step)} style={{
                            background: item.color + "20", border: `1px solid ${item.color}40`,
                            color: item.color, borderRadius: 6, width: 26, height: 26,
                            cursor: "pointer", fontWeight: 800, fontSize: 16, lineHeight: 1,
                            display: "flex", alignItems: "center", justifyContent: "center"
                          }}>−</button>
                          <span style={{ fontWeight: 700, fontSize: 14, minWidth: 24, textAlign: "center", color: "#1a2a3a" }}>{item.qty}</span>
                          <button onClick={() => setQty(item.key, item.qty + item.step, item.step)} style={{
                            background: item.color + "20", border: `1px solid ${item.color}40`,
                            color: item.color, borderRadius: 6, width: 26, height: 26,
                            cursor: "pointer", fontWeight: 800, fontSize: 16, lineHeight: 1,
                            display: "flex", alignItems: "center", justifyContent: "center"
                          }}>+</button>
                          <span style={{ fontSize: 10, color: "#999", marginLeft: 2 }}>× {fmt(item.pn)}</span>
                          {item.step > 1 && <span style={{ fontSize: 9, color: "#bbb" }}>/ par {item.step}</span>}
                        </div>
                        <span style={{ fontWeight: 800, color: "#1a2a3a", fontSize: 13 }}>{fmt(item.total)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {cartItems.length > 0 && (
                <div style={{ padding: "16px 20px", borderTop: "2px solid #f0f2f5" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ color: "#666", fontSize: 13 }}>Total HT estimé</span>
                    <span style={{ fontWeight: 800, fontSize: 20, color: "#0f2d3d" }}>{fmt(cartTotal)}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#aaa", marginBottom: 14 }}>
                    * Prix nets remisés – Hors conditions spéciales
                  </div>

                  {/* Pharmacy recap */}
                  <div style={{ background: "#f8fafc", borderRadius: 10, padding: "10px 12px", marginBottom: 14, fontSize: 12 }}>
                    <div style={{ fontWeight: 700, color: "#0f2d3d" }}>🏥 {pharmacyName}</div>
                    <div style={{ color: "#666", marginTop: 2 }}>📧 {pharmacyEmail}</div>
                    <div style={{ color: isClient ? "#059669" : "#d97706", marginTop: 2, fontSize: 11 }}>
                      {isClient ? "✅ Client existant" : "🆕 Nouveau client – RIB joint"}
                    </div>
                  </div>

                  {/* Send button */}
                  <button
                    onClick={handleSend}
                    disabled={sendStatus === "sending"}
                    style={{
                      width: "100%",
                      background: sendStatus === "success"
                        ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
                        : sendStatus === "error"
                        ? "linear-gradient(135deg, #e53e3e 0%, #c53030 100%)"
                        : "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
                      color: "white", border: "none", borderRadius: 10, padding: "12px",
                      fontWeight: 700, fontSize: 14, cursor: sendStatus === "sending" ? "not-allowed" : "pointer",
                      opacity: sendStatus === "sending" ? 0.7 : 1, marginBottom: 8
                    }}>
                    {sendStatus === "sending" ? "⏳ Envoi en cours..." :
                     sendStatus === "success" ? "✅ Commande envoyée !" :
                     sendStatus === "error" ? "❌ Erreur – Réessayez" :
                     "📧 Envoyer la commande par e-mail"}
                  </button>

                  <button onClick={handlePrint} style={{
                    width: "100%", background: "linear-gradient(135deg, #0f2d3d 0%, #1a4a5e 100%)",
                    color: "white", border: "none", borderRadius: 10, padding: "10px",
                    fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 8
                  }}>🖨 Imprimer le bon de commande</button>
                  <button onClick={handleCopy} style={{
                    width: "100%", background: copyStatus ? "linear-gradient(135deg, #10b981 0%, #059669 100%)" : "linear-gradient(135deg, #374151 0%, #1f2937 100%)",
                    color: "white", border: "none", borderRadius: 10, padding: "10px",
                    fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 8,
                    transition: "background 0.3s"
                  }}>
                    {copyStatus || "📋 Copier le bon de commande"}
                  </button>
                  <button onClick={() => setQuantities({})} style={{
                    width: "100%", background: "none", color: "#e53e3e",
                    border: "1px solid #fed7d7", borderRadius: 10, padding: "8px",
                    fontWeight: 600, fontSize: 12, cursor: "pointer"
                  }}>🗑 Vider le panier</button>
                </div>
              )}
            </>
          )}
        </aside>
      </div>

      {/* Floating cart button when closed */}
      {!cartOpen && cartCount > 0 && (
        <button onClick={() => setCartOpen(true)} style={{
          position: "fixed", bottom: 24, right: 24,
          background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
          color: "white", border: "none", borderRadius: 50, width: 64, height: 64,
          fontSize: 24, cursor: "pointer", boxShadow: "0 8px 24px rgba(16,185,129,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column"
        }}>
          🛒
          <span style={{ fontSize: 10, fontWeight: 800, background: "rgba(0,0,0,0.3)", borderRadius: 10, padding: "0 4px" }}>{cartCount}</span>
        </button>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; }
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
        @media print {
          header button, aside button { display: none !important; }
          aside { display: block !important; width: 100% !important; min-width: 100% !important; }
        }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #f1f5f9; }
        ::-webkit-scrollbar-thumb { background: #cbd5e0; border-radius: 3px; }
      `}</style>

      {/* Admin Panel */}
      {showAdmin && (
        <AdminPanel
          catalog={CATALOG}
          onClose={() => {
            setShowAdmin(false);
            try { setAdminProducts(JSON.parse(localStorage.getItem("admin_products") || "[]")); } catch {}
            try { setAdminOverrides(JSON.parse(localStorage.getItem("admin_overrides") || "{}")); } catch {}
            try { setPromoSections(JSON.parse(localStorage.getItem("admin_promos") || "[]")); } catch {}
          }}
        />
      )}
    </div>
  );
}

const tdStyle = {
  padding: "10px 14px", fontSize: 12, color: "#333", verticalAlign: "middle"
};

const qtyBtnStyle = (accent) => ({
  background: accent + "20", border: `1px solid ${accent}40`,
  color: accent, borderRadius: 5, width: 24, height: 24,
  cursor: "pointer", fontWeight: 700, fontSize: 14,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 0
});
