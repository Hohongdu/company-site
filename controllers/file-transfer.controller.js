const path = require('node:path');
const multer = require('multer');
const { createFileTransferService } = require('../services/file-transfer.service');

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: Number(process.env.FILE_TRANSFER_MAX_SIZE || 10 * 1024 * 1024),
	},
});

const fileTransferService = createFileTransferService({
	storageDir: path.join(__dirname, '..', 'uploads', 'shared-files'),
	tokenSecret: process.env.FILE_TRANSFER_TOKEN_SECRET || 'unsafe-dev-secret-change-me',
});

exports.uploadMiddleware = upload.single('file');

exports.createTransfer = async (req, res) => {
	try {
		const senderName = String(req.body?.senderName || '').trim();
		const senderEmail = String(req.body?.senderEmail || '').trim();
		const expiresHoursRaw = Number(req.body?.expiresHours || 24);
		const expiresHours = Math.min(Math.max(expiresHoursRaw, 1), 168);

		if (!req.file) return res.status(400).json({ ok: false, message: '파일이 필요합니다.' });
		if (!senderName || !isEmail(senderEmail)) {
			return res.status(400).json({ ok: false, message: '발신자 정보를 확인해주세요.' });
		}

		const saved = await fileTransferService.saveFile({
			fileBuffer: req.file.buffer,
			originalName: req.file.originalname,
			mimeType: req.file.mimetype,
		});

		const expiresAt = Date.now() + expiresHours * 60 * 60 * 1000;
		const token = fileTransferService.createDownloadToken({
			fileId: saved.fileId,
			filename: saved.filename,
			mimeType: saved.mimeType,
			expiresAt,
		});

		const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
		const downloadUrl = `${baseUrl}/api/file-transfer/download?token=${encodeURIComponent(token)}`;

		return res.json({
			ok: true,
			downloadUrl,
			expiresAt,
		});
	} catch (err) {
		console.error('[file-transfer:createTransfer]', err);
		return res.status(500).json({ ok: false, message: '파일 전송 생성 중 오류가 발생했습니다.' });
	}
};

exports.download = async (req, res) => {
	try {
		const token = String(req.query?.token || '');
		const payload = fileTransferService.parseDownloadToken(token);
		const absolutePath = await fileTransferService.getFilePath(payload.fileId);
		res.setHeader('Content-Type', payload.mimeType || 'application/octet-stream');
		return res.download(absolutePath, payload.filename);
	} catch (err) {
		const status = Number(err?.status || 500);
		if (status >= 400 && status < 500) {
			return res.status(status).json({ ok: false, message: err.message });
		}
		console.error('[file-transfer:download]', err);
		return res.status(500).json({ ok: false, message: '파일 다운로드 중 오류가 발생했습니다.' });
	}
};
