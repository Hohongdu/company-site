const express = require('express');
const axios = require('axios');

const router = express.Router();

const TRANSLATE_PROVIDER = process.env.TRANSLATE_PROVIDER || 'libre';
const TRANSLATE_API_KEY = process.env.TRANSLATE_API_KEY;
const DEFAULT_LIBRE_URLS = [
    'http://libretranslate:5000/translate',
    'http://host.docker.internal:5000/translate',
    'http://localhost:5000/translate',
    'https://libretranslate.com/translate',
];

const getLibreTranslateUrls = () => {
    const raw = process.env.TRANSLATE_API_URL;
    if (!raw || !raw.trim()) return DEFAULT_LIBRE_URLS;

    return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
};

const requestLibreTranslate = async (payload) => {
    const urls = getLibreTranslateUrls();
    let lastError = null;

    for (const url of urls) {
        try {
            const requestPayload = { ...payload };
            if (TRANSLATE_API_KEY) requestPayload.api_key = TRANSLATE_API_KEY;

            const response = await axios.post(url, requestPayload, { timeout: 8000 });
            return response?.data?.translatedText || payload.q;
        } catch (error) {
            lastError = error;
        }
    }

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
        console.error('[translate]', error?.response?.data || error.message);
        return res.status(502).json({ error: 'Translation service unavailable.' });
    }
});

module.exports = router;
