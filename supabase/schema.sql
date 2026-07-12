-- Store replenishment Postgres schema. Idempotent — safe to run multiple times.
-- Apply in Supabase SQL Editor, or via the Management API database/query endpoint.

DO $$ BEGIN
  CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'DONE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "Section" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "warehouseOrder" INTEGER NOT NULL,
  CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "SizeSystem" (
  "id" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
  "orderedSizes" JSONB NOT NULL, "targetQtyBySize" JSONB NOT NULL,
  "minDisplayItemCount" INTEGER NOT NULL DEFAULT 5,
  CONSTRAINT "SizeSystem_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "Product" (
  "id" TEXT NOT NULL, "article" TEXT NOT NULL, "name" TEXT NOT NULL,
  "sectionId" TEXT NOT NULL, "sizeSystemId" TEXT NOT NULL,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "ReplenishmentRequest" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "createdBy" TEXT NOT NULL,
  "userId" TEXT,
  "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
  CONSTRAINT "ReplenishmentRequest_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "RequestItem" (
  "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "productId" TEXT NOT NULL,
  "article" TEXT NOT NULL, "color" TEXT, "colorName" TEXT, "season" TEXT,
  "storageSection" TEXT, "labelPhotoUrl" TEXT, "imageUrl" TEXT,
  "presentSizesQty" JSONB NOT NULL, "neededSizesQty" JSONB NOT NULL,
  "substitutePriority" JSONB NOT NULL, "pickedSizesQty" JSONB,
  "pickStatus" TEXT, "warehouseNote" TEXT, "sizeSystem" TEXT, "frontSize" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RequestItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Section_name_key" ON "Section"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "SizeSystem_code_key" ON "SizeSystem"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "Product_article_key" ON "Product"("article");
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
CREATE INDEX IF NOT EXISTS "RequestItem_requestId_idx" ON "RequestItem"("requestId");
CREATE INDEX IF NOT EXISTS "ReplenishmentRequest_userId_idx" ON "ReplenishmentRequest"("userId");

DO $$ BEGIN ALTER TABLE "Product" ADD CONSTRAINT "Product_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Product" ADD CONSTRAINT "Product_sizeSystemId_fkey" FOREIGN KEY ("sizeSystemId") REFERENCES "SizeSystem"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "RequestItem" ADD CONSTRAINT "RequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ReplenishmentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "RequestItem" ADD CONSTRAINT "RequestItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "ReplenishmentRequest" ADD CONSTRAINT "ReplenishmentRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
