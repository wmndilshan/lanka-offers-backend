const path = require('path');
const { spawn } = require('child_process');
const {
    getProjectRoot,
    listBanks,
    resolveAllScraperScripts,
    resolveScraperScript,
} = require('../lib/bank-registry');

function getArg(name) {
    const arg = process.argv.slice(2).find((item) => item.startsWith(`--${name}=`));
    return arg ? arg.split('=').slice(1).join('=') : null;
}

function hasFlag(flag) {
    return process.argv.slice(2).includes(`--${flag}`);
}

function runNodeScript(scriptPath, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn('node', [scriptPath], {
            cwd,
            env: { ...process.env },
            stdio: 'inherit',
        });

        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`Script failed with exit code ${code}: ${path.basename(scriptPath)}`));
        });
    });
}

async function main() {
    const bankArg = (getArg('bank') || '').toLowerCase();
    const resolveOnly = hasFlag('resolve-only');
    const rootDir = getProjectRoot(process.cwd());

    if (!bankArg) {
        throw new Error(`Missing --bank option. Use one of: ${listBanks().join(', ')}, all`);
    }

    const targets = bankArg === 'all'
        ? resolveAllScraperScripts(rootDir)
        : [resolveScraperScript(bankArg, rootDir)];

    if (resolveOnly) {
        console.log(JSON.stringify(targets.map((target) => ({
            bank: target.bank,
            scriptFile: target.scriptFile,
            scriptVersion: target.scriptVersion,
            resolutionMode: target.resolutionMode,
            manifestPath: target.manifestPath,
        })), null, 2));
        return;
    }

    for (const target of targets) {
        console.log(`\n=== SCRAPE ${target.displayName} ===`);
        console.log(`Using ${target.scriptFile}`);
        await runNodeScript(target.scriptPath, rootDir);
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
