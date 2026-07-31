import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Konta demo — jedno na każdą rolę. Hasło wspólne, żeby dało się je zapamiętać przy
// przeglądaniu aplikacji; dokumentacja: docs/users.md. NIE używać na środowisku publicznym.
const DEMO_PASSWORD = 'Haslo123!';

const DEMO_USERS = [
  {
    email: 'admin@bookit.pl',
    firstName: 'Admin',
    lastName: 'Bookit',
    phone: '600100100',
    role: UserRole.ADMIN,
  },
  {
    email: 'klient@bookit.pl',
    firstName: 'Kinga',
    lastName: 'Nowak',
    phone: '600200200',
    role: UserRole.CLIENT,
  },
  {
    email: 'wlasciciel@bookit.pl',
    firstName: 'Anna',
    lastName: 'Kowalska',
    phone: '600300300',
    role: UserRole.OWNER,
  },
  {
    email: 'pracownik@bookit.pl',
    firstName: 'Marek',
    lastName: 'Wiśniewski',
    phone: '600400400',
    role: UserRole.EMPLOYEE,
  },
];

// slug ASCII (bez diakrytyków) — trafia do URL-i /businesses?category=<slug>
const categories = [
  { name: 'Fryzjer', slug: 'fryzjer' },
  { name: 'Barber', slug: 'barber' },
  { name: 'Paznokcie', slug: 'paznokcie' },
  { name: 'Kosmetyczka', slug: 'kosmetyczka' },
  { name: 'Fizjoterapeuta', slug: 'fizjoterapeuta' },
  { name: 'Masaż', slug: 'masaz' },
  { name: 'Groomer', slug: 'groomer' },
  { name: 'Tatuaż', slug: 'tatuaz' },
];

/**
 * Konta demo zakładamy tylko na środowisku deweloperskim. Wśród nich jest ADMIN z hasłem
 * zapisanym wprost w repozytorium (i w docs/users.md), więc puszczenie tego seeda na
 * czymkolwiek publicznym oznaczałoby oddanie moderacji serwisu każdemu, kto zna repo.
 * Nieustawione NODE_ENV traktujemy jak lokalny development; każda inna wartość wymaga
 * świadomego SEED_DEMO=1.
 */
function demoSeedAllowed(): boolean {
  if (process.env.SEED_DEMO === '1') {
    return true;
  }
  const env = process.env.NODE_ENV;
  return env === undefined || env === '' || env === 'development' || env === 'test';
}

/**
 * Konta demo wraz z firmą, bez której role OWNER i EMPLOYEE nie mają czego pokazać:
 * właściciel dostaje firmę, pracownik — powiązany rekord Employee z grafikiem.
 * Wszystko po unikalnych kluczach (email, ownerId, userId), więc seed jest idempotentny.
 */
async function seedDemoUsers() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const user of DEMO_USERS) {
    await prisma.user.upsert({
      where: { email: user.email },
      // hasło nadpisujemy przy każdym seedzie — konto demo ma zawsze działać znanym hasłem
      update: { ...user, passwordHash },
      create: { ...user, passwordHash },
    });
  }

  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: 'wlasciciel@bookit.pl' },
  });
  const employeeUser = await prisma.user.findUniqueOrThrow({
    where: { email: 'pracownik@bookit.pl' },
  });
  const category = await prisma.category.findUniqueOrThrow({
    where: { slug: 'fryzjer' },
  });

  const businessData = {
    // slug też w update: firma demo ma zawsze siedzieć pod adresem z docs/users.md,
    // nawet jeśli ktoś zmienił go wcześniej przez UI
    slug: 'studio-nozyczki',
    name: 'Studio Fryzur „Nożyczki"',
    description: 'Kameralne studio w sercu Kazimierza. Konto demo do testów.',
    phone: '123456789',
    street: 'Józefa 12',
    city: 'Kraków',
    postalCode: '31-056',
    lat: 50.0498,
    lng: 19.9455,
  };

  const business = await prisma.business.upsert({
    // klucz po ownerId, nie po slugu: Business.ownerId też jest @unique, więc gdyby właściciel
    // demo miał już firmę pod innym slugiem (np. założoną przez UI), gałąź create wywaliłaby
    // się na P2002 i zabiła cały seed
    where: { ownerId: owner.id },
    update: businessData,
    create: {
      ...businessData,
      ownerId: owner.id,
      categoryId: category.id,
    },
  });

  // Employee.userId jest unikalne — wystarcza za klucz idempotencji
  const employee = await prisma.employee.upsert({
    where: { userId: employeeUser.id },
    update: { name: 'Marek Wiśniewski', isActive: true },
    create: {
      businessId: business.id,
      userId: employeeUser.id,
      name: 'Marek Wiśniewski',
      isActive: true,
    },
  });

  // Service nie ma naturalnego klucza unikalnego — szukamy po nazwie w obrębie firmy
  const serviceData = {
    name: 'Strzyżenie męskie',
    description: 'Klasyczne lub maszynką, ze stylizacją.',
    durationMin: 30,
    priceCents: 7000,
  };
  const existingService = await prisma.service.findFirst({
    where: { businessId: business.id, name: serviceData.name },
  });
  const service = existingService
    ? await prisma.service.update({
        where: { id: existingService.id },
        data: serviceData,
      })
    : await prisma.service.create({
        data: { ...serviceData, businessId: business.id },
      });

  await prisma.service.update({
    where: { id: service.id },
    data: { employees: { set: [{ id: employee.id }] } },
  });

  // grafik pn–pt 9:00–17:00; WorkingHours nie ma klucza unikalnego, więc podmieniamy komplet
  await prisma.workingHours.deleteMany({ where: { employeeId: employee.id } });
  await prisma.workingHours.createMany({
    data: [0, 1, 2, 3, 4].map((weekday) => ({
      employeeId: employee.id,
      weekday,
      startTime: '09:00',
      endTime: '17:00',
    })),
  });
}

async function main() {
  // upsert po unikalnym slug → idempotentne, można odpalać wielokrotnie
  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name },
      create: category,
    });
  }

  if (demoSeedAllowed()) {
    await seedDemoUsers();
  } else {
    console.log(
      `Pomijam konta demo (NODE_ENV=${process.env.NODE_ENV}). Wymuś przez SEED_DEMO=1.`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
