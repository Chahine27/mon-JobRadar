-- Candidature spontanée refaite sur le site carrière de l'entreprise (après un renvoi vers ce site).
ALTER TABLE "SpontaneousApplication" ADD COLUMN "appliedOnSiteAt" TIMESTAMP(3);
