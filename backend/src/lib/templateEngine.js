/**
 * Template Engine
 * 
 * Cached template loading and version resolution.
 * Extracted from `llm/index.js` so any module can load
 * templates without pulling in the full LLM provider stack.
 */

const fs = require('fs');
const path = require('path');

// In-memory template cache: key = "type/version" -> { content, version, type }
const templateCache = new Map();
// Latest version cache: key = templateType -> version string
const latestVersionCache = new Map();

/**
 * Load a template file from the templates directory.
 * Cached in memory after first read.
 *
 * @param {string} templateType - Subdirectory name (e.g. 'implement', 'implement-plan')
 * @param {string} version      - Version filename without extension (e.g. 'v1')
 * @returns {{ content: string, version: string, type: string }}
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
 *
 * @param {string} templateType - Subdirectory name
 * @returns {string} Latest version string (e.g. 'v2')
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
 * Clear all caches. Useful for tests or hot-reload scenarios.
 */
function clearCaches() {
    templateCache.clear();
    latestVersionCache.clear();
}

module.exports = { loadTemplate, getLatestVersion, clearCaches };
