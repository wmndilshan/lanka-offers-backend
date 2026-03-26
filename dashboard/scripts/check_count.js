const { PrismaClient } = require('@prisma/client');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const prisma = new PrismaClient();

async function main() {
    try {
        const count = await prisma.offer.count();
        console.log(`Current offer count: ${count}`);
    } catch (e) {
        console.error(`Error checking count: ${e.message}`);
    } finally {
        await prisma.$disconnect();
    }
}
main();
