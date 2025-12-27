const express = require('express');
const router = express.Router();

router.get('/', (req, res) => res.render('company/index'));
router.get('/about', (req, res) => res.render('company/about'));
router.get('/contact', (req, res) => res.render('company/contact'));

module.exports = router;
