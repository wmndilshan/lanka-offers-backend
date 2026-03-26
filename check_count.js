const { PrismaClient } = require('@prisma/client');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'dashboard', '.env') });
const prisma = new PrismaClient();

async function main() {
    const count = await prisma.offer.count();
    console.log(`Current offer count: ${count}`);
    await prisma.$disconnect();
}
main();
