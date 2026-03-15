/**
 * LLM Provider Selector
 * 
 * Single internal contract for all LLM usage.
 * Provider is selected via LLM_PROVIDER env var (default: infinitai).
 * Swapping providers requires only environment variable changes.
 * 
 * Contract:
 *   generatePrompt({ template, sourceCode, metadata }) -> string
 *   generatePromptStream({ template, sourceCode, metadata, onChunk }) -> string
 */

const crypto = require('crypto');

// Re-export template helpers so existing callers still work via require('../llm')
const { loadTemplate, getLatestVersion } = require('../lib/templateEngine');

// Provider registry - add new providers here
const PROVIDERS = {
    infinitai: () => require('./infinitai'), // MaaS Provider (default)
    openai: () => require('./openai')
};

const DEFAULT_TIMEOUT_MS = 300000; // 5 minute default

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
 * Core contract: generatePrompt (non-streaming, with timeout)
 */
async function generatePrompt({ template, sourceCode, metadata = {}, timeoutMs }) {
    const provider = getProvider();
    const providerName = (process.env.LLM_PROVIDER || 'infinitai').toLowerCase();
    const modelName = process.env.INFINITAI_MODEL || 'meta-llama/Llama-3.2-11B-Vision-Instruct';

    const sourceHash = crypto.createHash('sha256').update(sourceCode).digest('hex').substring(0, 12);

    console.log(`  🤖 LLM Call: provider=${providerName}, model=${modelName}`);
    console.log(`  📋 Template: type=${metadata.templateType || 'unknown'}, version=${metadata.templateVersion || 'unknown'}`);
    console.log(`  📄 Source: ${metadata.filePath || 'unknown'}, hash=${sourceHash}`);

    const timeout = timeoutMs || DEFAULT_TIMEOUT_MS;
    const startTime = Date.now();

    const resultPromise = provider.generate({ template, sourceCode });

    // Wrap with timeout
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`LLM call timed out after ${timeout}ms`)), timeout)
    );

    const result = await Promise.race([resultPromise, timeoutPromise]);
    const elapsed = Date.now() - startTime;

    const outputHash = crypto.createHash('sha256').update(result).digest('hex').substring(0, 12);
    console.log(`  ✅ Generated in ${elapsed}ms, outputHash=${outputHash}, length=${result.length}`);

    return result;
}

/**
 * Streaming contract: generatePromptStream
 * Calls the provider's streaming API and invokes onChunk for each text chunk.
 * Returns the full accumulated text.
 * 
 * @param {Object} params
 * @param {string} params.template - System prompt
 * @param {string} params.sourceCode - User prompt content
 * @param {Object} params.metadata - Logging metadata
 * @param {function} params.onChunk - Called with each text chunk as it arrives
 * @returns {string} Full accumulated response text
 */
async function generatePromptStream({ template, sourceCode, metadata = {}, onChunk }) {
    const provider = getProvider();
    const providerName = (process.env.LLM_PROVIDER || 'infinitai').toLowerCase();
    const modelName = process.env.INFINITAI_MODEL || 'meta-llama/Llama-3.2-11B-Vision-Instruct';

    const sourceHash = crypto.createHash('sha256').update(sourceCode).digest('hex').substring(0, 12);

    console.log(`  🤖 LLM Stream: provider=${providerName}, model=${modelName}`);
    console.log(`  📋 Template: type=${metadata.templateType || 'unknown'}, version=${metadata.templateVersion || 'unknown'}`);
    console.log(`  📄 Source: ${metadata.filePath || 'unknown'}, hash=${sourceHash}`);

    const startTime = Date.now();

    if (typeof provider.generateStream !== 'function') {
        // Fallback: provider doesn't support streaming, use batch and emit all at once
        console.log(`  ⚠️ Provider ${providerName} has no streaming support, falling back to batch`);
        const result = await provider.generate({ template, sourceCode });
        if (onChunk) onChunk(result);
        return result;
    }

    const result = await provider.generateStream({ template, sourceCode, onChunk });
    const elapsed = Date.now() - startTime;

    const outputHash = crypto.createHash('sha256').update(result).digest('hex').substring(0, 12);
    console.log(`  ✅ Streamed in ${elapsed}ms, outputHash=${outputHash}, length=${result.length}`);

    return result;
}

module.exports = {
    generatePrompt,
    generatePromptStream,
    loadTemplate,
    getLatestVersion,
    getProvider
};
