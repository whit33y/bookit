-- Decyzje administratora o zgłoszeniu firmy (#143) — pierwsze powiadomienia, które nie dotyczą
-- rezerwacji. `Notification.bookingId` jest już nullowalne, więc tabela nie wymaga zmian.
ALTER TYPE "NotificationType" ADD VALUE 'BUSINESS_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'BUSINESS_REJECTED';
