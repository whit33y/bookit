-- AlterTable
-- Wersja zostaje NULL dla istniejących kont: brak zdjęcia profilowego to stan domyślny
-- (monogram), nie brak danych do uzupełnienia.
ALTER TABLE "User" ADD COLUMN     "avatarVersion" TEXT;

-- CreateTable
CREATE TABLE "UserImage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Jeden wiersz na konto: PUT nadpisuje zdjęcie zamiast dokładać kolejne.
CREATE UNIQUE INDEX "UserImage_userId_key" ON "UserImage"("userId");

-- AddForeignKey
ALTER TABLE "UserImage" ADD CONSTRAINT "UserImage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
