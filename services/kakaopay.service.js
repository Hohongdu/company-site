const axios = require('axios');

const KAKAOPAY_HOST = 'https://kapi.kakao.com';

function getKakaoPayConfig() {
	const adminKey = process.env.KAKAO_ADMIN_KEY || process.env.KAKAOPAY_ADMIN_KEY || process.env.KAKAO_PAY_ADMIN_KEY || '';
	const cid = process.env.KAKAO_CID || process.env.KAKAOPAY_CID || process.env.KAKAO_PAY_CID || 'TC0ONETIME';

	return {
		adminKey,
		cid,
	};
}

function isConfigured() {
	const { adminKey, cid } = getKakaoPayConfig();
	return Boolean(adminKey && cid);
}

async function ready({ orderId, userId, itemName, quantity, totalAmount, approvalUrl, cancelUrl, failUrl }) {
	const { adminKey, cid } = getKakaoPayConfig();

	const payload = new URLSearchParams({
		cid,
		partner_order_id: orderId,
		partner_user_id: String(userId || 'guest'),
		item_name: itemName,
		quantity: String(quantity),
		total_amount: String(totalAmount),
		tax_free_amount: '0',
		approval_url: approvalUrl,
		cancel_url: cancelUrl,
		fail_url: failUrl,
	});

	const response = await axios.post(`${KAKAOPAY_HOST}/v1/payment/ready`, payload.toString(), {
		headers: {
			Authorization: `KakaoAK ${adminKey}`,
			'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
		},
	});

	return response.data;
}

async function approve({ tid, orderId, userId, pgToken }) {
	const { adminKey, cid } = getKakaoPayConfig();

	const payload = new URLSearchParams({
		cid,
		tid,
		partner_order_id: orderId,
		partner_user_id: String(userId || 'guest'),
		pg_token: pgToken,
	});

	const response = await axios.post(`${KAKAOPAY_HOST}/v1/payment/approve`, payload.toString(), {
		headers: {
			Authorization: `KakaoAK ${adminKey}`,
			'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
		},
	});

	return response.data;
}

module.exports = {
	isConfigured,
	ready,
	approve,
};
