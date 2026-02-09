const express = require('express');
const axios = require('axios');

const router = express.Router();

const TRANSLATE_PROVIDER = process.env.TRANSLATE_PROVIDER || 'libre';
const TRANSLATE_API_URL = process.env.TRANSLATE_API_URL || 'https://libretranslate.com/translate';
const TRANSLATE_API_KEY = process.env.TRANSLATE_API_KEY;

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

        const payload = {
            q,
            source: sourceLang,
            target,
            format: outputFormat,
        };

        if (TRANSLATE_API_KEY) {
            payload.api_key = TRANSLATE_API_KEY;
        }

        const response = await axios.post(TRANSLATE_API_URL, payload, {
            timeout: 8000,
        });

        return res.json({
            translatedText: response?.data?.translatedText || q,
        });
    } catch (error) {
        console.error('[translate]', error?.response?.data || error.message);
        return res.status(502).json({ error: 'Translation service unavailable.' });
    }
});

module.exports = router;
