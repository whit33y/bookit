-- CreateEnum
CREATE TYPE "DepositType" AS ENUM ('FIXED', 'PERCENT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "depositType" "DepositType",
ADD COLUMN     "depositValue" INTEGER;

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'pln',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "stripePaymentIntentId" TEXT,
    "stripeChargeId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_bookingId_key" ON "Payment"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripePaymentIntentId_key" ON "Payment"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddCheckConstraint
-- Dopisane ręcznie: Prisma nie umie CHECK-ów deklaratywnie w schemacie. Niezmienniki zaliczki
-- pilnujemy też w bazie, bo z wiersza z typem bez kwoty nie da się policzyć PaymentIntenta —
-- #51 wywaliłoby się dopiero przy rezerwacji, gdy klient jest już w kasie, a naprawa wymagałaby
-- migracji danych. Drugi CHECK łapie też PATCH obniżający cenę pod kwotę zaliczki FIXED.
ALTER TABLE "Service" ADD CONSTRAINT "Service_deposit_pair_check"
  CHECK (("depositType" IS NULL) = ("depositValue" IS NULL));

-- Warunek zaokrąglenia dla PERCENT odwzorowuje `depositAmountCents` z payments/deposit.ts:
-- procent z groszowej ceny może wyjść 0 gr, a takiej zaliczki nie da się pobrać. `round`
-- w Postgresie i `Math.round` w JS zaokrąglają dodatnie połówki w tę samą stronę, więc oba
-- warstwy odrzucają dokładnie te same wiersze (0,49 gr → nie, 0,5 gr → tak).
ALTER TABLE "Service" ADD CONSTRAINT "Service_deposit_value_check"
  CHECK (
    "depositValue" IS NULL
    OR ("depositType" = 'PERCENT' AND "depositValue" BETWEEN 1 AND 100
        AND round("priceCents" * "depositValue" / 100.0) >= 1)
    OR ("depositType" = 'FIXED' AND "depositValue" > 0 AND "depositValue" <= "priceCents")
  );

-- Zaliczka 0 gr to brak zaliczki, a nie zaliczka zerowa — takiego PaymentIntenta Stripe odrzuci.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amountCents_check" CHECK ("amountCents" > 0);
