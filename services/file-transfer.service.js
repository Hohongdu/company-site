const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function b64url(input) {
	return Buffer.from(input).toString('base64url');
}

function fromB64url(input) {
	return Buffer.from(input, 'base64url').toString('utf8');
}

function createSignedToken(payload, secret) {
	const encodedPayload = b64url(JSON.stringify(payload));
	const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
	return `${encodedPayload}.${signature}`;
}

function verifySignedToken(token, secret) {
	const [encodedPayload, signature] = String(token || '').split('.');
	if (!encodedPayload || !signature) {
		const err = new Error('토큰 형식이 올바르지 않습니다.');
		err.status = 400;
		throw err;
	}

	const expected = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
	const sigBuf = Buffer.from(signature);
	const expBuf = Buffer.from(expected);
	if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
		const err = new Error('토큰 서명이 유효하지 않습니다.');
		err.status = 403;
		throw err;
	}

	const payload = JSON.parse(fromB64url(encodedPayload));
	if (!payload.exp || Date.now() > payload.exp) {
		const err = new Error('토큰이 만료되었습니다.');
		err.status = 410;
		throw err;
	}

	return payload;
}

function sanitizeFilename(name) {
	return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function createFileTransferService({ storageDir, tokenSecret }) {
	if (!tokenSecret) {
		throw new Error('FILE_TRANSFER_TOKEN_SECRET 설정이 필요합니다.');
	}

	async function ensureStorage() {
		await fs.mkdir(storageDir, { recursive: true });
	}

	async function saveFile({ fileBuffer, originalName, mimeType }) {
		await ensureStorage();
		const safeOriginal = sanitizeFilename(originalName);
		const ext = path.extname(safeOriginal).slice(0, 15);
		const fileId = `${crypto.randomUUID()}${ext}`;
		const absolutePath = path.join(storageDir, fileId);
		await fs.writeFile(absolutePath, fileBuffer);
		return {
			fileId,
			filename: safeOriginal,
			mimeType: mimeType || 'application/octet-stream',
			absolutePath,
		};
	}

	function createDownloadToken({ fileId, filename, mimeType, expiresAt }) {
		return createSignedToken({ fileId, filename, mimeType, exp: expiresAt }, tokenSecret);
	}

	function parseDownloadToken(token) {
		return verifySignedToken(token, tokenSecret);
	}

	async function getFilePath(fileId) {
		const base = path.basename(fileId);
		const absolutePath = path.join(storageDir, base);
		await fs.access(absolutePath);
		return absolutePath;
	}

	return {
		saveFile,
		createDownloadToken,
		parseDownloadToken,
		getFilePath,
	};
}

module.exports = {
	createFileTransferService,
	createSignedToken,
	verifySignedToken,
};
