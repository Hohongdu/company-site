/**
 * asyncHandler — Express async 라우트 에러 래퍼
 * try/catch 없이도 async 에러가 next(err)로 전달됩니다.
 *
 * 사용법:
 *   router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
