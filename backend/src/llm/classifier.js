/**
 * File Category Classifier
 * 
 * Uses InfinitAI LLM to classify project files into FRONTEND, BACKEND, or DATABASE.
 * Falls back to deterministic rule-based classification if LLM fails.
 * 
 * Contract:
 *   classifyFiles(files: { filePath, fileName }[]) -> Record<string, 'FRONTEND' | 'BACKEND' | 'DATABASE'>
 */

const BATCH_SIZE = 50;

// ==========================================
// Deterministic Fallback Classifier
// ==========================================

const FRONTEND_DIRS = new Set([
    'app', 'pages', 'components', 'styles', 'views', 'layouts', 'ui',
    'hooks', 'contexts', 'providers', 'store', 'redux', 'atoms',
    'public', 'assets', 'images', 'fonts', 'icons', 'theme'
]);

const DATABASE_DIRS = new Set([
    'prisma', 'migrations', 'seeds', 'seeders', 'models', 'entities',
    'schemas', 'db', 'database', 'knex', 'typeorm', 'sequelize',
    'drizzle', 'mongoose'
]);

const FRONTEND_EXTENSIONS = new Set([
    '.tsx', '.jsx', '.css', '.scss', '.sass', '.less', '.styl',
    '.vue', '.svelte', '.html', '.svg'
]);

const DATABASE_PATTERNS = [
    /schema\./i, /migration/i, /seed\./i, /\.prisma$/i,
    /\.sql$/i, /knexfile/i, /ormconfig/i
];

/**
 * Rule-based fallback classifier.
 * Uses directory names, file extensions, and filename patterns.
 */
function classifyByRules(filePath) {
    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
    const parts = normalizedPath.split('/');
    const fileName = parts[parts.length - 1];
    const ext = '.' + (fileName.split('.').pop() || '');

    // Check database patterns first (most specific)
    if (DATABASE_PATTERNS.some(p => p.test(normalizedPath))) {
        return 'DATABASE';
    }

    // Check if any directory in the path matches database dirs
    for (const part of parts) {
        if (DATABASE_DIRS.has(part)) {
            return 'DATABASE';
        }
    }

    // Check frontend extensions
    if (FRONTEND_EXTENSIONS.has(ext)) {
        return 'FRONTEND';
    }

    // Check if any directory in the path matches frontend dirs
    for (const part of parts) {
        if (FRONTEND_DIRS.has(part)) {
            return 'FRONTEND';
        }
    }

    // Check for common backend directories
    const BACKEND_DIRS = new Set([
        'routes', 'controllers', 'services', 'middleware', 'api',
        'lib', 'utils', 'helpers', 'config', 'scripts', 'server',
        'src'  // 'src' alone defaults to backend
    ]);

    for (const part of parts) {
        if (BACKEND_DIRS.has(part)) {
            // But if a deeper path contains frontend dirs, it's frontend
            const afterIdx = parts.indexOf(part);
            const rest = parts.slice(afterIdx + 1);
            if (rest.some(r => FRONTEND_DIRS.has(r))) {
                return 'FRONTEND';
            }
            return 'BACKEND';
        }
    }

    // Default to BACKEND
    return 'BACKEND';
}

// ==========================================
// LLM-based Classifier
// ==========================================

const CLASSIFICATION_SYSTEM_PROMPT = `You are a code project file classifier. Given a list of file paths from a software project, classify each file into exactly one of three categories:

1. FRONTEND — Files related to the user interface, browser rendering, React/Vue/Angular components, pages, styles, layouts, hooks, contexts, providers, client-side state management, and UI assets.

2. BACKEND — Files related to server-side logic, API routes, controllers, services, middleware, server-side utilities, authentication handlers, and server configuration.

3. DATABASE — Files related to database schemas, ORM models, migrations, seed files, database configuration, and query builders.

RULES:
- Respond ONLY with valid JSON. No explanations, no markdown.
- The JSON must be an object where keys are the file paths (exactly as provided) and values are one of: "FRONTEND", "BACKEND", or "DATABASE".
- If unsure, default to "BACKEND".
- Files with .tsx, .jsx, .css, .scss extensions are typically FRONTEND.
- Files under prisma/, migrations/, seeds/ are typically DATABASE.
- Files under routes/, middleware/, services/ are typically BACKEND.
- Files under app/, components/, pages/, layouts/ are typically FRONTEND.

Example input:
["app/login/page.js", "prisma/schema.prisma", "src/routes/auth.js"]

Example output:
{"app/login/page.js":"FRONTEND","prisma/schema.prisma":"DATABASE","src/routes/auth.js":"BACKEND"}`;

/**
 * Classify a batch of files using the InfinitAI LLM.
 * @param {Array<{filePath: string, fileName: string}>} files
 * @returns {Record<string, string>} Map of filePath -> category
 */
async function classifyWithLLM(files) {
    try {
        const { getProvider } = require('./index');
        const provider = getProvider();

        const filePaths = files.map(f => f.filePath);
        const userPrompt = JSON.stringify(filePaths);

        const result = await provider.generate({
            template: CLASSIFICATION_SYSTEM_PROMPT,
            sourceCode: userPrompt
        });

        // Parse JSON response from LLM
        // Sometimes the LLM wraps it in markdown code blocks, strip those
        let cleaned = result.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        }

        const parsed = JSON.parse(cleaned);

        // Validate the response
        const validCategories = new Set(['FRONTEND', 'BACKEND', 'DATABASE']);
        const classifications = {};

        for (const fp of filePaths) {
            const cat = parsed[fp];
            if (cat && validCategories.has(cat.toUpperCase())) {
                classifications[fp] = cat.toUpperCase();
            } else {
                // Fallback for this specific file
                classifications[fp] = classifyByRules(fp);
            }
        }

        return classifications;
    } catch (error) {
        console.error('  ⚠️ LLM classification failed, using rule-based fallback:', error.message);
        // Full fallback to rules
        const classifications = {};
        for (const f of files) {
            classifications[f.filePath] = classifyByRules(f.filePath);
        }
        return classifications;
    }
}

/**
 * Main entry point: classify an array of files into categories.
 * Batches requests to the LLM and falls back to rules on failure.
 * 
 * @param {Array<{filePath: string, fileName: string}>} files
 * @returns {Promise<Record<string, 'FRONTEND' | 'BACKEND' | 'DATABASE'>>}
 */
async function classifyFiles(files) {
    if (!files || files.length === 0) return {};

    console.log(`  🧠 Classifying ${files.length} files...`);

    const allClassifications = {};

    // Process in batches
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(files.length / BATCH_SIZE);

        console.log(`  📦 Batch ${batchNum}/${totalBatches} (${batch.length} files)`);

        const classifications = await classifyWithLLM(batch);
        Object.assign(allClassifications, classifications);
    }

    // Log summary
    const counts = { FRONTEND: 0, BACKEND: 0, DATABASE: 0 };
    for (const cat of Object.values(allClassifications)) {
        counts[cat] = (counts[cat] || 0) + 1;
    }
    console.log(`  ✅ Classification complete: 🎨 Frontend=${counts.FRONTEND}, ⚙️ Backend=${counts.BACKEND}, 🗄️ Database=${counts.DATABASE}`);

    return allClassifications;
}

module.exports = { classifyFiles, classifyByRules };
