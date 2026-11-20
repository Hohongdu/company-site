(function () {
	const $ = (sel, el = document) => el.querySelector(sel);
	const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

	const businessNav = $('.site-nav__has-drop');
	if (businessNav) {
		const toggle = $('.site-nav__drop-toggle', businessNav);
		const panel = document.getElementById(toggle.getAttribute('aria-controls'));
		let closeTimer;
		let pinned = false;

		const setOpen = (open) => {
			clearTimeout(closeTimer);
			panel.hidden = !open;
			toggle.setAttribute('aria-expanded', String(open));
			businessNav.classList.toggle('is-open', open);
			if (!open) pinned = false;
		};

		businessNav.addEventListener('pointerenter', (event) => {
			if (event.pointerType === 'mouse') setOpen(true);
		});
		businessNav.addEventListener('pointerleave', (event) => {
			if (event.pointerType !== 'mouse' || pinned) return;
			closeTimer = setTimeout(() => {
				if (!panel.contains(document.activeElement)) setOpen(false);
			}, 240);
		});
		toggle.addEventListener('click', () => {
			pinned = !pinned;
			setOpen(pinned);
		});
		businessNav.addEventListener('focusout', (event) => {
			if (!businessNav.contains(event.relatedTarget) && !businessNav.matches(':hover')) setOpen(false);
		});
		panel.addEventListener('click', (event) => {
			if (event.target.closest('a')) setOpen(false);
		});
		document.addEventListener('pointerdown', (event) => {
			if (!businessNav.contains(event.target)) setOpen(false);
		});
		document.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape' || panel.hidden) return;
			if (panel.contains(document.activeElement)) toggle.focus();
			setOpen(false);
		});
		window.matchMedia('(max-width: 991px)').addEventListener('change', () => setOpen(false));
		toggle.hidden = false;
	}

	// Drawer
	const drawer = $('#drawer');
	const drawerBackdrop = $('#drawerBackdrop');
	const btnOpen = $('#btnDrawerOpen');
	const btnClose = $('#btnDrawerClose');
	const openDrawer = () => {
		drawer?.classList.add('open');
		drawerBackdrop?.classList.add('open');
	};
	const closeDrawer = () => {
		drawer?.classList.remove('open');
		drawerBackdrop?.classList.remove('open');
	};
	btnOpen?.addEventListener('click', openDrawer);
	btnClose?.addEventListener('click', closeDrawer);
	drawerBackdrop?.addEventListener('click', closeDrawer);
	$$('.drawer-item').forEach((a) => a.addEventListener('click', closeDrawer));

	// Login modal
	const modal = $('#loginModal');
	const modalBackdrop = $('#loginBackdrop');
	const openLogin = () => {
		modal?.classList.add('open');
		modalBackdrop?.classList.add('open');
		closeDrawer();
	};
	const closeLogin = () => {
		modal?.classList.remove('open');
		modalBackdrop?.classList.remove('open');
	};
	$$('.js-open-login').forEach((el) =>
		el.addEventListener('click', (e) => {
			e.preventDefault();
			openLogin();
		}),
	);
	$('#btnLoginClose')?.addEventListener('click', closeLogin);
	modalBackdrop?.addEventListener('click', closeLogin);
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			closeDrawer();
			closeLogin();
		}
	});

	// Slider (simple)
	const slides = $$('.em-slide');
	const dots = $$('.em-dot');
	let idx = 0;
	const show = (i) => {
		idx = (i + slides.length) % slides.length;
		slides.forEach((s, k) => s.classList.toggle('active', k === idx));
		dots.forEach((d, k) => d.classList.toggle('active', k === idx));
	};
	dots.forEach((d, k) => d.addEventListener('click', () => show(k)));
	if (slides.length) {
		show(0);
		setInterval(() => show(idx + 1), 6500);
	}
})();
