(() => {
    const LANG_STORAGE_KEY = 'site_lang';
    const toDatasetKey = (prefix, lang) => {
        const normalized = lang.charAt(0).toUpperCase() + lang.slice(1);
        return `${prefix}${normalized}`;
    };

    const applyLanguage = (lang) => {
        document.querySelectorAll('[data-i18n]').forEach((el) => {
            const key = toDatasetKey('i18n', lang);
            const fallback = el.dataset.i18nKo;
            const value = el.dataset[key] || fallback;
            if (value) el.textContent = value;
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
            const key = toDatasetKey('i18nPlaceholder', lang);
            const fallback = el.dataset.i18nPlaceholderKo;
            const value = el.dataset[key] || fallback;
            if (value) el.setAttribute('placeholder', value);
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
