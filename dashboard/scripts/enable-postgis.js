/**
 * Script to enable PostGIS extension in Neon database
 * Run this before running Prisma migrations
 */

const { Client } = require('pg');
require('dotenv').config();

async function enablePostGIS() {
    const client = new Client({
        connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    });

    try {
        console.log('Connecting to Neon database...');
        await client.connect();

        console.log('Enabling PostGIS extension...');
        await client.query('CREATE EXTENSION IF NOT EXISTS postgis;');

        console.log('Verifying PostGIS installation...');
        const result = await client.query('SELECT PostGIS_version();');
        console.log('✅ PostGIS version:', result.rows[0].postgis_version);

        console.log('\n✅ PostGIS successfully enabled!');
    } catch (error) {
        console.error('❌ Error enabling PostGIS:', error.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

enablePostGIS();
