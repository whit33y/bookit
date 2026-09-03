-- CreateEnum
CREATE TYPE "BusinessStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "status" "BusinessStatus" NOT NULL DEFAULT 'PENDING';

-- Firmy założone przed wprowadzeniem zgłoszeń (#141) działały od razu po utworzeniu, więc
-- wpuszczamy je bez decyzji administratora. Domyślne PENDING obowiązuje dopiero nowe wiersze.
-- `isBlocked` zostaje nietknięte: to druga, niezależna oś.
UPDATE "Business" SET "status" = 'APPROVED';

-- CreateIndex
CREATE INDEX "Business_status_idx" ON "Business"("status");
