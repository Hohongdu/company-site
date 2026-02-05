const express = require('express');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

router.get('/', (req, res) => res.render('company/index'));
router.get('/about', (req, res) => res.render('company/about'));
router.get('/history', (req, res) => res.render('company/history'));
router.get('/notices', (req, res) => res.render('company/notices'));
router.get('/contact', (req, res) => res.render('company/contact'));

router.get('/account', requireLogin, (req, res) =>
	res.render('company/account', { user: req.session.user }),
);

module.exports = router;
