import { PrismaClient } from '@prisma/client';

const runtimeDatabaseUrl =
    process.env.PRISMA_DATABASE_URL
    || process.env.DIRECT_URL
    || process.env.DATABASE_URL;

const prismaClientSingleton = () => {
    return new PrismaClient(
        runtimeDatabaseUrl
            ? {
                datasources: {
                    db: {
                        url: runtimeDatabaseUrl,
                    },
                },
            }
            : undefined
    );
};

const globalForPrisma = globalThis;

const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
