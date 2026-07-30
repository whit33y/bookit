import { ConfigService } from '@nestjs/config';
import { BookingStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail.service';
import { NotificationsService } from './notifications.service';

const BOOKING_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const booking = () => ({
  startsAt: new Date('2026-01-14T08:00:00.000Z'),
  endsAt: new Date('2026-01-14T09:00:00.000Z'),
  clientNote: null,
  client: {
    email: 'jan@example.com',
    firstName: 'Jan',
    lastName: 'Kowalski',
    phone: null,
  },
  business: {
    name: 'Salon Ola',
    slug: 'salon-ola',
    street: 'ul. Kwiatowa 1',
    city: 'Warszawa',
    postalCode: '00-001',
    phone: null,
    owner: { email: 'ola@example.com' },
  },
  service: { name: 'Strzyżenie damskie', durationMin: 60, priceCents: 12000 },
  employee: { name: 'Ola' },
});

describe('NotificationsService', () => {
  let findUnique: ReturnType<typeof vi.fn>;
  let send: ReturnType<typeof vi.fn>;
  let service: NotificationsService;

  beforeEach(() => {
    findUnique = vi.fn().mockResolvedValue(booking());
    send = vi.fn().mockResolvedValue(undefined);
    service = new NotificationsService(
      { booking: { findUnique } } as unknown as PrismaService,
      { send } as unknown as MailService,
      new ConfigService({ APP_URL: 'http://localhost:4200' }),
    );
  });

  it('CONFIRMED → mail na adres klienta', async () => {
    await service.bookingStatusChanged(BOOKING_ID, BookingStatus.CONFIRMED);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe('jan@example.com');
    expect(send.mock.calls[0][0].subject).toContain('Rezerwacja potwierdzona');
  });

  it('CANCELLED_BY_CLIENT → mail na adres właściciela firmy', async () => {
    await service.bookingStatusChanged(BOOKING_ID, BookingStatus.CANCELLED_BY_CLIENT);

    expect(send.mock.calls[0][0].to).toBe('ola@example.com');
  });

  it('nowa rezerwacja → mail do firmy', async () => {
    await service.bookingCreated(BOOKING_ID);

    expect(send.mock.calls[0][0].to).toBe('ola@example.com');
    expect(send.mock.calls[0][0].subject).toContain('Nowa rezerwacja');
  });

  it('każdy mail ma obie wersje treści (HTML + tekst)', async () => {
    await service.bookingStatusChanged(BOOKING_ID, BookingStatus.CONFIRMED);

    const message = send.mock.calls[0][0];
    expect(message.text.length).toBeGreaterThan(0);
    expect(message.html).toContain('<h2');
  });

  it('zdarzenie bez adresata nie odpytuje bazy ani nie wysyła', async () => {
    await service.bookingStatusChanged(BOOKING_ID, BookingStatus.COMPLETED);

    expect(findUnique).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  // AC #37: „błąd wysyłki nie wywala operacji na rezerwacji" — wołający robi `void`,
  // więc odrzucenie tutaj byłoby nieobsłużone
  it('padnięty SMTP nie propaguje błędu', async () => {
    send.mockRejectedValue(new Error('SMTP down'));

    await expect(
      service.bookingStatusChanged(BOOKING_ID, BookingStatus.CONFIRMED),
    ).resolves.toBeUndefined();
  });

  it('błąd zapytania do bazy też nie propaguje', async () => {
    findUnique.mockRejectedValue(new Error('DB down'));

    await expect(service.bookingCreated(BOOKING_ID)).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('zniknięta rezerwacja → brak maila, bez wyjątku', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      service.bookingStatusChanged(BOOKING_ID, BookingStatus.DECLINED),
    ).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  describe('sendPasswordReset', () => {
    it('wysyła link z tokenem na podany adres', async () => {
      await service.sendPasswordReset('jan@example.com', 'Jan', 'abc123');

      const message = send.mock.calls[0][0];
      expect(message.to).toBe('jan@example.com');
      expect(message.subject).toBe('Reset hasła w BookIt');
      expect(message.text).toContain(
        'http://localhost:4200/reset-password?token=abc123',
      );
      expect(message.html).toContain('reset-password?token=abc123');
    });

    // odwrotnie niż powiadomienia rezerwacji: AuthService.forgotPassword ma własny catch
    // i błąd jest tam jedynym sygnałem, że reset nie doszedł
    it('błąd wysyłki propaguje do wołającego', async () => {
      send.mockRejectedValue(new Error('SMTP down'));

      await expect(
        service.sendPasswordReset('jan@example.com', 'Jan', 'abc123'),
      ).rejects.toThrow('SMTP down');
    });
  });
});
