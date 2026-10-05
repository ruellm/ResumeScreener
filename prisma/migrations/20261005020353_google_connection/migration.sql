-- CreateTable
CREATE TABLE "GoogleConnection" (
    "id" TEXT NOT NULL DEFAULT 'system',
    "email" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lastError" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL,
    "connectedById" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleConnection_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GoogleConnection" ENABLE ROW LEVEL SECURITY;
