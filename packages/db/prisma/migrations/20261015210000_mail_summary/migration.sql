-- Mails de candidature lus par l'IA : résumé en une phrase, et « à vérifier » quand elle hésite.
ALTER TABLE "ApplicationMail" ADD COLUMN "summary" TEXT;
ALTER TABLE "ApplicationMail" ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false;
