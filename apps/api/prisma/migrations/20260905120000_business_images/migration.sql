-- CreateEnum
CREATE TYPE "BusinessImageKind" AS ENUM ('LOGO', 'COVER');

-- AlterTable
-- Wersje zostają NULL dla istniejących firm: brak obrazu to stan domyślny (monogram),
-- nie brak danych do uzupełnienia.
ALTER TABLE "Business" ADD COLUMN     "coverVersion" TEXT,
ADD COLUMN     "logoVersion" TEXT;

-- CreateTable
CREATE TABLE "BusinessImage" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" "BusinessImageKind" NOT NULL,
    "mime" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Jeden wiersz na (firma, slot): PUT nadpisuje istniejący obraz zamiast dokładać kolejny.
CREATE UNIQUE INDEX "BusinessImage_businessId_kind_key" ON "BusinessImage"("businessId", "kind");

-- AddForeignKey
ALTER TABLE "BusinessImage" ADD CONSTRAINT "BusinessImage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
