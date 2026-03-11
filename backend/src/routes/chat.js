/**
 * POST /api/chat
 * 
 * Streaming chat endpoint using InfinitAI MaaS (OpenAI-compatible).
 * Sends messages to the LLM and streams the response back via SSE.
 * 
 * Input: { messages: [{ role, content }], model? }
 * Output: Server-Sent Events stream with chunked response
 */

const express = require('express');
const router = express.Router();

/**
 * Get InfinitAI configuration from environment
 */
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

    return { apiKey, baseUrl, model: model || 'meta-llama/Llama-3.2-11B-Vision-Instruct' };
}

/**
 * POST /api/chat — streaming chat
 */
router.post('/', async (req, res) => {
    const { messages, model: requestModel } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'messages array is required and must not be empty'
        });
    }

    try {
        const config = getConfig();
        const modelToUse = requestModel || config.model;

        console.log(`\n💬 Chat Request`);
        console.log(`  🤖 Model: ${modelToUse}`);
        console.log(`  📨 Messages: ${messages.length}`);

        const url = `${config.baseUrl}/chat/completions`;

        // Set up SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90000); // 90s timeout for chat

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            signal: controller.signal,
            body: JSON.stringify({
                model: modelToUse,
                messages: messages.map(m => ({
                    role: m.role,
                    content: m.content
                })),
                temperature: 0.7,
                max_tokens: 100000,
                stream: true
            })
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No error body');
            const status = response.status;

            let errorMsg = `InfinitAI API error (${status})`;
            if (status === 429) {
                errorMsg = 'Rate limit exceeded. Please wait a moment and try again.';
            } else if (status === 401 || status === 403) {
                errorMsg = 'Authentication failed. Please check your InfinitAI API key.';
            } else {
                errorMsg = `API error: ${errorBody.substring(0, 200)}`;
            }

            res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
        }

        // Stream the response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    if (trimmed === 'data: [DONE]') {
                        res.write('data: [DONE]\n\n');
                        continue;
                    }

                    if (trimmed.startsWith('data: ')) {
                        try {
                            const json = JSON.parse(trimmed.slice(6));
                            const content = json.choices?.[0]?.delta?.content;
                            if (content) {
                                res.write(`data: ${JSON.stringify({ content })}\n\n`);
                            }
                        } catch (e) {
                            // Skip malformed JSON chunks
                        }
                    }
                }
            }

            // Process remaining buffer
            if (buffer.trim()) {
                const trimmed = buffer.trim();
                if (trimmed === 'data: [DONE]') {
                    res.write('data: [DONE]\n\n');
                } else if (trimmed.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        const content = json.choices?.[0]?.delta?.content;
                        if (content) {
                            res.write(`data: ${JSON.stringify({ content })}\n\n`);
                        }
                    } catch (e) { }
                }
            }
        } catch (streamErr) {
            console.error('  ❌ Stream error:', streamErr.message);
            res.write(`data: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`);
        }

        res.write('data: [DONE]\n\n');
        res.end();
        clearTimeout(timeout);
        console.log(`  ✅ Chat stream completed`);

    } catch (error) {
        console.error('  ❌ Chat error:', error.message);

        // If headers haven't been sent yet
        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }

        // If we're already streaming
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
    }
});

/**
 * POST /api/chat/sync — non-streaming chat (fallback)
 */
router.post('/sync', async (req, res) => {
    const { messages, model: requestModel } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'messages array is required and must not be empty'
        });
    }

    try {
        const config = getConfig();
        const modelToUse = requestModel || config.model;

        const url = `${config.baseUrl}/chat/completions`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: modelToUse,
                messages: messages.map(m => ({
                    role: m.role,
                    content: m.content
                })),
                temperature: 0.7,
                max_tokens: 100000,
                stream: false
            })
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No error body');
            return res.status(response.status).json({
                success: false,
                error: `InfinitAI API error: ${errorBody.substring(0, 300)}`
            });
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';

        res.json({
            success: true,
            message: {
                role: 'assistant',
                content
            },
            model: modelToUse,
            usage: data.usage || null
        });
    } catch (error) {
        console.error('  ❌ Sync chat error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
