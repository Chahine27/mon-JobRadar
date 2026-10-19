-- Relance d'une candidature sur offre restée sans réponse
ALTER TABLE "Job" ADD COLUMN "followedUpAt" TIMESTAMP(3);
