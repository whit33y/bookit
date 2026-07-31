import { PrismaClient } from '@prisma/client';
import { seedCategories, seedDemo } from './seed/seed-demo';

const prisma = new PrismaClient();

/**
 * Dane demo zakładamy tylko na środowisku deweloperskim. Jest wśród nich konto ADMIN z hasłem
 * zapisanym wprost w repozytorium (i w README), więc puszczenie tego seeda na czymkolwiek
 * publicznym oznaczałoby oddanie moderacji serwisu każdemu, kto zna repo.
 * Nieustawione NODE_ENV traktujemy jak lokalny development; każda inna wartość wymaga
 * świadomego SEED_DEMO=1.
 */
function demoSeedAllowed(): boolean {
  if (process.env.SEED_DEMO === '1') {
    return true;
  }
  const env = process.env.NODE_ENV;
  return (
    env === undefined || env === '' || env === 'development' || env === 'test'
  );
}

async function main() {
  await seedCategories(prisma);

  if (demoSeedAllowed()) {
    await seedDemo(prisma);
  } else {
    console.log(
      `Pomijam dane demo (NODE_ENV=${process.env.NODE_ENV}). Wymuś przez SEED_DEMO=1.`,
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
