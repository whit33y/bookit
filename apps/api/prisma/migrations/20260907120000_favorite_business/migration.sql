-- CreateTable
-- Ulubione firmy klienta (#181). Osobna tabela, nie niejawna relacja m:n — lista ma porządek
-- (`createdAt` malejąco), a niejawna tabela Prismy nie ma gdzie go trzymać.
CREATE TABLE "FavoriteBusiness" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoriteBusiness_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Pod listę „moje ulubione, najnowsze pierwsze": sortowanie schodzi z indeksu, bez sortu w pamięci.
CREATE INDEX "FavoriteBusiness_userId_createdAt_idx" ON "FavoriteBusiness"("userId", "createdAt");

-- CreateIndex
-- Na tym kluczu opiera się idempotencja PUT-a: powtórzony klik z dwóch kart wpada
-- w `skipDuplicates`, a nie w konflikt.
CREATE UNIQUE INDEX "FavoriteBusiness_userId_businessId_key" ON "FavoriteBusiness"("userId", "businessId");

-- AddForeignKey
ALTER TABLE "FavoriteBusiness" ADD CONSTRAINT "FavoriteBusiness_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteBusiness" ADD CONSTRAINT "FavoriteBusiness_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
