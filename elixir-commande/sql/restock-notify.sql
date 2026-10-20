-- ═══════════════════════════════════════════════════════════════════
-- Alertes « M'avertir du retour » : suivi des e-mails (docs/alertes-retour.md)
-- À exécuter UNE fois dans l'éditeur SQL de Supabase (projet du site de commande). Rejouable sans effet (IF NOT EXISTS).
-- N'ouvre aucun droit : ni GRANT, ni politique RLS, ni changement de clé (plan de fermeture du 19/10/2026 respecté).
--
-- Avant ce fichier, les e-mails partent déjà (« mode réduit ») : une seule fois par demande, essais refusés comptés
-- dans kv_store. Après : essais comptés dans la table, issue de chaque demande notée (envoyé, trop ancienne, adresse
-- plus rattachée, échec), envois interrompus repérés dans l'admin (onglet « Alertes retour », bouton « Relancer »).
-- ═══════════════════════════════════════════════════════════════════

-- date de l'avertissement (ou de la clôture) ; déjà présente si la table vient de supabase-migrations.sql § 6
ALTER TABLE restock_alerts ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
-- envois refusés par Resend pour la demande en cours (3 au plus, puis issue « echec »)
ALTER TABLE restock_alerts ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
-- issue : envoi (réservée, e-mail en cours) | envoye | ancienne (plus de 60 jours, close sans e-mail)
--         | destinataire (adresse plus rattachée au CIP, close sans e-mail) | echec | interrompu ; NULL : en attente
ALTER TABLE restock_alerts ADD COLUMN IF NOT EXISTS outcome TEXT;

-- envois en cours ou interrompus, lus à chaque passage et par l'admin
CREATE INDEX IF NOT EXISTS idx_ra_outcome ON restock_alerts(outcome) WHERE outcome IN ('envoi', 'interrompu');

-- PostgREST relit le schéma (les fonctions voient les colonnes tout de suite)
NOTIFY pgrst, 'reload schema';

-- Vérification : notified_at, attempts et outcome doivent apparaître
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'restock_alerts'
ORDER BY ordinal_position;
