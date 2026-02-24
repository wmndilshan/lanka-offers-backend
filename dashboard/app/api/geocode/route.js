import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export async function POST(request) {
  try {
    const body = await request.json();
    const { bank, apiKey } = body;

    if (!bank) {
      return NextResponse.json(
        { success: false, error: 'Missing bank parameter' },
        { status: 400 }
      );
    }

    const rootDir = path.join(process.cwd(), '..');
    const scriptPath = path.join(rootDir, 'geo', 'index.js');

    const args = [`--bank=${bank}`];
    const env = { ...process.env };

    // Add API key to environment if provided
    if (apiKey) {
      env.GOOGLE_MAPS_API_KEY = apiKey;
    }

    return new Promise((resolve) => {
      let output = '';
      let errorOutput = '';

      const process = spawn('node', [scriptPath, ...args], {
        cwd: rootDir,
        env: env
      });

      process.stdout.on('data', (data) => {
        output += data.toString();
      });

      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(NextResponse.json({
            success: true,
            message: 'Geocoding completed successfully',
            output: output,
            bank: bank
          }));
        } else {
          resolve(NextResponse.json(
            {
              success: false,
              error: `Geocoding failed with exit code ${code}`,
              output: output,
              errorOutput: errorOutput
            },
            { status: 500 }
          ));
        }
      });

      process.on('error', (error) => {
        resolve(NextResponse.json(
          {
            success: false,
            error: error.message,
            output: output,
            errorOutput: errorOutput
          },
          { status: 500 }
        ));
      });
    });
  } catch (error) {
    console.error('Error in geocode API:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
