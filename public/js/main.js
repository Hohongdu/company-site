(function () {
	const yearSpan = document.getElementById('year');
	if (yearSpan) yearSpan.textContent = new Date().getFullYear();

	const supportedLanguages = [
		{ code: 'ko', label: '한국어', emoji: '🇰🇷' },
		{ code: 'en', label: 'English', emoji: '🇺🇸' },
		{ code: 'ja', label: '日本語', emoji: '🇯🇵' },
		{ code: 'zh-CN', label: '中文(简体)', emoji: '🇨🇳' },
	];

	const storageLangKey = 'site_lang';
	const storageCacheKey = 'site_i18n_cache_v1';
	const storageDebugKey = 'i18n_debug';
	const i18nLogs = [];
	let logListEl = null;
	let translationTemporarilyBlocked = false;

	function debugEnabled() {
		return localStorage.getItem(storageDebugKey) === '1' || new URLSearchParams(window.location.search).get('i18nDebug') === '1';
	}

	function appendLog(message, payload) {
		const entry = {
			ts: new Date().toISOString(),
			message,
			payload: payload || null,
		};
		i18nLogs.push(entry);
		if (i18nLogs.length > 200) i18nLogs.shift();
		window.__I18N_LOGS = i18nLogs;

		if (debugEnabled()) {
			console.log('[i18n]', message, payload || '');
		}

		if (logListEl) {
			const li = document.createElement('li');
			li.className = 'i18n-log-item';
			li.textContent = `${entry.ts} | ${entry.message}${entry.payload ? ` | ${JSON.stringify(entry.payload)}` : ''}`;
			logListEl.prepend(li);
		}
	}

	function getCachedMap() {
		try {
			return JSON.parse(localStorage.getItem(storageCacheKey) || '{}');
		} catch (err) {
			appendLog('cache parse error', { message: err.message });
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
		const requestId = `i18n-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
		appendLog('translate request', { requestId, target, textPreview: text.slice(0, 40) });

		const response = await fetch('/api/translate', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-I18N-Request-Id': requestId,
			},
			body: JSON.stringify({ text, source: 'auto', target }),
		});

		const data = await response.json().catch(() => null);
		if (!response.ok || !data?.ok) {
			if (response.status >= 500 || response.status === 403 || response.status === 502) {
				translationTemporarilyBlocked = true;
			}
			appendLog('translate failed', {
				requestId,
				status: response.status,
				message: data?.message || 'response not ok',
			});
			throw new Error(data?.message || `번역 API 호출 실패(status=${response.status})`);
		}

		appendLog('translate success', { requestId, target, sourceLang: data.sourceLang });
		return data.translatedText;
	}

	function ensureSourceText(el, attrName) {
		const attr = el.getAttribute(attrName);
		if (attr) return attr;

		const fallback = attrName === 'data-i18n-placeholder-ko' ? el.getAttribute('placeholder') || '' : el.innerHTML;
		if (fallback) el.setAttribute(attrName, fallback);
		return fallback;
	}

	function autoTextCandidates() {
		return Array.from(document.querySelectorAll('[data-i18n-auto]')).map((el) => {
			const src = el.getAttribute('data-i18n-auto-ko') || el.textContent.trim();
			if (src && !el.getAttribute('data-i18n-auto-ko')) {
				el.setAttribute('data-i18n-auto-ko', src);
			}
			return { el, src };
		});
	}

	async function applyLanguage(lang) {
		document.documentElement.setAttribute('lang', lang);
		localStorage.setItem(storageLangKey, lang);
		appendLog('apply language', { lang, path: location.pathname });

		const textEls = Array.from(document.querySelectorAll('[data-i18n]'));
		const htmlEls = Array.from(document.querySelectorAll('[data-i18n-html]'));
		const placeholderEls = Array.from(document.querySelectorAll('[data-i18n-placeholder]'));
		const autoEls = autoTextCandidates();

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
			autoEls.forEach(({ el, src }) => {
				if (src) el.textContent = src;
			});
			appendLog('apply done', { lang, count: textEls.length + htmlEls.length + placeholderEls.length + autoEls.length });
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
		autoEls.forEach(({ el, src }) => {
			if (src) jobs.push({ type: 'auto', el, src });
		});

		for (const job of jobs) {
			if (translationTemporarilyBlocked) {
				appendLog('translation paused', { reason: 'auth or provider error', lang });
				break;
			}
			try {
				const cached = getCachedValue(lang, job.src);
				const translated = cached || (await translateByPapago(job.src, lang));
				if (!cached) setCachedValue(lang, job.src, translated);

				if (job.type === 'text') job.el.textContent = translated;
				if (job.type === 'html') job.el.innerHTML = translated;
				if (job.type === 'placeholder') job.el.setAttribute('placeholder', translated);
				if (job.type === 'auto') job.el.textContent = translated;
			} catch (err) {
				appendLog('job failed', { type: job.type, srcPreview: job.src.slice(0, 30), error: err.message });
			}
		}

		appendLog('apply done', { lang, count: jobs.length });
	}

	function createI18nLogPanel() {
		const panel = document.createElement('div');
		panel.className = 'i18n-log-panel';
		panel.hidden = true;
		panel.innerHTML = `
			<div class="i18n-log-header">
				<strong>I18N LOG</strong>
				<div>
					<button type="button" class="i18n-log-clear">clear</button>
					<button type="button" class="i18n-log-close">×</button>
				</div>
			</div>
			<ul class="i18n-log-list"></ul>
		`;
		document.body.appendChild(panel);
		logListEl = panel.querySelector('.i18n-log-list');

		panel.querySelector('.i18n-log-close').addEventListener('click', () => {
			panel.hidden = true;
		});
		panel.querySelector('.i18n-log-clear').addEventListener('click', () => {
			i18nLogs.length = 0;
			window.__I18N_LOGS = i18nLogs;
			logListEl.innerHTML = '';
		});

		return panel;
	}

	function createLanguageWidget() {
		const root = document.createElement('div');
		root.className = 'lang-widget';
		root.id = 'langWidget';
		root.style.position = 'fixed';
		root.style.right = '16px';
		root.style.bottom = '20px';
		root.style.zIndex = '2147483647';
		root.innerHTML = `
			<div class="lang-actions">
				<button class="lang-toggle" type="button" aria-label="언어 선택">🌐</button>
				<button class="lang-log-toggle" type="button" aria-label="번역 로그">🧾</button>
			</div>
			<div class="lang-menu" hidden></div>
		`;
		document.body.appendChild(root);

		const logPanel = createI18nLogPanel();
		const btn = root.querySelector('.lang-toggle');
		const logBtn = root.querySelector('.lang-log-toggle');
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

		logBtn.addEventListener('click', () => {
			logPanel.hidden = !logPanel.hidden;
		});

		document.addEventListener('click', (event) => {
			if (!root.contains(event.target) && !logPanel.contains(event.target)) {
				menu.hidden = true;
			}
		});
	}

	if (document.body) {
		createLanguageWidget();
		const defaultLang = localStorage.getItem(storageLangKey) || 'ko';
		applyLanguage(defaultLang).catch((err) => appendLog('init failed', { error: err.message }));
	}
})();
