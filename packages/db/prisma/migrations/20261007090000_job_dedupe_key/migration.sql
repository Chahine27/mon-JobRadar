-- Même offre publiée par plusieurs sources avec un titre ou un lieu écrit autrement : clé de rapprochement.
ALTER TABLE "Job" ADD COLUMN "dedupeKey" TEXT;
CREATE INDEX "Job_dedupeKey_idx" ON "Job"("dedupeKey");
