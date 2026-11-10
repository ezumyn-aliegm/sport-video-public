import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTrustProxy } from '../server/config.js';

test('trust proxy config accepts only an explicit IPv4 proxy address', () => {
  assert.equal(normalizeTrustProxy('192.0.2.10/32'), '192.0.2.10/32');
  assert.equal(normalizeTrustProxy(' 192.0.2.11 '), '192.0.2.11');
  assert.equal(normalizeTrustProxy('false'), false);
  assert.equal(normalizeTrustProxy(false), false);
  for (const value of [true, 'true', '1', ' 2 ', '999999999999999999999', '192.0.0.0/16', '192.0.0.0/99', '192.0.0.0/16/extra', '192.0.256.0/16', 'unexpected']) {
    assert.throws(() => normalizeTrustProxy(value), /TRUST_PROXY/);
  }
});
