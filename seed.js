const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();
async function main() {
  await prisma.shop.create({
    data: { shopId: 'test-shop-1', shopDomain: 'test.myshopify.com', accessToken: 'mock' }
  }).catch(e => console.log(e.message));
}
main().finally(() => console.log('Seeded!'));
