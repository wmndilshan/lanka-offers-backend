
const { Client } = require('pg');
require('dotenv').config();

async function testConnection(name, connectionString) {
    console.log(`\nTesting ${name} connection...`);
    console.log(`URL: ${connectionString.replace(/:[^:@]+@/, ':****@')}`); // Hide password

    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false } // Required for Neon
    });

    try {
        await client.connect();
        console.log(`✅ Connected successfully to ${name}!`);
        const res = await client.query('SELECT version();');
        console.log(`   Version: ${res.rows[0].version}`);
        await client.end();
        return true;
    } catch (err) {
        console.error(`❌ Failed to connect to ${name}:`, err.message);
        if (client) await client.end().catch(() => { });
        return false;
    }
}

async function run() {
    console.log('🔍 Starting Database Connectivity Test...');

    const poolSuccess = await testConnection('Pooled (DATABASE_URL)', process.env.DATABASE_URL);
    const directSuccess = await testConnection('Direct (DIRECT_URL)', process.env.DIRECT_URL);

    if (poolSuccess && directSuccess) {
        console.log('\n✅ All connections successful! Database is reachable.');
    } else if (!poolSuccess && directSuccess) {
        console.log('\n⚠️  Direct connection works but Pooled failed. Check PgBouncer or URL parameters.');
    } else {
        console.log('\n❌ Database unreachable. Check network, firewall, or credentials.');
    }
}

run();
