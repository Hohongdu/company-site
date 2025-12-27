require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');

const db = require('./db');
const { ensureUserCartId, getGuestCart } = require('./lib/cart');

const companyRouter = require('./routes/company');
const authRouter = require('./routes/auth');
const shopRouter = require('./routes/shop');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
	session({
		secret: process.env.SESSION_SECRET || 'change_me_in_env',
		resave: false,
		saveUninitialized: false,
		cookie: { maxAge: 1000 * 60 * 60 },
	})
);

// locals
app.use((req, res, next) => {
	res.locals.currentPath = req.path;
	res.locals.user = req.session.user || null;
	next();
});

// cartCount 배지 계산(공통)
app.use(async (req, res, next) => {
	try {
		res.locals.cartCount = 0;

		if (req.session.user) {
			const cartId = await ensureUserCartId(req.session.user.id);
			const [rows] = await db.execute('SELECT COALESCE(SUM(quantity),0) AS cnt FROM cart_items WHERE cart_id = ?', [cartId]);
			res.locals.cartCount = Number(rows[0]?.cnt || 0);
			return next();
		}

		const items = getGuestCart(req).items || {};
		res.locals.cartCount = Object.values(items).reduce((s, v) => s + (Number(v) || 0), 0);

		return next();
	} catch (err) {
		console.error(err);
		return next();
	}
});

// view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 라우터 연결
app.use('/', companyRouter);
app.use('/auth', authRouter);
app.use('/shop', shopRouter);
app.use('/admin', adminRouter);

// 404
app.use((req, res) => {
	res.status(404).render('404', { message: '페이지를 찾을 수 없습니다.' });
});

app.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}`);
});
