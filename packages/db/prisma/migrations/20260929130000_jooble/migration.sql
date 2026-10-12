-- CreateTable
CREATE TABLE "ApiQuota" (
    "id" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "lastCallAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiQuota_pkey" PRIMARY KEY ("id")
);

-- Nouvelle source Jooble (désactivée tant que la clé n'est pas dans .env)
INSERT INTO "SourceState" ("source", "enabled", "intervalMinutes", "failures", "nextRunAt")
VALUES ('jooble', false, 1440, 0, CURRENT_TIMESTAMP)
ON CONFLICT ("source") DO NOTHING;
