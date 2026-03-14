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

-- ── 6. Vérification ─────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE '✅ Migrations terminées — 5 tables créées/mises à jour';
END $$;
