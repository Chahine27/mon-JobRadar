-- Infos lues par l'IA dans l'annonce complète (contrat, télétravail, salaire)
ALTER TABLE "Job" ADD COLUMN "fullInfo" JSONB;
