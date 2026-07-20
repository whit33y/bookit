import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

async function main() {
  // upsert po unikalnym slug → idempotentne, można odpalać wielokrotnie
  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name },
      create: category,
    });
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
