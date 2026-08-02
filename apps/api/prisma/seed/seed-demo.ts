import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { planDemoBookings, planDemoTimeOffs } from './demo-bookings';
import {
  CATEGORIES,
  DEMO_BUSINESSES,
  DEMO_PASSWORD,
  DEMO_USERS,
  DemoBusiness,
  DemoEmployee,
} from './demo-data';

/**
 * Zapis danych z `demo-data.ts` do bazy. Każdy krok idzie po kluczu naturalnym, więc seed
 * można puszczać wielokrotnie — kolejne uruchomienia aktualizują rekordy zamiast dokładać
 * duplikaty. Identyfikatorów nie hardkodujemy: nadaje je baza, a istniejące bazy po
 * wcześniejszych wersjach seeda mają już własne UUID-y pod tymi samymi e-mailami.
 */

// Domyślne 5 s Prismy jest liczone pod pojedyncze operacje aplikacji, nie pod seed, który
// w jednej transakcji wstawia komplet rezerwacji z recenzjami. Seed odpalamy raz, ręcznie,
// więc dłuższe czekanie nic nie blokuje — a limit poniżej sumy round-tripów zostawiłby
// firmy demo bez rezerwacji.
const TRANSACTION_OPTIONS = { timeout: 30_000 };

/** Kategorie seedujemy zawsze — także tam, gdzie kont demo nie zakładamy. */
export const seedCategories = async (prisma: PrismaClient): Promise<void> => {
  for (const category of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name },
      create: category,
    });
  }
};

const seedUsers = async (
  prisma: PrismaClient,
): Promise<Map<string, string>> => {
  // wszystkie konta demo mają to samo hasło, więc wystarczy jedno (kosztowne) hashowanie
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const idsByEmail = new Map<string, string>();

  for (const user of DEMO_USERS) {
    const saved = await prisma.user.upsert({
      where: { email: user.email },
      // hasło i rolę nadpisujemy przy każdym seedzie — konto demo ma zawsze działać tak,
      // jak opisuje je README, nawet jeśli ktoś je w międzyczasie zmienił w aplikacji
      update: { ...user, passwordHash, isBlocked: false },
      create: { ...user, passwordHash },
    });
    idsByEmail.set(user.email, saved.id);
  }

  return idsByEmail;
};

const seedBusiness = async (
  prisma: PrismaClient,
  business: DemoBusiness,
  ownerId: string,
  categoryId: string,
): Promise<string> => {
  const data = {
    slug: business.slug,
    name: business.name,
    description: business.description,
    phone: business.phone,
    street: business.street,
    city: business.city,
    postalCode: business.postalCode,
    lat: business.lat,
    lng: business.lng,
    cancellationHours: business.cancellationHours,
    isBlocked: business.isBlocked ?? false,
    categoryId,
  };

  // Klucz po ownerId, nie po slugu: Business.ownerId też jest @unique, więc gdyby właściciel
  // demo miał już firmę pod innym slugiem (np. założoną przez UI), gałąź create wywaliłaby
  // się na P2002 i zabiła cały seed.
  const saved = await prisma.business.upsert({
    where: { ownerId },
    update: data,
    create: { ...data, ownerId },
  });

  return saved.id;
};

/**
 * Pracownik z kontem ma unikalne `userId` i to wystarcza za klucz. Bez konta zostaje nazwa
 * w obrębie firmy — Employee nie ma na to ograniczenia w bazie, więc szukamy ręcznie.
 */
const seedEmployee = async (
  prisma: PrismaClient,
  businessId: string,
  employee: DemoEmployee,
  userId: string | undefined,
): Promise<string> => {
  const data = { name: employee.name, isActive: true, businessId };

  if (userId) {
    // businessId też w update: konto pracownika da się w aplikacji odpiąć i podpiąć pod inną
    // firmę (`UpdateEmployeeDto.email`), a wtedy seed przypisałby jego rekord do usług
    // i rezerwacji cudzej firmy
    const saved = await prisma.employee.upsert({
      where: { userId },
      update: data,
      create: { ...data, userId },
    });
    return saved.id;
  }

  const existing = await prisma.employee.findFirst({
    where: { businessId, name: employee.name },
  });
  const saved = existing
    ? await prisma.employee.update({ where: { id: existing.id }, data })
    : await prisma.employee.create({ data });

  return saved.id;
};

/** WorkingHours nie ma klucza unikalnego — podmieniamy pracownikowi cały komplet. */
const replaceWorkingHours = async (
  prisma: PrismaClient,
  employeeId: string,
  employee: DemoEmployee,
): Promise<void> => {
  await prisma.workingHours.deleteMany({ where: { employeeId } });
  await prisma.workingHours.createMany({
    data: employee.workingHours.map((wh) => ({ employeeId, ...wh })),
  });
};

export const seedDemo = async (prisma: PrismaClient): Promise<void> => {
  const now = new Date();
  // Terminy liczymy przed dotknięciem bazy — niespójne dane demo mają wywalić seed,
  // zanim cokolwiek zapiszemy.
  const bookings = planDemoBookings(now);
  const timeOffs = planDemoTimeOffs(now);

  const userIds = await seedUsers(prisma);

  const businessIds = new Map<string, string>();
  const employeeIds = new Map<string, string>(); // "<slug firmy>/<nazwa pracownika>" → id
  const serviceIds = new Map<string, string>(); // "<slug firmy>/<nazwa usługi>" → id

  for (const business of DEMO_BUSINESSES) {
    const ownerId = userIds.get(business.ownerEmail);
    if (!ownerId) {
      throw new Error(`Dane demo: brak właściciela ${business.ownerEmail}`);
    }
    const category = await prisma.category.findUniqueOrThrow({
      where: { slug: business.categorySlug },
    });

    const businessId = await seedBusiness(
      prisma,
      business,
      ownerId,
      category.id,
    );
    businessIds.set(business.slug, businessId);

    for (const employee of business.employees) {
      const employeeId = await seedEmployee(
        prisma,
        businessId,
        employee,
        employee.userEmail ? userIds.get(employee.userEmail) : undefined,
      );
      employeeIds.set(`${business.slug}/${employee.name}`, employeeId);
      await replaceWorkingHours(prisma, employeeId, employee);
    }

    for (const service of business.services) {
      const data = {
        name: service.name,
        description: service.description,
        durationMin: service.durationMin,
        priceCents: service.priceCents,
        isActive: true,
        // jawne null, nie undefined: Prisma pomija undefined, więc usługa, która straciła
        // zaliczkę w danych demo, zostałaby z nią w bazie po ponownym seedzie
        depositType: service.depositType ?? null,
        depositValue: service.depositValue ?? null,
      };
      // Service też nie ma naturalnego klucza unikalnego — szukamy po nazwie w obrębie firmy
      const existing = await prisma.service.findFirst({
        where: { businessId, name: service.name },
      });
      const saved = existing
        ? await prisma.service.update({ where: { id: existing.id }, data })
        : await prisma.service.create({ data: { ...data, businessId } });

      await prisma.service.update({
        where: { id: saved.id },
        data: {
          employees: {
            set: service.employeeNames.map((name) => ({
              id: employeeIds.get(`${business.slug}/${name}`),
            })),
          },
        },
      });
      serviceIds.set(`${business.slug}/${service.name}`, saved.id);
    }
  }

  const employeeIdList = [...employeeIds.values()];
  await prisma.timeOff.deleteMany({
    where: { employeeId: { in: employeeIdList } },
  });
  await prisma.timeOff.createMany({
    data: timeOffs.map((timeOff) => ({
      employeeId: employeeIds.get(
        `${timeOff.spec.businessSlug}/${timeOff.spec.employeeName}`,
      ) as string,
      startsAt: timeOff.startsAt,
      endsAt: timeOff.endsAt,
      reason: timeOff.spec.reason,
    })),
  });

  // Rezerwacje są liczone względem „teraz”, więc każdy przebieg ma je odświeżyć, a nie dokleić —
  // a Booking nie ma klucza naturalnego, po którym dałoby się je zaktualizować. Kasujemy tylko
  // w firmach demo; to jedyne miejsce w seedzie, które usuwa cudze dane. Recenzje znikają razem
  // z rezerwacjami (`Review.booking` ma `onDelete: Cascade`), więc nie ma osobnego kroku.
  //
  // Kasowanie i zapis w jednej transakcji: reszta seeda to upserty, które same się naprawiają
  // przy kolejnym uruchomieniu, a to jedyny krok, który po awarii w połowie zostawiłby bazę
  // demo zupełnie bez rezerwacji.
  //
  // Pojedyncze `create` zamiast `createMany`: recenzję zakładamy zagnieżdżeniem, a `createMany`
  // nie zwraca identyfikatorów, więc trzeba by dopytywać bazę o świeżo wstawione rezerwacje.
  // Kosztem jest kilkadziesiąt round-tripów zamiast dwóch, a transakcja interaktywna ma domyślny
  // limit 5 s — na wolniejszym połączeniu do bazy seed przerwałby się w połowie na P2028.
  const removed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.booking.deleteMany({
      where: { businessId: { in: [...businessIds.values()] } },
    });

    for (const { spec, startsAt, endsAt } of bookings) {
      const clientId = userIds.get(spec.clientEmail) as string;
      const businessId = businessIds.get(spec.businessSlug) as string;

      await tx.booking.create({
        data: {
          clientId,
          businessId,
          employeeId: employeeIds.get(
            `${spec.businessSlug}/${spec.employeeName}`,
          ) as string,
          serviceId: serviceIds.get(
            `${spec.businessSlug}/${spec.serviceName}`,
          ) as string,
          startsAt,
          endsAt,
          status: spec.status,
          clientNote: spec.clientNote ?? null,
          review: spec.review
            ? {
                create: {
                  clientId,
                  businessId,
                  rating: spec.review.rating,
                  comment: spec.review.comment ?? null,
                },
              }
            : undefined,
        },
      });
    }

    return count;
  }, TRANSACTION_OPTIONS);

  const reviewCount = bookings.filter(({ spec }) => spec.review).length;

  console.log(
    `Dane demo: ${DEMO_USERS.length} użytkowników, ${DEMO_BUSINESSES.length} firm, ` +
      `${employeeIds.size} pracowników, ${serviceIds.size} usług, ` +
      `${bookings.length} rezerwacji (usunięto poprzednie: ${removed}), ` +
      `${reviewCount} recenzji.`,
  );
};
