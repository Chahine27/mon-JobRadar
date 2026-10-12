-- Annonce complète collée à la main (sources qui ne donnent qu'un extrait : Adzuna, Jooble)
ALTER TABLE "Job" ADD COLUMN "fullText" TEXT;
ALTER TABLE "Job" ADD COLUMN "fullTextAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN "fullExperienceYrs" INTEGER;
