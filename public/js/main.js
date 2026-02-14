(function () {
	const yearSpan = document.getElementById('year');
	if (yearSpan) {
		yearSpan.textContent = new Date().getFullYear();
	}

	const supportedLanguages = [
		{ code: 'ko', label: '한국어', emoji: '🇰🇷' },
		{ code: 'en', label: 'English', emoji: '🇺🇸' },
		{ code: 'ja', label: '日本語', emoji: '🇯🇵' },
		{ code: 'zh-CN', label: '中文(简体)', emoji: '🇨🇳' },
	];

	const storageLangKey = 'site_lang';
	const storageCacheKey = 'site_i18n_cache_v1';

	function getCachedMap() {
		try {
			return JSON.parse(localStorage.getItem(storageCacheKey) || '{}');
		} catch (_) {
			return {};
		}
	}

	function setCachedValue(lang, sourceText, translated) {
		const map = getCachedMap();
		map[`${lang}::${sourceText}`] = translated;
		localStorage.setItem(storageCacheKey, JSON.stringify(map));
	}

	function getCachedValue(lang, sourceText) {
		const map = getCachedMap();
		return map[`${lang}::${sourceText}`] || null;
	}

	async function translateByPapago(text, target) {
		const response = await fetch('/api/translate', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				text,
				source: 'ko',
				target,
			}),
		});

		const data = await response.json();
		if (!response.ok || !data.ok) {
			throw new Error(data?.message || '번역 API 호출 실패');
		}
		return data.translatedText;
	}

	function ensureSourceText(el, attrName) {
		const attr = el.getAttribute(attrName);
		if (attr) return attr;
		const fallback = attrName === 'data-i18n-placeholder-ko' ? el.getAttribute('placeholder') || '' : el.innerHTML;
		if (fallback) el.setAttribute(attrName, fallback);
		return fallback;
	}

	async function applyLanguage(lang) {
		document.documentElement.setAttribute('lang', lang);
		localStorage.setItem(storageLangKey, lang);

		const textEls = Array.from(document.querySelectorAll('[data-i18n]'));
		const htmlEls = Array.from(document.querySelectorAll('[data-i18n-html]'));
		const placeholderEls = Array.from(document.querySelectorAll('[data-i18n-placeholder]'));

		if (lang === 'ko') {
			textEls.forEach((el) => {
				const src = ensureSourceText(el, 'data-i18n-ko');
				if (src) el.textContent = src;
			});
			htmlEls.forEach((el) => {
				const src = ensureSourceText(el, 'data-i18n-html-ko');
				if (src) el.innerHTML = src;
			});
			placeholderEls.forEach((el) => {
				const src = ensureSourceText(el, 'data-i18n-placeholder-ko');
				if (src) el.setAttribute('placeholder', src);
			});
			return;
		}

		const jobs = [];
		textEls.forEach((el) => {
			const src = ensureSourceText(el, 'data-i18n-ko');
			if (src) jobs.push({ type: 'text', el, src });
		});
		htmlEls.forEach((el) => {
			const src = ensureSourceText(el, 'data-i18n-html-ko');
			if (src) jobs.push({ type: 'html', el, src });
		});
		placeholderEls.forEach((el) => {
			const src = ensureSourceText(el, 'data-i18n-placeholder-ko');
			if (src) jobs.push({ type: 'placeholder', el, src });
		});

		for (const job of jobs) {
			try {
				const cached = getCachedValue(lang, job.src);
				const translated = cached || (await translateByPapago(job.src, lang));
				if (!cached) setCachedValue(lang, job.src, translated);

				if (job.type === 'text') job.el.textContent = translated;
				if (job.type === 'html') job.el.innerHTML = translated;
				if (job.type === 'placeholder') job.el.setAttribute('placeholder', translated);
			} catch (err) {
				console.error('[i18n] translation failed:', err);
			}
		}
	}

	function createLanguageWidget() {
		const root = document.createElement('div');
		root.className = 'lang-widget';
		root.innerHTML = `
			<button class="lang-toggle" type="button" aria-label="언어 선택">🌐</button>
			<div class="lang-menu" hidden></div>
		`;
		document.body.appendChild(root);

		const btn = root.querySelector('.lang-toggle');
		const menu = root.querySelector('.lang-menu');

		supportedLanguages.forEach((item) => {
			const option = document.createElement('button');
			option.type = 'button';
			option.className = 'lang-option';
			option.textContent = `${item.emoji} ${item.label}`;
			option.dataset.lang = item.code;
			option.addEventListener('click', async () => {
				menu.hidden = true;
				await applyLanguage(item.code);
			});
			menu.appendChild(option);
		});

		btn.addEventListener('click', () => {
			menu.hidden = !menu.hidden;
		});

		document.addEventListener('click', (event) => {
			if (!root.contains(event.target)) {
				menu.hidden = true;
			}
		});
	}

	if (document.body) {
		createLanguageWidget();
		const defaultLang = localStorage.getItem(storageLangKey) || 'ko';
		applyLanguage(defaultLang).catch((err) => console.error('[i18n] init failed:', err));
	}
})();
