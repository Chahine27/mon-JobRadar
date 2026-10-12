-- Suivi des candidatures par les mails reçus (boîte lue en lecture seule).
ALTER TABLE "SpontaneousApplication" ADD COLUMN "messageId" TEXT;

CREATE TABLE "ApplicationMail" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "jobId" TEXT,
    "spontaneousId" TEXT,
    "kind" TEXT NOT NULL,
    "detail" TEXT,
    "subject" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplicationMail_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApplicationMail_messageId_key" ON "ApplicationMail"("messageId");
CREATE INDEX "ApplicationMail_jobId_idx" ON "ApplicationMail"("jobId");
CREATE INDEX "ApplicationMail_spontaneousId_idx" ON "ApplicationMail"("spontaneousId");
ALTER TABLE "ApplicationMail" ADD CONSTRAINT "ApplicationMail_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationMail" ADD CONSTRAINT "ApplicationMail_spontaneousId_fkey" FOREIGN KEY ("spontaneousId") REFERENCES "SpontaneousApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MailCursor" (
    "folder" TEXT NOT NULL,
    "uidValidity" TEXT NOT NULL,
    "lastUid" INTEGER NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MailCursor_pkey" PRIMARY KEY ("folder")
);
