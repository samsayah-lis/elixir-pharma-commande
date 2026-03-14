-- ═══════════════════════════════════════════════════════════════════
-- MIGRATIONS SUPABASE — À exécuter dans l'éditeur SQL Supabase
-- Elixir Pharma Commande — Mars 2026
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. FIX BUG-04 : Ajoute la colonne source sur les commandes ──
ALTER TABLE elixir_orders ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'catalogue';

-- ── 2. ML : Associations produit × produit (cross-sell) ─────────
CREATE TABLE IF NOT EXISTS product_associations (
  cip_a         TEXT NOT NULL,
  cip_b         TEXT NOT NULL,
  lift          REAL NOT NULL DEFAULT 1.0,
  support       REAL NOT NULL DEFAULT 0.0,
  confidence    REAL NOT NULL DEFAULT 0.0,
  last_computed TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cip_a, cip_b)
);
CREATE INDEX IF NOT EXISTS idx_pa_cip_a ON product_associations(cip_a);
CREATE INDEX IF NOT EXISTS idx_pa_cip_b ON product_associations(cip_b);
CREATE INDEX IF NOT EXISTS idx_pa_lift  ON product_associations(lift DESC);

-- ── 3. ML : Patterns de commande par pharmacie (re-order) ───────
CREATE TABLE IF NOT EXISTS pharmacy_patterns (
  pharmacy_cip      TEXT NOT NULL,
  cip               TEXT NOT NULL,
  avg_qty           INTEGER NOT NULL DEFAULT 1,
  avg_interval_days INTEGER,
  last_order_date   TIMESTAMPTZ,
  confidence        REAL NOT NULL DEFAULT 0.5,
  order_count       INTEGER NOT NULL DEFAULT 1,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pharmacy_cip, cip)
);
CREATE INDEX IF NOT EXISTS idx_pp_pharmacy   ON pharmacy_patterns(pharmacy_cip);
CREATE INDEX IF NOT EXISTS idx_pp_confidence ON pharmacy_patterns(confidence DESC);

-- ── 4. ML : Historique stocks quotidien (prédiction ruptures) ───
CREATE TABLE IF NOT EXISTS stock_history (
  cip        TEXT NOT NULL,
  date       DATE NOT NULL DEFAULT CURRENT_DATE,
  stock      INTEGER NOT NULL DEFAULT 0,
  dispo      SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cip, date)
);
CREATE INDEX IF NOT EXISTS idx_sh_date ON stock_history(date DESC);

-- ── 5. ML : Segmentation pharmacies (clustering) ────────────────
CREATE TABLE IF NOT EXISTS pharmacy_segments (
  pharmacy_cip         TEXT PRIMARY KEY,
  segment              TEXT NOT NULL DEFAULT 'standard',
  avg_basket_eur       REAL,
  avg_refs_per_order   REAL,
  order_frequency_days REAL,
  expert_ratio         REAL,
  otc_ratio            REAL,
  last_order_date      TIMESTAMPTZ,
  total_orders         INTEGER NOT NULL DEFAULT 0,
  total_ca_ht          REAL NOT NULL DEFAULT 0,
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 6. Alertes retour en stock ───────────────────────────────────
CREATE TABLE IF NOT EXISTS restock_alerts (
  pharmacy_cip  TEXT NOT NULL,
  cip           TEXT NOT NULL,
  pharmacy_email TEXT,
  product_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified      BOOLEAN NOT NULL DEFAULT false,
  notified_at   TIMESTAMPTZ,
  PRIMARY KEY (pharmacy_cip, cip)
);
CREATE INDEX IF NOT EXISTS idx_ra_cip ON restock_alerts(cip);
CREATE INDEX IF NOT EXISTS idx_ra_notified ON restock_alerts(notified) WHERE notified = false;

-- ── 7. Remises péremption courte (admin) ────────────────────────
CREATE TABLE IF NOT EXISTS expiry_discounts (
  cip           TEXT PRIMARY KEY,
  discount_pct  REAL NOT NULL DEFAULT 0,
  product_name  TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 8. Cache catalogue Odoo (produits + stock + lots + péremption) ─
CREATE TABLE IF NOT EXISTS odoo_catalog (
  cip             TEXT PRIMARY KEY,
  barcode         TEXT,
  name            TEXT NOT NULL DEFAULT '',
  list_price      REAL NOT NULL DEFAULT 0,
  discounted_price REAL,
  discount_pct    REAL NOT NULL DEFAULT 0,
  category        TEXT DEFAULT '',
  in_stock        BOOLEAN NOT NULL DEFAULT false,
  available       INTEGER NOT NULL DEFAULT 0,
  total_qty       INTEGER NOT NULL DEFAULT 0,
  reserved        INTEGER NOT NULL DEFAULT 0,
  earliest_expiry TEXT,
  lots            TEXT DEFAULT '[]',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Si la table existe déjà, ajouter les colonnes prix remisés
ALTER TABLE odoo_catalog ADD COLUMN IF NOT EXISTS discounted_price REAL;
ALTER TABLE odoo_catalog ADD COLUMN IF NOT EXISTS discount_pct REAL NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_oc_name ON odoo_catalog(name);
CREATE INDEX IF NOT EXISTS idx_oc_stock ON odoo_catalog(in_stock);
CREATE INDEX IF NOT EXISTS idx_oc_expiry ON odoo_catalog(earliest_expiry) WHERE earliest_expiry IS NOT NULL;

-- ── 9. Key-Value store (cache mapping PID→CIP, etc.) ────────────
CREATE TABLE IF NOT EXISTS kv_store (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 10. Vérification ────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE '✅ Migrations terminées — 9 tables créées/mises à jour';
END $$;
