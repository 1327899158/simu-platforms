'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
test('生产即使显式设置自核验开关，也不得自动认证通过', () => {
  const output = execFileSync(process.execPath, ['-e', 'process.stdout.write(String(require("./src/config").config.allowEngineerSelfVerify))'], {
    cwd: require('node:path').resolve(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'production', ALLOW_ENGINEER_SELF_VERIFY: 'true' }, encoding: 'utf8',
  });
  assert.equal(output, 'false');
});
