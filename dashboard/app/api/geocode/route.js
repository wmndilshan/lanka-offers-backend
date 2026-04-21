import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { requireAdminKey } from '@/lib/dashboard-auth.mjs';

export async function POST(request) {
    const authError = requireAdminKey(request);
    if (authError) return authError;

    try {
        const body = await request.json();
        const { bank, apiKey } = body;

        if (!bank) {
            return NextResponse.json({ success: false, error: 'Missing bank parameter' }, { status: 400 });
        }

        const rootDir = path.join(process.cwd(), '..');
        const scriptPath = path.join(rootDir, 'geo', 'index.js');

        const args = [`--bank=${bank}`];
        const childEnv = { ...process.env };
        if (apiKey) {
            childEnv.GOOGLE_MAPS_API_KEY = apiKey;
        }

        return new Promise((resolve) => {
            let output = '';
            let errorOutput = '';

            // Named 'child' to avoid shadowing Node's global `process`
            const child = spawn('node', [scriptPath, ...args], { cwd: rootDir, env: childEnv });

            child.stdout.on('data', (data) => { output += data.toString(); });
            child.stderr.on('data', (data) => { errorOutput += data.toString(); });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve(NextResponse.json({ success: true, message: 'Geocoding completed successfully', output, bank }));
                } else {
                    resolve(NextResponse.json({ success: false, error: `Geocoding failed with exit code ${code}`, output, errorOutput }, { status: 500 }));
                }
            });

            child.on('error', (err) => {
                resolve(NextResponse.json({ success: false, error: err.message, output, errorOutput }, { status: 500 }));
            });
        });
    } catch (error) {
        console.error('Error in geocode API:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
