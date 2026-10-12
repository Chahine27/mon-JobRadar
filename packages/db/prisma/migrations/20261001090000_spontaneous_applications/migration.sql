-- AlterTable
ALTER TABLE "CompanyLead" ADD COLUMN "contactEmail" TEXT;

-- CreateTable
CREATE TABLE "SpontaneousApplication" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "letter" TEXT NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "sentTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpontaneousApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpontaneousApplication_leadId_key" ON "SpontaneousApplication"("leadId");

-- AddForeignKey
ALTER TABLE "SpontaneousApplication" ADD CONSTRAINT "SpontaneousApplication_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CompanyLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
