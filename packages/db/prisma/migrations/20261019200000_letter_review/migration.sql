-- Relecture automatique des lettres avant envoi
ALTER TABLE "CoverLetter" ADD COLUMN "review" JSONB;
ALTER TABLE "SpontaneousApplication" ADD COLUMN "review" JSONB;
