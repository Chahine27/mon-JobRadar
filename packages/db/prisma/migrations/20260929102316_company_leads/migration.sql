-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('TO_CONTACT', 'CONTACTED', 'FOLLOWED_UP', 'INTERVIEW', 'NOT_INTERESTED', 'IGNORED');

-- CreateTable
CREATE TABLE "CompanyLead" (
    "id" TEXT NOT NULL,
    "siret" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "officeName" TEXT,
    "naf" TEXT,
    "nafLabel" TEXT,
    "headcountMin" INTEGER,
    "headcountMax" INTEGER,
    "city" TEXT,
    "postcode" TEXT,
    "citycode" TEXT,
    "department" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "hiringPotential" DOUBLE PRECISION,
    "isHighPotential" BOOLEAN NOT NULL DEFAULT false,
    "hasEmail" BOOLEAN NOT NULL DEFAULT false,
    "rome" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'TO_CONTACT',
    "notes" TEXT,
    "contactedAt" TIMESTAMP(3),
    "travelMinutes" INTEGER,
    "travelOriginKey" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyLead_siret_key" ON "CompanyLead"("siret");

-- CreateIndex
CREATE INDEX "CompanyLead_status_hiringPotential_idx" ON "CompanyLead"("status", "hiringPotential");
