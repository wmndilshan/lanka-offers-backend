import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { requireAdminKey } from '@/lib/dashboard-auth.mjs';

export async function POST(request) {
    const authError = requireAdminKey(request);
    if (authError) return authError;
  try {
    const body = await request.json();
    const { bank, action } = body;

    if (!bank || !action) {
      return NextResponse.json(
        { success: false, error: 'Missing bank or action parameter' },
        { status: 400 }
      );
    }

    const rootDir = path.join(process.cwd(), '..');

    // Determine which script to run
    let scriptPath;
    let args = [];

    if (action === 'scrape') {
      scriptPath = path.join(rootDir, 'scripts', 'run-bank-scraper.js');
      args = [`--bank=${bank.toLowerCase()}`];
    } else if (action === 'geocode') {
      scriptPath = path.join(rootDir, 'geo', 'index.js');
      args = [`--bank=${bank.toLowerCase()}`];
    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid action. Use "scrape" or "geocode"' },
        { status: 400 }
      );
    }

    // Create a readable stream for the response
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        // Guard: track whether the stream has been closed (client disconnect or normal finish).
        // Without this, child process stdout/stderr events arriving after the client navigates
        // away throw ERR_INVALID_STATE because the controller is already closed.
        let isClosed = false;

        const safeEnqueue = (chunk) => {
          if (isClosed) return;
          try {
            controller.enqueue(chunk);
          } catch (_) {
            isClosed = true;
          }
        };

        const safeClose = () => {
          if (isClosed) return;
          isClosed = true;
          try { controller.close(); } catch (_) { }
        };

        const childProcess = spawn('node', [scriptPath, ...args], {
          cwd: rootDir,
          env: { ...process.env }
        });

        childProcess.stdout.on('data', (data) => {
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ log: `[STDOUT] ${data.toString()}` })}\n\n`));
        });

        childProcess.stderr.on('data', (data) => {
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ log: `[STDERR] ${data.toString()}` })}\n\n`));
        });

        childProcess.on('close', (code) => {
          const message = code === 0 ? 'Process completed successfully' : `Process exited with code ${code}`;
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ log: message, done: true, success: code === 0 })}\n\n`));
          safeClose();
        });

        childProcess.on('error', (error) => {
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ log: `Error: ${error.message}`, done: true, success: false })}\n\n`));
          safeClose();
        });
      },

      cancel() {
        // Called by Next.js/browser when the client disconnects.
        // The isClosed flag above will suppress any subsequent enqueue attempts.
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error in scrapers API:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
