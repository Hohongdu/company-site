const express = require('express');
const axios = require('axios');

const router = express.Router();

const TRANSLATE_PROVIDER = process.env.TRANSLATE_PROVIDER || 'libre';
const TRANSLATE_API_KEY = process.env.TRANSLATE_API_KEY;
const ENABLE_HOST_DOCKER_INTERNAL = process.env.ENABLE_HOST_DOCKER_INTERNAL === 'true';
const ENABLE_CONTAINER_SERVICE_NAME = process.env.ENABLE_CONTAINER_SERVICE_NAME === 'true';
const ENABLE_PUBLIC_LIBRETRANSLATE = process.env.ENABLE_PUBLIC_LIBRETRANSLATE === 'true';
const REQUEST_TIMEOUT_MS = Number(process.env.TRANSLATE_TIMEOUT_MS || 3500);
const FAIL_COOLDOWN_MS = Number(process.env.TRANSLATE_FAIL_COOLDOWN_MS || 120000);

let libreUnavailableUntil = 0;

const DEFAULT_LIBRE_URLS = [
    'http://127.0.0.1:5000/translate',
    'http://localhost:5000/translate',
];

const getLibreTranslateUrls = () => {
    const raw = process.env.TRANSLATE_API_URL;
    const configured = !raw || !raw.trim()
        ? []
        : raw
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);

    const defaults = [...DEFAULT_LIBRE_URLS];
    if (ENABLE_CONTAINER_SERVICE_NAME) defaults.push('http://libretranslate:5000/translate');
    if (ENABLE_HOST_DOCKER_INTERNAL) defaults.push('http://host.docker.internal:5000/translate');
    if (ENABLE_PUBLIC_LIBRETRANSLATE) defaults.push('https://libretranslate.com/translate');

    const merged = configured.length > 0 ? configured : defaults;
    return [...new Set(merged)];
};

const requestLibreTranslate = async (payload) => {
    if (Date.now() < libreUnavailableUntil) {
        const error = new Error('LibreTranslate is in cooldown window');
        error.code = 'LIBRE_COOLDOWN';
        throw error;
    }

    const urls = getLibreTranslateUrls();
    let lastError = null;

    for (const url of urls) {
        try {
            const requestPayload = { ...payload };
            if (TRANSLATE_API_KEY) requestPayload.api_key = TRANSLATE_API_KEY;

            const response = await axios.post(url, requestPayload, { timeout: REQUEST_TIMEOUT_MS });
            return response?.data?.translatedText || payload.q;
        } catch (error) {
            const errorMessage = error?.message || '';
            if (!errorMessage.includes('ENOTFOUND host.docker.internal')) {
                console.warn(`[translate] failed ${url}: ${errorMessage}`);
            }
            lastError = error;
        }
    }

    libreUnavailableUntil = Date.now() + FAIL_COOLDOWN_MS;
    console.warn(`[translate] entering cooldown for ${FAIL_COOLDOWN_MS}ms`);
    throw lastError;
};

router.post('/', async (req, res) => {
    const { q, source, target, format } = req.body || {};

    if (!q || !target) {
        return res.status(400).json({ error: 'Missing required fields.' });
    }

    try {
        const sourceLang = source || 'ko';
        const outputFormat = format || 'text';

        if (TRANSLATE_PROVIDER === 'google') {
            if (!TRANSLATE_API_KEY) {
                return res.status(500).json({ error: 'Missing Google Translate API key.' });
            }

            const response = await axios.post(
                'https://translation.googleapis.com/language/translate/v2',
                {
                    q,
                    source: sourceLang,
                    target,
                    format: outputFormat,
                },
                {
                    params: { key: TRANSLATE_API_KEY },
                    timeout: 8000,
                },
            );

            return res.json({
                translatedText: response?.data?.data?.translations?.[0]?.translatedText || q,
            });
        }

        const translatedText = await requestLibreTranslate({
            q,
            source: sourceLang,
            target,
            format: outputFormat,
        });

        return res.json({ translatedText });
    } catch (error) {
        if (error?.code === 'LIBRE_COOLDOWN') {
            return res.json({ translatedText: q, fallback: true });
        }

        console.error('[translate]', error?.response?.data || error.message);
        return res.json({ translatedText: q, fallback: true });
    }
});

module.exports = router;
