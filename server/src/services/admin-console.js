'use strict';
const { queryOne, parseJson } = require('../db');
const { err } = require('../lib/http');
const DEFAULTS = Object.freeze({ hotQuoteWeight: 3 });
async function migrate(query) {
  await query(`CREATE TABLE IF NOT EXISTS admin_console_settings (
    settingKey VARCHAR(64) PRIMARY KEY, valueJson JSON NOT NULL, updatedAt DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}
async function settings() {
  const row = await queryOne("SELECT valueJson FROM admin_console_settings WHERE settingKey='hall'");
  if (!row) return { ...DEFAULTS };
  const value = parseJson(row.valueJson, {});
  const weight = value?.hotQuoteWeight;
  return { hotQuoteWeight: Number.isInteger(weight) && weight >= 0 && weight <= 20 ? weight : DEFAULTS.hotQuoteWeight };
}
function validateSettings(body) {
  if (!body || Object.keys(body).some(k => k !== 'hotQuoteWeight') ||
      !Number.isInteger(body.hotQuoteWeight) || body.hotQuoteWeight < 0 || body.hotQuoteWeight > 20) {
    throw err.bad('报价热度权重必须为 0–20 的整数');
  }
  return { hotQuoteWeight: body.hotQuoteWeight };
}
module.exports = { migrate, settings, validateSettings };
