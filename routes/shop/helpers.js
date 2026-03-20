/**
 * helpers.js — shop 라우트 공유 헬퍼
 *
 * createOrderFromCart / fetchOrderDetailByNumber 로직은
 * services/order.service.js 로 이동되었습니다.
 * 기존 import 경로를 유지하기 위해 여기서 재-export 합니다.
 */
const { getCartViewData, clearCart } = require('../../lib/cart');
const { generateOrderNumber, createOrderFromCart, fetchOrderDetailByNumber } = require('../../services/order.service');

/**
 * 오류 응답 렌더 헬퍼
 */
const renderShopError = (res, message, status = 500, backHref = '/shop/account/orders') =>
	res.status(status).render('shop/error', {
		message,
		backHref,
	});

module.exports = { renderShopError, generateOrderNumber, createOrderFromCart, fetchOrderDetailByNumber };
