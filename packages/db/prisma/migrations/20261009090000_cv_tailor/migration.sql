-- CV adapté à l'offre : CV complet (morceaux) et CV adaptés par offre et par modèle.
CREATE TYPE "TailoredCvStatus" AS ENUM ('DRAFT', 'VALIDATED', 'EXPORTED');

CREATE TABLE "CvMaster" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CvMaster_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TailoredCv" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "overrides" JSONB NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "masterHash" TEXT NOT NULL,
    "jobHash" TEXT NOT NULL,
    "status" "TailoredCvStatus" NOT NULL DEFAULT 'DRAFT',
    "pdfPath" TEXT,
    "exportedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TailoredCv_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CvMaster_userId_key" ON "CvMaster"("userId");
CREATE UNIQUE INDEX "TailoredCv_jobId_template_key" ON "TailoredCv"("jobId", "template");

ALTER TABLE "CvMaster" ADD CONSTRAINT "CvMaster_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TailoredCv" ADD CONSTRAINT "TailoredCv_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;