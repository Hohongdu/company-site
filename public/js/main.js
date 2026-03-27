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
	let lastBlockingError = null;

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
			// 인증 실패(401/403)만 전체 번역 차단 — 502/5xx는 개별 텍스트 문제일 수 있으므로 계속 진행
			if (response.status === 401 || response.status === 403) {
				translationTemporarilyBlocked = true;
				lastBlockingError = {
					status: response.status,
					message: data?.message || 'auth error',
				};
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

	// h1 > em, h2 > br 같이 인라인 전용 자식만 있는 경우 통 번역 허용
	const INLINE_TAGS = new Set(['EM','STRONG','SPAN','B','I','BR','A','MARK','SMALL','SUP','SUB','ABBR','CITE','WBR','S','U']);
	function hasOnlyInlineChildren(el) {
		return Array.from(el.children).every(ch => INLINE_TAGS.has(ch.tagName));
	}

	function autoTextCandidates() {
		// 1) 명시적으로 data-i18n-auto 태그된 요소
		const tagged = Array.from(document.querySelectorAll('[data-i18n-auto]')).map((el) => {
			const src = el.getAttribute('data-i18n-auto-ko') || el.textContent.trim();
			if (src && !el.getAttribute('data-i18n-auto-ko')) {
				el.setAttribute('data-i18n-auto-ko', src);
			}
			return { el, src };
		});

		// 2) <main> 내 정적 텍스트 요소 자동 감지 — 개별 뷰 파일 수정 없이 전 페이지 적용
		const mainEl = document.querySelector('main');
		if (!mainEl) return tagged;

		const taggedSet = new Set(tagged.map((t) => t.el));
		const autoScanned = [];

		// 안전하게 번역 가능한 정적 요소 선택자 (동적 데이터 제외)
		const STATIC_SELECTORS = [
			// 헤딩 (인라인 자식 포함 허용)
			'h1','h2','h3','h4','h5','h6',
			// 공통 레이아웃
			'.sec-label','.page-banner h1','.page-banner p',
			'label','legend','th',
			// 홈 hero 섹션
			'.hero__eyebrow','.hero__sub','.hero__stat-label','.hero__badge-label',
			// 홈 feature cards
			'.feat-card__title','.feat-card__desc',
			// 홈 partners / stats / why / faq
			'.partners-label','.stat-label',
			'.why-item__title','.why-item__desc',
			'.accordion-button','.accordion-body',
			// 홈 CTA / 공통 설명 텍스트
			'.cta-label','.txt-muted',
			// shop / account
			'.card-title','.acct-card__title',
			'.cart-summary-title','.sidebar-label',
			// CTA 버튼 (a.btn, button.btn) — <main> 내 정적 텍스트 버튼 번역
			'a.btn','button.btn',
			// 연혁 타임라인
			'.timeline-title','.timeline-desc',
			// 공지사항 필터 버튼
			'.notice-filter-btn',
			// 문의 연락처 정보
			'.contact-info-item__label','.contact-notice li',
			// 브레드크럼
			'.breadcrumb-item a','.breadcrumb-item.active',
		].join(',');

		mainEl.querySelectorAll(STATIC_SELECTORS).forEach((el) => {
			// 이미 처리됐거나 data-i18n-auto 부모 아래에 있으면 스킵
			if (taggedSet.has(el) || el.closest('[data-i18n-auto]')) return;
			// 블록 자식이 있으면 동적 컨텐츠로 간주해 스킵 (인라인 전용은 허용)
			if (el.children.length > 0 && !hasOnlyInlineChildren(el)) return;
			// 인라인 자식이 있는 경우 innerHTML 원본 저장 (한국어 복원 시 <em>, <br> 등 유지)
			if (el.children.length > 0 && !el.getAttribute('data-i18n-auto-html-ko')) {
				el.setAttribute('data-i18n-auto-html-ko', el.innerHTML);
			}
			const src = el.getAttribute('data-i18n-auto-ko') || el.textContent.trim();
			if (!src || src.length < 1) return;
			if (!el.getAttribute('data-i18n-auto-ko')) el.setAttribute('data-i18n-auto-ko', src);
			autoScanned.push({ el, src });
		});

		appendLog('autoScan', { tagged: tagged.length, scanned: autoScanned.length });
		return [...tagged, ...autoScanned];
	}

	async function applyLanguage(lang) {
		document.documentElement.setAttribute('lang', lang);
		localStorage.setItem(storageLangKey, lang);
		translationTemporarilyBlocked = false;
		lastBlockingError = null;
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
				// 인라인 자식 있던 요소는 innerHTML 원본으로 복원 (em, br 등 스타일 유지)
				const htmlKo = el.getAttribute('data-i18n-auto-html-ko');
				if (htmlKo) el.innerHTML = htmlKo;
				else if (src) el.textContent = src;
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
				appendLog('translation paused', {
					reason: 'auth or provider error',
					lang,
					lastError: lastBlockingError,
				});
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


	async function runStatusProbe() {
		appendLog('status probe request', {});
		try {
			const response = await fetch('/api/translate/status?probe=1');
			const data = await response.json().catch(() => null);
			appendLog('status probe result', {
				status: response.status,
				ok: Boolean(data?.ok),
				provider: data?.provider,
				message: data?.message,
			});
		} catch (err) {
			appendLog('status probe failed', { error: err.message });
		}
	}

	function createI18nLogPanel() {
		// 팝업 오버레이 방식 (footer 위에 뜨는 독립 창)
		const overlay = document.createElement('div');
		overlay.className = 'i18n-log-overlay';
		overlay.hidden = true;
		overlay.style.cssText = [
			'position:fixed', 'inset:0', 'z-index:2147483640',
			'background:rgba(0,0,0,.45)', 'display:flex',
			'align-items:center', 'justify-content:center',
			'padding:20px',
		].join(';');

		const panel = document.createElement('div');
		panel.className = 'i18n-log-panel';
		panel.style.cssText = [
			'background:#0f172a', 'color:#e2e8f0',
			'border-radius:12px', 'width:min(720px,95vw)',
			'max-height:80vh', 'display:flex', 'flex-direction:column',
			'box-shadow:0 20px 60px rgba(0,0,0,.5)',
			'overflow:hidden',
		].join(';');

		panel.innerHTML = `
			<div class="i18n-log-header" style="padding:14px 18px;border-bottom:1px solid #1e293b;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
				<strong style="font-size:13px;letter-spacing:.06em;color:#94a3b8;">🧾 I18N TRANSLATION LOG <span style="font-weight:400;font-size:11px;color:#475569;">(관리자 전용)</span></strong>
				<div style="display:flex;gap:8px;">
					<button type="button" class="i18n-log-probe" style="background:#1e40af;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;">probe</button>
					<button type="button" class="i18n-log-clear" style="background:#374151;color:#d1d5db;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;">clear</button>
					<button type="button" class="i18n-log-close" style="background:#dc2626;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;">✕ 닫기</button>
				</div>
			</div>
			<ul class="i18n-log-list" style="list-style:none;margin:0;padding:12px;overflow-y:auto;flex:1;font-size:11px;font-family:monospace;line-height:1.6;"></ul>
		`;

		overlay.appendChild(panel);
		document.body.appendChild(overlay);
		logListEl = panel.querySelector('.i18n-log-list');

		panel.querySelector('.i18n-log-close').addEventListener('click', () => {
			overlay.hidden = true;
		});
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) overlay.hidden = true;
		});
		panel.querySelector('.i18n-log-probe').addEventListener('click', runStatusProbe);
		panel.querySelector('.i18n-log-clear').addEventListener('click', () => {
			i18nLogs.length = 0;
			window.__I18N_LOGS = i18nLogs;
			logListEl.innerHTML = '';
		});

		// li 스타일 주입
		const style = document.createElement('style');
		style.textContent = `.i18n-log-item{padding:3px 6px;border-bottom:1px solid #1e293b;color:#94a3b8;} .i18n-log-item:last-child{border-bottom:none;}`;
		document.head.appendChild(style);

		// overlay.hidden을 toggle하도록 panel 참조 반환
		overlay._panel = panel;
		return overlay;
	}

	function isAdminUser() {
		// EJS layouts inject window.__SITE_USER_IS_ADMIN = true/false
		return Boolean(window.__SITE_USER_IS_ADMIN);
	}

	function createLanguageWidget() {
		const root = document.createElement('div');
		root.className = 'lang-widget';
		root.id = 'langWidget';

		const showLog = isAdminUser();
		root.innerHTML = `
			<div class="lang-trigger">
				<button class="lang-toggle" type="button" aria-expanded="false" aria-haspopup="listbox">
					<span class="lang-flag">🌐</span>
					<span class="lang-label">언어</span>
					<svg class="lang-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</button>
				${showLog ? '<button class="lang-log-btn" type="button" title="번역 로그"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 3v5h5M9 12h6M9 16h6" stroke-linecap="round"/></svg></button>' : ''}
			</div>
			<div class="lang-menu" role="listbox" hidden></div>
		`;
		document.body.appendChild(root);

		const logPanel = showLog ? createI18nLogPanel() : null;
		const btn = root.querySelector('.lang-toggle');
		const logBtn = root.querySelector('.lang-log-btn');
		const menu = root.querySelector('.lang-menu');

		function updateLabel(lang) {
			const item = supportedLanguages.find((l) => l.code === lang) || supportedLanguages[0];
			const flagEl = root.querySelector('.lang-flag');
			const labelEl = root.querySelector('.lang-label');
			if (flagEl) flagEl.textContent = item.emoji;
			if (labelEl) labelEl.textContent = item.label;
			root.querySelectorAll('.lang-option').forEach((opt) => {
				opt.classList.toggle('is-active', opt.dataset.lang === lang);
			});
		}

		supportedLanguages.forEach((item) => {
			const option = document.createElement('button');
			option.type = 'button';
			option.className = 'lang-option';
			option.role = 'option';
			option.dataset.lang = item.code;
			option.innerHTML = `<span class="lang-option__flag">${item.emoji}</span><span class="lang-option__label">${item.label}</span><svg class="lang-option__check" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
			option.addEventListener('click', async () => {
				menu.hidden = true;
				btn.setAttribute('aria-expanded', 'false');
				updateLabel(item.code);
				await applyLanguage(item.code);
			});
			menu.appendChild(option);
		});

		btn.addEventListener('click', () => {
			const isOpen = !menu.hidden;
			menu.hidden = isOpen;
			btn.setAttribute('aria-expanded', String(!isOpen));
		});

		if (logBtn && logPanel) {
			logBtn.addEventListener('click', () => {
				logPanel.hidden = !logPanel.hidden;
			});
		}

		document.addEventListener('click', (event) => {
			const isInLog = logPanel && !logPanel.hidden && logPanel.contains(event.target);
			if (!root.contains(event.target) && !isInLog) {
				menu.hidden = true;
				btn.setAttribute('aria-expanded', 'false');
			}
		});

		root._updateLabel = updateLabel;
	}

	const ICON_MOON = `<svg class="dark-toggle__svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
	const ICON_SUN  = `<svg class="dark-toggle__svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;

	function createDarkModeToggle() {
		const storageKey = 'site_theme';
		const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

		function applyTheme(dark) {
			if (dark) {
				document.documentElement.setAttribute('data-theme', 'dark');
			} else {
				document.documentElement.removeAttribute('data-theme');
			}
			localStorage.setItem(storageKey, dark ? 'dark' : 'light');
			const iconEl = root.querySelector('.dark-toggle__icon');
			const labelEl = root.querySelector('.dark-toggle__label');
			if (iconEl) iconEl.innerHTML = dark ? ICON_SUN : ICON_MOON;
			if (labelEl) labelEl.textContent = dark ? '라이트' : '다크';
		}

		const root = document.createElement('div');
		root.className = 'dark-widget';
		root.id = 'darkWidget';
		root.innerHTML = `
			<button class="dark-toggle" type="button" aria-label="다크 모드 토글">
				<span class="dark-toggle__icon">${ICON_MOON}</span>
				<span class="dark-toggle__label">다크</span>
			</button>
		`;
		document.body.appendChild(root);

		root.querySelector('.dark-toggle').addEventListener('click', () => {
			applyTheme(!isDark());
		});

		// Init from stored preference, fallback to system preference
		const stored = localStorage.getItem(storageKey);
		if (stored === 'dark') {
			applyTheme(true);
		} else if (stored === 'light') {
			applyTheme(false);
		} else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
			applyTheme(true);
		}
	}

	if (document.body) {
		createLanguageWidget();
		createDarkModeToggle();
		const defaultLang = localStorage.getItem(storageLangKey) || 'ko';
		const widget = document.getElementById('langWidget');
		if (widget && widget._updateLabel) widget._updateLabel(defaultLang);
		applyLanguage(defaultLang).catch((err) => appendLog('init failed', { error: err.message }));
	}
})();
