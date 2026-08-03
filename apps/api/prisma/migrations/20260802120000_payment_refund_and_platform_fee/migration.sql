-- AlterEnum
-- Zwroty (#52). Dwa osobne stany, bo różnią się skutkiem finansowym, a nie tylko opisem:
-- REFUNDED = pieniądze wróciły do klienta, FORFEITED = zostały u firmy i platformy.
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';
ALTER TYPE "PaymentStatus" ADD VALUE 'FORFEITED';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "platformFeeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundedAmountCents" INTEGER,
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "stripeRefundId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeRefundId_key" ON "Payment"("stripeRefundId");

-- AddCheckConstraint
-- Dopisane ręcznie, jak CHECK-i zaliczki w 20260802065228: Prisma nie umie ich deklaratywnie.
-- Prowizja większa od samej zaliczki znaczyłaby, że platforma dopłaca do przelewu — błąd
-- w stawce ma się zatrzymać na bazie, zanim rozjedzie rozliczenia.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_platformFeeCents_check"
  CHECK ("platformFeeCents" >= 0 AND "platformFeeCents" <= "amountCents");

-- Zwrot zerowy to brak zwrotu (od tego jest NULL), a zwrot większy niż kwota pobrana to
-- oddanie klientowi cudzych pieniędzy. Zwroty częściowe zostają dozwolone — #52 robi wyłącznie
-- pełne, ale kolumna jest kwotą, nie flagą, i nie ma powodu zamykać tej furtki w schemacie.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_refundedAmountCents_check"
  CHECK (
    "refundedAmountCents" IS NULL
    OR ("refundedAmountCents" > 0 AND "refundedAmountCents" <= "amountCents")
  );
