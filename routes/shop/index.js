const express = require('express');
const router = express.Router();

router.use('/', require('./store'));    // main shop pages (index, products, product-detail)
router.use('/', require('./cart'));     // cart operations
router.use('/', require('./checkout')); // checkout/payment
router.use('/', require('./orders'));   // order lookup
router.use('/', require('./account'));  // user account
router.use('/', require('./inquiry'));  // inquiry

module.exports = router;
