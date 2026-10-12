-- Corrections saisies à la main sur une offre (infos manquantes ou fausses).
ALTER TABLE "Job" ADD COLUMN "userEdits" JSONB;
ALTER TABLE "Job" ADD COLUMN "userEditsAt" TIMESTAMP(3);
