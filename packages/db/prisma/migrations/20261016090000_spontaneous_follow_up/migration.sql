-- Relance d'une candidature spontanée restée sans réponse (envoyée dans le même fil).
ALTER TABLE "SpontaneousApplication" ADD COLUMN "followedUpAt" TIMESTAMP(3);
