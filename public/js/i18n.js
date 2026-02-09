(() => {
    const LANG_STORAGE_KEY = 'site_lang';
    const AUTO_TRANSLATE_ENABLED =
        typeof window !== 'undefined'
            ? window.AUTO_TRANSLATE_ENABLED !== false
            : true;
    const TRANSLATE_API_ENDPOINT =
        typeof window !== 'undefined' && window.TRANSLATE_API_ENDPOINT
            ? window.TRANSLATE_API_ENDPOINT
            : '/api/translate';
    const AUTO_TRANSLATE_CACHE_PREFIX = 'i18n_auto';
    const pendingTranslations = new Map();
    const toDatasetKey = (prefix, lang) => {
        const normalized = lang.charAt(0).toUpperCase() + lang.slice(1);
        return `${prefix}${normalized}`;
    };

    const getSourceLang = () => {
        if (typeof document === 'undefined') return 'ko';
        return document.documentElement.getAttribute('data-i18n-source') || 'ko';
    };

    const hashString = (value) => {
        let hash = 5381;
        for (let i = 0; i < value.length; i += 1) {
            hash = (hash * 33) ^ value.charCodeAt(i);
        }
        return (hash >>> 0).toString(16);
    };

    const getCacheKey = (lang, text) => {
        const hash = hashString(`${lang}:${text}`);
        return `${AUTO_TRANSLATE_CACHE_PREFIX}:${lang}:${hash}`;
    };

    const readCachedTranslation = (lang, text) => {
        if (typeof localStorage === 'undefined') return null;
        const cacheKey = getCacheKey(lang, text);
        return localStorage.getItem(cacheKey);
    };

    const writeCachedTranslation = (lang, text, translated) => {
        if (typeof localStorage === 'undefined') return;
        const cacheKey = getCacheKey(lang, text);
        localStorage.setItem(cacheKey, translated);
    };

    const normalizeHtmlToText = (html) =>
        html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');

    const normalizeTextToHtml = (text) => text.replace(/\n/g, '<br />');

    const translateText = async (text, targetLang) => {
        if (!AUTO_TRANSLATE_ENABLED) return text;
        const sourceLang = getSourceLang();
        if (!text || targetLang === sourceLang) return text;

        const cached = readCachedTranslation(targetLang, text);
        if (cached) return cached;

        const pendingKey = `${targetLang}:${text}`;
        if (pendingTranslations.has(pendingKey)) {
            return pendingTranslations.get(pendingKey);
        }

        const requestPromise = fetch(TRANSLATE_API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                q: text,
                source: sourceLang,
                target: targetLang,
                format: 'text',
            }),
        })
            .then((response) => response.json())
            .then((data) => {
                const translated = data?.translatedText || text;
                writeCachedTranslation(targetLang, text, translated);
                return translated;
            })
            .catch(() => text)
            .finally(() => {
                pendingTranslations.delete(pendingKey);
            });

        pendingTranslations.set(pendingKey, requestPromise);
        return requestPromise;
    };

    const scheduleAutoTranslation = (options) => {
        const { el, lang, fallback, type } = options;
        if (!fallback) return;

        const activeLang = document.documentElement.getAttribute('data-i18n-active');
        if (activeLang !== lang) return;

        const sourceText = type === 'html' ? normalizeHtmlToText(fallback) : fallback;
        translateText(sourceText, lang).then((translated) => {
            const latestLang = document.documentElement.getAttribute('data-i18n-active');
            if (latestLang !== lang) return;
            if (!translated) return;
            if (type === 'text') el.textContent = translated;
            if (type === 'html') el.innerHTML = normalizeTextToHtml(translated);
            if (type === 'placeholder') el.setAttribute('placeholder', translated);
        });
    };

    const applyLanguage = (lang) => {
        document.documentElement.setAttribute('data-i18n-active', lang);
        document.querySelectorAll('[data-i18n]').forEach((el) => {
            const key = toDatasetKey('i18n', lang);
            const fallback = el.dataset.i18nKo;
            const value = el.dataset[key] || fallback;
            if (value) el.textContent = value;
            if (!el.dataset[key]) {
                scheduleAutoTranslation({ el, lang, fallback, type: 'text' });
            }
        });

        document.querySelectorAll('[data-i18n-html]').forEach((el) => {
            const key = toDatasetKey('i18nHtml', lang);
            const fallback = el.dataset.i18nHtmlKo;
            const value = el.dataset[key] || fallback;
            if (value) el.innerHTML = value;
            if (!el.dataset[key]) {
                scheduleAutoTranslation({ el, lang, fallback, type: 'html' });
            }
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
            const key = toDatasetKey('i18nPlaceholder', lang);
            const fallback = el.dataset.i18nPlaceholderKo;
            const value = el.dataset[key] || fallback;
            if (value) el.setAttribute('placeholder', value);
            if (!el.dataset[key]) {
                scheduleAutoTranslation({ el, lang, fallback, type: 'placeholder' });
            }
        });

        document.querySelectorAll('[data-lang-switch]').forEach((btn) => {
            const active = btn.getAttribute('data-lang-switch') === lang;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', String(active));
        });

        document.documentElement.lang = lang || 'ko';
    };

    const initLanguageSwitch = () => {
        const stored = localStorage.getItem(LANG_STORAGE_KEY);
        const initial = stored || 'ko';
        applyLanguage(initial);

        document.querySelectorAll('[data-lang-switch]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const lang = btn.getAttribute('data-lang-switch') || 'ko';
                localStorage.setItem(LANG_STORAGE_KEY, lang);
                applyLanguage(lang);
            });
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLanguageSwitch);
    } else {
        initLanguageSwitch();
    }
})();
