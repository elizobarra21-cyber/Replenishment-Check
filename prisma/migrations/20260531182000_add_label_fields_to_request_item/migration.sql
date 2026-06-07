-- Add parsed label details used by the hall draft and warehouse picking views.
ALTER TABLE "RequestItem" ADD COLUMN "color" TEXT;
ALTER TABLE "RequestItem" ADD COLUMN "season" TEXT;
ALTER TABLE "RequestItem" ADD COLUMN "storageSection" TEXT;
