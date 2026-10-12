-- Mode du trajet : voiture depuis le domicile (hors Île-de-France) ou transports depuis la gare d'arrivée.
-- Les anciens trajets (mode vide) sont recalculés à la prochaine ouverture de l'offre.
ALTER TABLE "TravelEstimate" ADD COLUMN "mode" TEXT;
