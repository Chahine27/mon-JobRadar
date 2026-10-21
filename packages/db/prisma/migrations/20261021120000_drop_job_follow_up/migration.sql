-- Plus de relance pour une candidature sur offre : sans nouvelles depuis 21 jours, elle compte comme refusée.
ALTER TABLE "Job" DROP COLUMN "followedUpAt";
