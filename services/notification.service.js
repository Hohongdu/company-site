const DISABLED_RESULT = {
	ok: false,
	status: 'DISABLED',
	error: '이메일 전송 기능이 비활성화되었습니다.',
	provider: 'NONE',
};

async function disabledEmailResult(type, payload = {}) {
	return {
		...DISABLED_RESULT,
		type,
		meta: {
			to: payload.to || null,
			subject: payload.subject || null,
		},
	};
}

exports.sendInquiryReplyEmail = async (payload) => disabledEmailResult('INQUIRY_REPLY', payload);

exports.sendFileTransferEmail = async (payload) => disabledEmailResult('FILE_TRANSFER', payload);

exports.sendTemporaryPasswordEmail = async (payload) => disabledEmailResult('TEMP_PASSWORD', payload);
