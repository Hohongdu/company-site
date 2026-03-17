(function () {
	const $ = (sel, el = document) => el.querySelector(sel);
	const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

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
