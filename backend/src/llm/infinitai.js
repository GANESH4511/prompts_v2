/**
 * InfinitAI MaaS LLM Adapter
 * 
 * Uses InfinitAI's OpenAI-compatible API (MaaS - Model as a Service).
 * Implements the standard LLM contract:
 *   generate({ template, sourceCode }) -> string
 * 
 * Required env vars:
 *   INFINITAI_API_KEY   - API key for authentication
 *   INFINITAI_BASE_URL  - Base URL for the MaaS API
 *   INFINITAI_MODEL     - Model identifier (e.g., meta-llama/Llama-3.2-11B-Vision-Instruct)
 */

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;
const DEFAULT_TIMEOUT_MS = 60000; // 60s timeout for LLM calls

function getConfig() {
    const apiKey = process.env.INFINITAI_API_KEY;
    const baseUrl = process.env.INFINITAI_BASE_URL;
    const model = process.env.INFINITAI_MODEL;

    if (!apiKey) {
        throw new Error('INFINITAI_API_KEY is not configured. Please set it in the backend .env file.');
    }
    if (!baseUrl) {
        throw new Error('INFINITAI_BASE_URL is not configured. Please set it in the backend .env file.');
    }
    if (!model) {
        throw new Error('INFINITAI_MODEL is not configured. Please set it in the backend .env file.');
    }

    return { apiKey, baseUrl, model };
}

/**
 * Call the InfinitAI chat completions endpoint (OpenAI-compatible).
 */
async function callInfinitAI({ systemPrompt, userPrompt, config }) {
    const url = `${config.baseUrl}/chat/completions`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            signal: controller.signal,
            body: JSON.stringify({
                model: config.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.3,
                max_tokens: 100000
            })
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No error body');
            const status = response.status;

            if (status === 429) {
                throw new Error(
                    `API rate limit exceeded. Please retry after a moment. ` +
                    `You may need to check your InfinitAI API quota.`
                );
            }

            if (status === 401 || status === 403) {
                throw new Error(
                    `InfinitAI API authentication failed (${status}). ` +
                    `Please check your INFINITAI_API_KEY in the .env file.`
                );
            }

            throw new Error(
                `InfinitAI API error (${status}): ${errorBody.substring(0, 300)}`
            );
        }

        const data = await response.json();

        if (!data.choices || data.choices.length === 0) {
            throw new Error('InfinitAI returned no choices in the response.');
        }

        const content = data.choices[0].message?.content;

        if (!content || !content.trim()) {
            throw new Error('InfinitAI returned an empty response.');
        }

        return content.trim();
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Generate prompt text from a template and source code.
 * Implements the standard LLM adapter contract.
 * 
 * @param {Object} params
 * @param {string} params.template - The template content (used as system prompt)
 * @param {string} params.sourceCode - The source code to analyze (used as user prompt)
 * @returns {string} - Generated prompt text
 */
async function generate({ template, sourceCode }) {
    const config = getConfig();

    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
        try {
            const result = await callInfinitAI({
                systemPrompt: template,
                userPrompt: `Analyze the following source code and generate prompts as instructed:\n\n${sourceCode}`,
                config
            });
            return result;
        } catch (error) {
            lastError = error;
            const msg = error.message || '';

            // Don't retry auth errors
            if (msg.includes('authentication') || msg.includes('API key')) {
                throw error;
            }

            // Retry on rate limits and transient errors
            if (attempt <= MAX_RETRIES) {
                const delay = RETRY_DELAY_MS * attempt;
                console.log(`  ⏳ Retry ${attempt}/${MAX_RETRIES} after ${delay}ms: ${msg.substring(0, 100)}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError;
}

module.exports = { generate };
