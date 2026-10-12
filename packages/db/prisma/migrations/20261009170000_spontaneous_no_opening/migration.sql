-- Renvoyé vers le site carrière, mais aucun poste ni candidature spontanée possible : candidature close.
ALTER TABLE "SpontaneousApplication" ADD COLUMN "noOpeningAt" TIMESTAMP(3);
