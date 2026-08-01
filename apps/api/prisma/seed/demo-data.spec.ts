import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  DEMO_BOOKINGS,
  DEMO_BUSINESSES,
  DEMO_TIME_OFFS,
  DEMO_USERS,
} from './demo-data';

const duplicates = (values: string[]): string[] =>
  values.filter((value, index) => values.indexOf(value) !== index);

describe('dane demo', () => {
  it('e-maile i slugi są unikalne', () => {
    expect(duplicates(DEMO_USERS.map((u) => u.email))).toEqual([]);
    expect(duplicates(DEMO_BUSINESSES.map((b) => b.slug))).toEqual([]);
    expect(duplicates(CATEGORIES.map((c) => c.slug))).toEqual([]);
  });

  it('każda firma ma właściciela z listy kont i istniejącą kategorię', () => {
    const emails = DEMO_USERS.map((u) => u.email);
    const slugs = CATEGORIES.map((c) => c.slug);

    for (const business of DEMO_BUSINESSES) {
      expect(emails).toContain(business.ownerEmail);
      expect(slugs).toContain(business.categorySlug);
    }
  });

  it('każdy właściciel ma dokładnie jedną firmę (Business.ownerId jest @unique)', () => {
    expect(duplicates(DEMO_BUSINESSES.map((b) => b.ownerEmail))).toEqual([]);
  });

  it('konta pracowników są przypisane do jednego pracownika (Employee.userId jest @unique)', () => {
    const userEmails = DEMO_BUSINESSES.flatMap((b) =>
      b.employees
        .map((e) => e.userEmail)
        .filter((email): email is string => Boolean(email)),
    );
    expect(duplicates(userEmails)).toEqual([]);
    for (const email of userEmails) {
      expect(DEMO_USERS.map((u) => u.email)).toContain(email);
    }
  });

  it('każdy pracownik ma grafik z poprawnymi godzinami', () => {
    for (const business of DEMO_BUSINESSES) {
      expect(business.employees.length).toBeGreaterThan(0);

      for (const employee of business.employees) {
        expect(employee.workingHours.length).toBeGreaterThan(0);
        expect(
          duplicates(employee.workingHours.map((wh) => String(wh.weekday))),
        ).toEqual([]);

        for (const wh of employee.workingHours) {
          expect(wh.weekday).toBeGreaterThanOrEqual(0);
          expect(wh.weekday).toBeLessThanOrEqual(6);
          expect(wh.startTime).toMatch(/^\d{2}:\d{2}$/);
          expect(wh.endTime).toMatch(/^\d{2}:\d{2}$/);
          expect(wh.startTime < wh.endTime).toBe(true);
        }
      }
    }
  });

  it('każda usługa ma unikalną nazwę w firmie i przypisanego pracownika', () => {
    for (const business of DEMO_BUSINESSES) {
      expect(business.services.length).toBeGreaterThan(0);
      expect(duplicates(business.services.map((s) => s.name))).toEqual([]);

      const employeeNames = business.employees.map((e) => e.name);
      expect(duplicates(employeeNames)).toEqual([]);

      for (const service of business.services) {
        expect(service.employeeNames.length).toBeGreaterThan(0);
        expect(service.durationMin % 15).toBe(0);
        expect(service.priceCents).toBeGreaterThan(0);

        for (const name of service.employeeNames) {
          expect(employeeNames).toContain(name);
        }
      }
    }
  });

  it('rezerwacje i urlopy wskazują istniejące firmy, pracowników, usługi i klientów', () => {
    const emails = DEMO_USERS.map((u) => u.email);

    for (const spec of [...DEMO_BOOKINGS, ...DEMO_TIME_OFFS]) {
      const business = DEMO_BUSINESSES.find(
        (b) => b.slug === spec.businessSlug,
      );

      expect(
        business?.employees.map((e) => e.name) ?? [],
        spec.businessSlug,
      ).toContain(spec.employeeName);
    }

    for (const spec of DEMO_BOOKINGS) {
      const service = DEMO_BUSINESSES.find(
        (b) => b.slug === spec.businessSlug,
      )?.services.find((s) => s.name === spec.serviceName);

      expect(service?.employeeNames ?? [], spec.serviceName).toContain(
        spec.employeeName,
      );
      expect(emails).toContain(spec.clientEmail);
      expect(spec.workdayOffset).not.toBe(0);
    }
  });

  it('zablokowana firma nie ma rezerwacji — publicznie i tak jest niewidoczna', () => {
    const blocked = DEMO_BUSINESSES.filter((b) => b.isBlocked).map(
      (b) => b.slug,
    );

    expect(blocked.length).toBeGreaterThan(0);
    for (const spec of DEMO_BOOKINGS) {
      expect(blocked).not.toContain(spec.businessSlug);
    }
  });

  it('każdy status BookingStatus ma przykład w danych', () => {
    const statuses = new Set(DEMO_BOOKINGS.map((b) => b.status));
    expect(statuses.size).toBe(6);
  });
});
