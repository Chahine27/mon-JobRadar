-- Deux mails par offre possibles : « à compléter » (annonce incomplète) puis « à postuler ».
ALTER TABLE "Notification" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'apply';
DROP INDEX "Notification_jobId_channel_key";
CREATE UNIQUE INDEX "Notification_jobId_channel_kind_key" ON "Notification"("jobId", "channel", "kind");
