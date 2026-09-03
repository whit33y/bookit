-- AlterTable
-- Konta istniejące przed #144 ustawiły swoje hasła same, więc default false nie wymusza
-- na nikim zmiany; flaga zapala się dopiero przy kontach zakładanych „za kogoś".
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
