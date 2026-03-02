(function () {
	const openBtn = document.getElementById('adminSidebarOpen');
	const closeBtn = document.getElementById('adminSidebarClose');
	const sidebar = document.getElementById('adminSidebar');
	const backdrop = document.getElementById('adminSidebarBackdrop');

	if (!sidebar || !backdrop) return;

	const open = () => {
		sidebar.classList.add('is-open');
		backdrop.classList.add('is-open');
		document.body.classList.add('admin-sidebar-open');
	};

	const close = () => {
		sidebar.classList.remove('is-open');
		backdrop.classList.remove('is-open');
		document.body.classList.remove('admin-sidebar-open');
	};

	openBtn?.addEventListener('click', open);
	closeBtn?.addEventListener('click', close);
	backdrop.addEventListener('click', close);

	sidebar.querySelectorAll('a').forEach((link) => {
		link.addEventListener('click', () => {
			if (window.matchMedia('(max-width: 991.98px)').matches) close();
		});
	});

	window.addEventListener('resize', () => {
		if (!window.matchMedia('(max-width: 991.98px)').matches) close();
	});
})();
