/**
 * LLM Provider Selector
 * 
 * Single internal contract for all LLM usage.
 * Provider is selected via LLM_PROVIDER env var (default: infinitai).
 * Swapping providers requires only environment variable changes.
 * 
 * Contract:
 *   generatePrompt({ template, sourceCode, metadata }) -> string
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Provider registry - add new providers here
const PROVIDERS = {
    infinitai: () => require('./infinitai'), // MaaS Provider (default)
    openai: () => require('./openai')
};

// In-memory template cache: key = "type/version" -> { content, version, type }
const templateCache = new Map();
// Latest version cache: key = templateType -> version string
const latestVersionCache = new Map();

/**
 * Get the active LLM provider based on LLM_PROVIDER env var.
 */
function getProvider() {
    const providerName = (process.env.LLM_PROVIDER || 'infinitai').toLowerCase();
    const providerFactory = PROVIDERS[providerName];

    if (!providerFactory) {
        throw new Error(
            `Unknown LLM_PROVIDER: "${providerName}". Supported: ${Object.keys(PROVIDERS).join(', ')}`
        );
    }

    return providerFactory();
}

/**
 * Load a template file from the templates directory.
 * Cached in memory after first read.
 * Returns { content, version, type }
 */
function loadTemplate(templateType, version) {
    const cacheKey = `${templateType}/${version}`;
    if (templateCache.has(cacheKey)) {
        return templateCache.get(cacheKey);
    }

    const templateDir = path.resolve(__dirname, '../../templates', templateType);
    const templatePath = path.join(templateDir, `${version}.txt`);

    if (!fs.existsSync(templatePath)) {
        throw new Error(`Template not found: ${templatePath}`);
    }

    const content = fs.readFileSync(templatePath, 'utf-8');
    const entry = { content, version, type: templateType };
    templateCache.set(cacheKey, entry);
    return entry;
}

/**
 * Get the latest version available for a template type.
 * Cached in memory after first directory scan.
 */
function getLatestVersion(templateType) {
    if (latestVersionCache.has(templateType)) {
        return latestVersionCache.get(templateType);
    }

    const templateDir = path.resolve(__dirname, '../../templates', templateType);

    if (!fs.existsSync(templateDir)) {
        throw new Error(`Template directory not found: ${templateDir}`);
    }

    const files = fs.readdirSync(templateDir)
        .filter(f => f.endsWith('.txt'))
        .map(f => f.replace('.txt', ''))
        .sort()
        .reverse();

    if (files.length === 0) {
        throw new Error(`No templates found in: ${templateDir}`);
    }

    latestVersionCache.set(templateType, files[0]);
    return files[0];
}

/**
 * Core contract: generatePrompt
 * 
 * @param {Object} params
 * @param {string} params.template - The template content to use as system prompt
 * @param {string} params.sourceCode - The source code to analyze
 * @param {Object} params.metadata - Metadata for logging (templateType, templateVersion, filePath)
 * @returns {string} - Raw generated prompt text
 */
async function generatePrompt({ template, sourceCode, metadata = {} }) {
    const provider = getProvider();
    const providerName = (process.env.LLM_PROVIDER || 'infinitai').toLowerCase();
    const modelName = process.env.INFINITAI_MODEL || 'meta-llama/Llama-3.2-11B-Vision-Instruct';

    // Compute hashes for traceability
    const sourceHash = crypto.createHash('sha256').update(sourceCode).digest('hex').substring(0, 12);

    console.log(`  🤖 LLM Call: provider=${providerName}, model=${modelName}`);
    console.log(`  📋 Template: type=${metadata.templateType || 'unknown'}, version=${metadata.templateVersion || 'unknown'}`);
    console.log(`  📄 Source: ${metadata.filePath || 'unknown'}, hash=${sourceHash}`);

    const startTime = Date.now();
    const result = await provider.generate({ template, sourceCode });
    const elapsed = Date.now() - startTime;

    const outputHash = crypto.createHash('sha256').update(result).digest('hex').substring(0, 12);

    console.log(`  ✅ Generated in ${elapsed}ms, outputHash=${outputHash}, length=${result.length}`);

    return result;
}

module.exports = {
    generatePrompt,
    loadTemplate,
    getLatestVersion,
    getProvider
};
