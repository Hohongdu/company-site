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

// [H-7] TC0ONETIME 경고: 서버 시작 시 1회만 출력 (요청마다 반복 금지)
// TC0ONETIME은 카카오페이 테스트 CID — 실결제 불가, 운영 환경에서 사용 금지
let _configChecked = false;
function isConfigured() {
	const { adminKey, cid } = getKakaoPayConfig();

	// [L-2] isConfigured()는 카트 조회마다 호출됨 → console.log 제거 (admin key 앞 6자 반복 노출 방지)
	if (!_configChecked) {
		_configChecked = true;
		if (!adminKey) {
			console.warn('[KakaoPay] KAKAO_ADMIN_KEY가 설정되지 않았습니다. 결제 기능이 비활성화됩니다.');
		}
		if (cid === 'TC0ONETIME') {
			console.warn('[KakaoPay][경고] KAKAO_CID가 테스트 CID(TC0ONETIME)입니다. 운영 환경에서는 실제 CID를 .env에 설정하세요.');
		}
	}
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

	try {
		const response = await axios.post(`${KAKAOPAY_HOST}/v1/payment/ready`, payload.toString(), {
			headers: {
				'Authorization': `KakaoAK ${adminKey}`,
				'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
			},
		});
		return response.data;
	} catch (err) {
		const detail = err.response?.data;
		const msg = detail?.msg || detail?.message || err.message;
		console.error('[KakaoPay] ready() 실패:', msg, detail || '');
		const error = new Error(`카카오페이 결제 준비 실패: ${msg || '알 수 없는 오류'}`);
		error.kakaoDetail = detail;
		throw error;
	}
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

	try {
		const response = await axios.post(`${KAKAOPAY_HOST}/v1/payment/approve`, payload.toString(), {
			headers: {
				'Authorization': `KakaoAK ${adminKey}`,
				'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
			},
		});
		return response.data;
	} catch (err) {
		const detail = err.response?.data;
		const msg = detail?.msg || detail?.message || err.message;
		console.error('[KakaoPay] approve() 실패:', msg, detail || '');
		const error = new Error(`카카오페이 결제 승인 실패: ${msg || '알 수 없는 오류'}`);
		error.kakaoDetail = detail;
		throw error;
	}
}

module.exports = {
	isConfigured,
	ready,
	approve,
};
