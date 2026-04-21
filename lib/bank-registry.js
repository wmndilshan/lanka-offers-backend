const fs = require('fs');
const path = require('path');

const BANK_CONFIGS = {
    hnb: {
        bank: 'hnb',
        displayName: 'HNB',
        scriptPrefixes: ['hnb'],
        geoBank: 'hnb',
        supportsGeocode: true,
    },
    boc: {
        bank: 'boc',
        displayName: 'BOC',
        scriptPrefixes: ['boc'],
        geoBank: 'boc',
        supportsGeocode: true,
    },
    ndb: {
        bank: 'ndb',
        displayName: 'NDB',
        scriptPrefixes: ['ndb'],
        geoBank: 'ndb',
        supportsGeocode: true,
    },
    peoples: {
        bank: 'peoples',
        displayName: "People's Bank",
        scriptPrefixes: ['people', 'peoples'],
        geoBank: 'peoples',
        supportsGeocode: true,
    },
    dfcc: {
        bank: 'dfcc',
        displayName: 'DFCC',
        scriptPrefixes: ['dfcc'],
        geoBank: 'dfcc',
        // Adapter relies on known-chains matching; CSV data has no addresses.
        // Enable once Puppeteer scraper is unblocked and detail pages are extracted.
        supportsGeocode: false,
    },
    seylan: {
        bank: 'seylan',
        displayName: 'Seylan',
        scriptPrefixes: ['seylan'],
        geoBank: 'seylan',
        supportsGeocode: true,
    },
    sampath: {
        bank: 'sampath',
        displayName: 'Sampath',
        scriptPrefixes: ['sampath'],
        geoBank: 'sampath',
        supportsGeocode: true,
    },
    pabc: {
        bank: 'pabc',
        displayName: 'PABC',
        scriptPrefixes: ['panasia', 'pabc'],
        geoBank: 'pabc',
        supportsGeocode: true,
    },
};

function getProjectRoot(startDir = process.cwd()) {
    return fs.existsSync(path.join(startDir, 'package.json'))
        ? startDir
        : path.resolve(startDir, '..');
}

function getBanksDir(rootDir = getProjectRoot()) {
    return path.join(rootDir, 'banks');
}

function listBanks() {
    return Object.keys(BANK_CONFIGS);
}

function listBanksByCapability(capability) {
    return listBanks().filter((bank) => {
        const config = BANK_CONFIGS[bank];
        if (capability === 'geocode') return Boolean(config.supportsGeocode);
        return true;
    });
}

function getBankConfig(bankName) {
    const key = String(bankName || '').toLowerCase();
    const config = BANK_CONFIGS[key];
    if (!config) {
        throw new Error(`Unknown bank: ${bankName}. Available: ${listBanks().join(', ')}`);
    }
    return config;
}

function findLatestVersionedFile(rootDir, prefix) {
    const files = fs.readdirSync(rootDir);
    const pattern = new RegExp(`^${prefix}-(\\d+)\\.js$`, 'i');

    const matches = files
        .map((fileName) => {
            const match = fileName.match(pattern);
            if (!match) return null;
            return {
                fileName,
                version: Number(match[1]),
            };
        })
        .filter(Boolean)
        .sort((left, right) => right.version - left.version);

    return matches[0] || null;
}

function getManifestPath(bankName, rootDir = getProjectRoot()) {
    return path.join(getBanksDir(rootDir), String(bankName).toLowerCase(), 'manifest.json');
}

function loadBankManifest(bankName, rootDir = getProjectRoot()) {
    const manifestPath = getManifestPath(bankName, rootDir);
    if (!fs.existsSync(manifestPath)) {
        return null;
    }

    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    return {
        ...manifest,
        manifestPath,
    };
}

function getManifestValue(bankName, key, rootDir = getProjectRoot()) {
    const manifest = loadBankManifest(bankName, rootDir);
    return manifest ? manifest[key] : null;
}

function resolveOutputFile(bankName, kind, rootDir = getProjectRoot()) {
    const config = getBankConfig(bankName);
    const manifest = loadBankManifest(config.bank, rootDir);

    if (kind === 'structured') {
        if (manifest?.structuredOutput) return manifest.structuredOutput;
        return `${config.bank}_all.json`;
    }

    if (kind === 'geo') {
        if (manifest?.geoOutput) return manifest.geoOutput;
        return `${config.geoBank}_geo.json`;
    }

    throw new Error(`Unknown output kind: ${kind}`);
}

function resolveOutputPath(bankName, kind, rootDir = getProjectRoot()) {
    return path.join(rootDir, 'output', resolveOutputFile(bankName, kind, rootDir));
}

function resolveManifestScript(config, manifest, rootDir) {
    if (!manifest?.active) {
        return null;
    }

    const candidatePath = path.join(rootDir, manifest.active);
    if (!fs.existsSync(candidatePath)) {
        throw new Error(`Manifest for ${config.bank} points to missing scraper: ${manifest.active}`);
    }

    const versionMatch = manifest.active.match(/-(\d+)\.js$/i);
    return {
        ...config,
        scriptFile: manifest.active,
        scriptPath: candidatePath,
        scriptVersion: versionMatch ? Number(versionMatch[1]) : null,
        resolutionMode: 'manifest',
        manifestPath: manifest.manifestPath,
    };
}

function resolveScraperScript(bankName, rootDir = getProjectRoot()) {
    const config = getBankConfig(bankName);
    const manifest = loadBankManifest(config.bank, rootDir);
    const manifestScript = resolveManifestScript(config, manifest, rootDir);

    if (manifestScript) {
        return manifestScript;
    }

    for (const prefix of config.scriptPrefixes) {
        const versioned = findLatestVersionedFile(rootDir, prefix);
        if (versioned) {
            return {
                ...config,
                scriptFile: versioned.fileName,
                scriptPath: path.join(rootDir, versioned.fileName),
                scriptVersion: versioned.version,
                resolutionMode: 'latest-version',
                manifestPath: getManifestPath(config.bank, rootDir),
            };
        }

        const fallbackFile = `${prefix}.js`;
        const fallbackPath = path.join(rootDir, fallbackFile);
        if (fs.existsSync(fallbackPath)) {
            return {
                ...config,
                scriptFile: fallbackFile,
                scriptPath: fallbackPath,
                scriptVersion: null,
                resolutionMode: 'fallback-file',
                manifestPath: getManifestPath(config.bank, rootDir),
            };
        }
    }

    throw new Error(`No scraper script found for bank: ${bankName}`);
}

function resolveAllScraperScripts(rootDir = getProjectRoot()) {
    return listBanks().map((bank) => resolveScraperScript(bank, rootDir));
}

module.exports = {
    BANK_CONFIGS,
    getBankConfig,
    getBanksDir,
    getManifestValue,
    getManifestPath,
    getProjectRoot,
    listBanksByCapability,
    loadBankManifest,
    listBanks,
    resolveOutputFile,
    resolveOutputPath,
    resolveAllScraperScripts,
    resolveScraperScript,
};
