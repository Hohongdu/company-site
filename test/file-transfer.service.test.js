const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createFileTransferService } = require('../services/file-transfer.service');

test('파일 저장 후 토큰 검증 및 경로 조회가 가능하다', async () => {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-transfer-'));
	const service = createFileTransferService({ storageDir: tmpDir, tokenSecret: 'test-secret' });

	const saved = await service.saveFile({
		fileBuffer: Buffer.from('hello world'),
		originalName: 'hello.txt',
		mimeType: 'text/plain',
	});

	const expiresAt = Date.now() + 1000 * 60;
	const token = service.createDownloadToken({
		fileId: saved.fileId,
		filename: saved.filename,
		mimeType: saved.mimeType,
		expiresAt,
	});

	const payload = service.parseDownloadToken(token);
	assert.equal(payload.fileId, saved.fileId);
	assert.equal(payload.filename, 'hello.txt');

	const filePath = await service.getFilePath(saved.fileId);
	const content = await fs.readFile(filePath, 'utf8');
	assert.equal(content, 'hello world');
});

test('토큰 변조 시 검증에 실패한다', async () => {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-transfer-'));
	const service = createFileTransferService({ storageDir: tmpDir, tokenSecret: 'test-secret' });

	const token = service.createDownloadToken({
		fileId: 'a.txt',
		filename: 'a.txt',
		mimeType: 'text/plain',
		expiresAt: Date.now() + 10000,
	});

	await assert.rejects(
		async () => service.parseDownloadToken(`${token}broken`),
		(err) => err.status === 403,
	);
});

test('만료 토큰은 410 오류를 반환한다', async () => {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-transfer-'));
	const service = createFileTransferService({ storageDir: tmpDir, tokenSecret: 'test-secret' });

	const token = service.createDownloadToken({
		fileId: 'a.txt',
		filename: 'a.txt',
		mimeType: 'text/plain',
		expiresAt: Date.now() - 1000,
	});

	await assert.rejects(
		async () => service.parseDownloadToken(token),
		(err) => err.status === 410,
	);
});
