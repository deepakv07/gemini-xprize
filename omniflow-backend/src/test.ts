import prisma from './models';

async function main() {
  const users = await prisma.user.findMany();

  console.log(users);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
