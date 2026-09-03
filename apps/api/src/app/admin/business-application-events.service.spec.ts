import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsService } from '../notifications/notifications.service';
import { BusinessApplicationEventsService } from './business-application-events.service';

const BUSINESS_ID = 'b1';

describe('BusinessApplicationEventsService', () => {
  let businessDecision: ReturnType<typeof vi.fn>;
  let events: BusinessApplicationEventsService;

  beforeEach(() => {
    businessDecision = vi.fn().mockResolvedValue(undefined);
    events = new BusinessApplicationEventsService({
      businessDecision,
    } as unknown as NotificationsService);
  });

  it('przekazuje decyzję dalej po samym id zgłoszenia', () => {
    events.approved(BUSINESS_ID);
    expect(businessDecision).toHaveBeenCalledWith(BUSINESS_ID, 'APPROVED');

    events.rejected(BUSINESS_ID);
    expect(businessDecision).toHaveBeenCalledWith(BUSINESS_ID, 'REJECTED');
  });

  // administrator nie czeka na SMTP: decyzja jest już zapisana, a wysyłka idzie w tło
  it('nie czeka na wysyłkę — metody są synchroniczne i nic nie zwracają', () => {
    let settled = false;
    businessDecision.mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(() => {
        settled = true;
        resolve();
      })),
    );

    expect(events.approved(BUSINESS_ID)).toBeUndefined();
    expect(settled).toBe(false);
  });
});
