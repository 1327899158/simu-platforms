'use strict';
const { readJson, ok, err } = require('../lib/http');
const { v, nowIso } = require('../lib/util');
const { query, queryOne, tx } = require('../db');
const { requireUser } = require('../lib/auth-mw');
const {
  encryptIdCard, decryptIdCard, idCardHash, validateIdentityFields, ensureIdentityRecord,
} = require('../services/identity-svc');

const MAX_SUPPORTING = 10;

function fileView(row) {
  return {
    fileId: row.id,
    id: row.id,
    fileID: row.fileID,
    name: row.name,
    kind: row.kind,
    mime: row.mime || '',
    sizeBytes: Number(row.sizeBytes || 0),
    purpose: row.purpose,
    createdAt: row.createdAt,
  };
}

async function ownedFiles(conn, userId, ids) {
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(',');
  const [rows] = await conn.execute(
    `SELECT id, uploaderId, orderId, kind, mime, name FROM uploaded_files WHERE id IN (${marks}) FOR UPDATE`, ids);
  if (rows.length !== ids.length || rows.some((file) => file.uploaderId !== userId || file.orderId)) {
    throw err.forbidden('只能提交本人上传的非订单文件');
  }
  return rows;
}

function register(router) {
  router.get('/api/identity', async (req, res) => {
    const user = await requireUser(req);
    const identity = await ensureIdentityRecord(user);
    const files = await query(
      `SELECT f.*, ivf.purpose, ivf.createdAt AS linkedAt
         FROM identity_verification_files ivf
         JOIN uploaded_files f ON f.id=ivf.fileId
        WHERE ivf.userId=? AND ivf.purpose='SUPPORTING'
        ORDER BY ivf.createdAt DESC`,
      [user.id]);
    ok(res, {
      realName: identity.realName || '',
      phone: user.phone || identity.phone || '',
      idCardNumber: decryptIdCard(identity.idCardCipher),
      verifyStatus: identity.verifyStatus || 'PENDING',
      reviewReason: identity.reviewReason || '',
      submittedAt: identity.submittedAt,
      files: files.map(fileView),
      maxSupportingFiles: MAX_SUPPORTING,
    });
  });

  router.post('/api/identity/submit', async (req, res) => {
    const user = await requireUser(req);
    const body = await readJson(req);
    if (!user.phone) throw err.bad('请先通过微信授权或手机号登录绑定本人手机号');
    const fields = validateIdentityFields(body.realName, user.phone, body.idCardNumber);
    const supportingFileIds = (v.arr(body.supportingFileIds, '补充材料', { maxLen: MAX_SUPPORTING, optional: true }) || [])
      .map((id) => v.str(id, '文件ID', { min: 1, max: 32 }));
    if (new Set(supportingFileIds).size !== supportingFileIds.length) throw err.bad('补充认证材料不能重复');
    try {
      await tx(async (conn) => {
        await ownedFiles(conn, user.id, supportingFileIds);
        const [duplicate] = await conn.execute(
          `SELECT userId FROM identity_verifications WHERE idCardHash=? AND userId<>? FOR UPDATE`,
          [idCardHash(fields.idCardNumber), user.id]);
        if (duplicate.length) throw err.conflict('该身份证号已用于其他账号的身份认证');
        const now = nowIso();
        await conn.execute(
          `INSERT INTO identity_verifications
            (userId, realName, phone, idCardCipher, idCardHash, verifyStatus, submittedAt, updatedAt)
           VALUES(?,?,?,?,?,'PENDING',?,?)
           ON DUPLICATE KEY UPDATE realName=VALUES(realName), phone=VALUES(phone),
             idCardCipher=VALUES(idCardCipher), idCardHash=VALUES(idCardHash),
             verifyStatus='PENDING', reviewReason=NULL, submittedAt=VALUES(submittedAt),
             reviewedAt=NULL, reviewedBy=NULL, updatedAt=VALUES(updatedAt)`,
          [user.id, fields.realName, fields.phone, encryptIdCard(fields.idCardNumber),
            idCardHash(fields.idCardNumber), now, now]
        );
        await conn.execute(`DELETE FROM identity_verification_files WHERE userId=?`, [user.id]);
        const links = supportingFileIds.map((id) => [id, 'SUPPORTING']);
        for (const [fileId, purpose] of links) {
          await conn.execute(
            `INSERT INTO identity_verification_files(userId, fileId, purpose, createdAt) VALUES(?,?,?,?)`,
            [user.id, fileId, purpose, now]);
        }
        // 兼容仍读取 engineer_profiles.verifyStatus 的旧部署节点和统计查询。
        if (user.role === 'ENGINEER') {
          await conn.execute(
            `UPDATE engineer_profiles SET realName=?, verifyStatus='PENDING', reviewReason=NULL,
             reviewedAt=NULL, reviewedBy=NULL WHERE userId=?`, [fields.realName, user.id]);
        }
      });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') throw err.conflict('身份证号或补充认证材料已被其他账号使用');
      throw error;
    }
    ok(res, { submitted: true, verifyStatus: 'PENDING' });
  });

  router.del('/api/identity/files/:id', async (req, res, params) => {
    const user = await requireUser(req);
    const file = await queryOne(
      `SELECT f.id, f.fileID, f.uploaderId FROM identity_verification_files ivf
       JOIN uploaded_files f ON f.id=ivf.fileId WHERE ivf.userId=? AND ivf.fileId=?`,
      [user.id, params.id]);
    if (!file) throw err.notFound('认证材料不存在');
    if (file.uploaderId !== user.id) throw err.forbidden('无权删除该认证材料');
    await tx(async (conn) => {
      await conn.execute(`DELETE FROM identity_verification_files WHERE userId=? AND fileId=?`, [user.id, file.id]);
      // 兼容迁移前工程师材料的旧关系，避免外键阻止文件元数据删除。
      await conn.execute(`DELETE FROM engineer_verification_files WHERE engineerId=? AND fileId=?`, [user.id, file.id]);
      await conn.execute(`DELETE FROM uploaded_files WHERE id=? AND uploaderId=?`, [file.id, user.id]);
      await conn.execute(
        `UPDATE identity_verifications SET verifyStatus='PENDING', reviewReason=NULL,
         reviewedAt=NULL, reviewedBy=NULL, updatedAt=? WHERE userId=?`, [nowIso(), user.id]);
      if (user.role === 'ENGINEER') {
        await conn.execute(
          `UPDATE engineer_profiles SET verifyStatus='PENDING', reviewReason=NULL,
           reviewedAt=NULL, reviewedBy=NULL WHERE userId=?`, [user.id]);
      }
    });
    ok(res, { deleted: true, fileID: file.fileID, verifyStatus: 'PENDING' });
  });
}

module.exports = { register };
