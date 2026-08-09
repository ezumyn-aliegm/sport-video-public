import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTrustProxy } from '../server/config.js';

test('trust proxy config accepts only an explicit IPv4 proxy address', () => {
  assert.equal(normalizeTrustProxy('192.0.2.1/32'), '192.0.2.1/32');
  assert.equal(normalizeTrustProxy(' 192.0.2.2 '), '192.0.2.2');
  assert.equal(normalizeTrustProxy('false'), false);
  assert.equal(normalizeTrustProxy(false), false);
  for (const value of [true, 'true', '1', ' 2 ', '999999999999999999999', '198.51.100.0/16', '198.51.100.0/99', '198.51.100.0/16/extra', '198.51.256.0/16', 'unexpected']) {
    assert.throws(() => normalizeTrustProxy(value), /TRUST_PROXY/);
  }
});
