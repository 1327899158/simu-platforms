/**
 * 统一请求封装（云开发版）。
 * 使用 wx.cloud.callContainer 替代 wx.request + JWT Bearer token。
 *
 * 变化：
 *   - 不再需要 token 管理（无 accessToken / refreshToken）
 *   - 鉴权由微信网关注入 X-WX-OPENID 自动完成
 *   - 业务接口401跳登录；登录尝试失败可交由当前表单处理。
 */
const { ENV_ID, SERVICE_NAME, BASE_URL } = require('./config');

// Keep this on the main request path, without a separately loaded module.
// Resolve display fields only; preserve IDs used for editing and uploading.
async function resolveMedia(value, resolve) {
  const pending = new Map();
  const visit = async (item) => {
    if (!item || typeof item !== 'object') return;
    await Promise.all(Object.keys(item).map(async (key) => {
      const original = item[key];
      if ((key === 'avatarUrl' || key === 'imgUrl') && typeof original === 'string' && original.startsWith('cloud://')) {
        if (!pending.has(original)) pending.set(original, Promise.resolve().then(() => resolve(original)).catch(() => ''));
        if (key === 'avatarUrl') item.avatarFileID = original;
        item[key] = await pending.get(original);
      } else if (typeof original === 'object') await visit(original);
    }));
  };
  await visit(value);
  return value;
}

/** 判断是否在开发者工具/本地（wx.cloud 不可用时降级到 wx.request） */
function isCloudAvailable() {
  return typeof wx.cloud !== 'undefined' && typeof wx.cloud.callContainer === 'function';
}

/**
 * callContainer 封装：
 *   request('GET', '/orders/mine', { status: 'QUOTING' })
 *   GET 的 data 转 query string；POST/PATCH/DELETE 作为 body。
 */
function callCloud(method, path, data) {
  return new Promise((resolve, reject) => {
    const upperMethod = method.toUpperCase();
    let requestPath = '/api' + path;
    let requestData = data || {};
    // callContainer 对 GET data 的处理在不同基础库版本中不一致，显式拼接查询串。
    if (upperMethod === 'GET' && data && Object.keys(data).length) {
      const query = Object.keys(data)
        .filter((key) => data[key] !== undefined && data[key] !== null && data[key] !== '')
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(data[key]))}`)
        .join('&');
      if (query) requestPath += (requestPath.includes('?') ? '&' : '?') + query;
      requestData = {};
    }
    const header = {
      'X-WX-SERVICE': SERVICE_NAME,
      'content-type': 'application/json',
    };
    // 非微信登录用户带上 session token
    const token = wx.getStorageSync('sessionToken');
    if (token) header['X-Session-Token'] = token;
    wx.cloud.callContainer({
      config: { env: ENV_ID },
      path: requestPath,
      method: upperMethod,
      header,
      data: requestData,
      success: (r) => resolve(r),
      fail: (e) => reject(new Error(e.errMsg || '网络错误')),
    });
  });
}

/** 本地调试降级：wx.request（需在开发者工具勾选「不校验合法域名」）*/
function callHttp(method, path, data) {
  return new Promise((resolve, reject) => {
    const header = { 'Content-Type': 'application/json' };
    header['X-Dev-Openid'] = wx.getStorageSync('devOpenid') || 'test_openid_customer';
    // 非微信登录用户带上 session token
    const token = wx.getStorageSync('sessionToken');
    if (token) header['X-Session-Token'] = token;
    wx.request({
      url: BASE_URL + path,
      method: method.toUpperCase(),
      data: data || {},
      header,
      success: (r) => resolve(r),
      fail: (e) => reject(new Error(e.errMsg || '网络错误')),
    });
  });
}

let redirectingToLogin = false;

function toLogin() {
  // A 401 means the cached identity is no longer trusted.  Clear every
  // auth-related cache before navigating, otherwise the login page immediately
  // redirects back to the home page and creates an infinite loop.
  wx.removeStorageSync('user');
  wx.removeStorageSync('sessionToken');
  wx.removeStorageSync('devOpenid');
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  wx.reLaunch({
    url: '/pages/login/index',
    complete: () => { setTimeout(() => { redirectingToLogin = false; }, 500); },
  });
}

/**
 * 统一请求入口。
 * opt.silent = true：错误不弹 Toast。
 * opt.redirectOnUnauthorized = false：登录尝试的401留在当前表单。
 */
async function request(method, path, data, opt = {}) {
  let res;
  if (isCloudAvailable()) {
    res = await callCloud(method, path, data);
  } else {
    res = await callHttp(method, path, data);
  }

  // callContainer 响应体在 res.data
  const body = res.data || {};
  const statusCode = res.statusCode || 200;

  if (statusCode === 200 && body.code === 0) {
    if(path==='/files/resolve-url')return body.data;
    // Login responses are resolved on the next authenticated /me request.
    if(path.startsWith('/auth/'))return body.data;
    return resolveMedia(body.data,async fileID=>{
      const r=await request('POST','/files/resolve-url',{fileID},{silent:true,redirectOnUnauthorized:false});
      return r.url;
    });
  }

  // 未登录 / 账号不可用
  if (statusCode === 401 || body.code === 40100) {
    if (opt.redirectOnUnauthorized !== false) toLogin();
    const e = new Error(body.message || (opt.redirectOnUnauthorized === false ? '登录失败，请检查输入' : '登录已失效，请重新登录'));
    e.statusCode = statusCode;
    e.code = body.code;
    throw e;
  }

  const msg = body.message || `请求失败(${statusCode})`;
  if (!opt.silent) wx.showToast({ title: msg, icon: 'none' });
  const e = new Error(msg);
  e.statusCode = statusCode;
  e.code = body.code;
  throw e;
}

/**
 * 上传文件（云开发版：wx.cloud.uploadFile）。
 * 上传成功后自动调 POST /api/files/commit 落库。
 *
 * 参数：
 *   filePath   本地临时路径
 *   options:
 *     kind     MODEL | DOC | IMAGE | RESULT
 *     orderId  关联订单 ID（可选）
 *     name     文件名（可选，默认从路径提取）
 *     mime     MIME 类型（可选）
 */
async function upload(filePath, { kind = 'DOC', orderId = '', name = '', mime = '' } = {}) {
  if (!isCloudAvailable()) {
    // 本地调试降级：wx.uploadFile
    return uploadHttp(filePath, { kind, orderId, name, mime });
  }

  const extMatch = /\.([a-zA-Z0-9]{1,12})$/.exec(String(name || filePath));
  const ext = extMatch ? extMatch[1] : '';
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const filename = name || `${kind}_${ts}_${rand}${ext ? '.' + ext : ''}`;
  const user = wx.getStorageSync('user') || {};
  const userSegment = String(user.id || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_');
  const orderSegment = String(orderId || 'pending').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeExt = String(ext).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  const cloudPath = `uploads/${userSegment}/${orderSegment}/${ts}_${rand}${safeExt ? '.' + safeExt : ''}`;

  const uploadResult = await new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      config: { env: ENV_ID },
      cloudPath,
      filePath,
      success: (r) => resolve(r),
      fail: (e) => reject(new Error(e.errMsg || '上传失败')),
    });
  });

  const fileID = uploadResult.fileID;
  if (!fileID) throw new Error('上传失败：未获取到 fileID');

  // 获取文件大小（小程序没有直接 API，这里用 0 占位，服务端可补充）
  let sizeBytes = 0;
  try {
    const stat = await new Promise((resolve) => {
      // 新版基础库使用 FileSystemManager；保留旧 API 作为兼容降级。
      const fs = wx.getFileSystemManager && wx.getFileSystemManager();
      if (fs && fs.getFileInfo) {
        fs.getFileInfo({ filePath, success: (r) => resolve(r), fail: () => resolve({}) });
      } else {
        wx.getFileInfo({ filePath, success: (r) => resolve(r), fail: () => resolve({}) });
      }
    });
    sizeBytes = stat.size || 0;
  } catch (e) { /* 忽略 */ }

  // 通知服务端落库；业务接口保存 uploaded_files 元数据。这里不在请求失败时
  // 自动删除云对象：响应可能是在服务端已落库后丢失，贸然删除会制造悬空记录。
  const meta = await request(
    'POST', '/files/commit',
    { fileID, name: filename, kind, orderId, sizeBytes, mime },
    { silent: true }
  );
  return { ...meta, fileID };
}

/** 本地调试降级上传（wx.uploadFile 走 multipart） */
function uploadHttp(filePath, { kind = 'DOC', orderId = '', name = '', mime = '' }) {
  return new Promise((resolve, reject) => {
    const ext = filePath.split('.').pop() || '';
    const ts = Date.now();
    const filename = name || `${kind}_${ts}.${ext}`;
    wx.uploadFile({
      url: require('./config').BASE_URL + '/files/upload',
      filePath,
      name: 'file',
      formData: { kind, orderId, filename, mime },
      header: { 'X-Dev-Openid': wx.getStorageSync('devOpenid') || 'test_openid_customer' },
      success(res) {
        try {
          const body = JSON.parse(res.data);
          if (body.code === 0) resolve(body.data);
          else reject(new Error(body.message || '上传失败'));
        } catch (e) { reject(e); }
      },
      fail: (e) => reject(new Error(e.errMsg || '上传失败')),
    });
  });
}

module.exports = { request, upload, toLogin, resolveMedia };
