import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

test('bcrypt pin hash roundtrip', async () => {
  const pin = '1234';
  const hash = await bcrypt.hash(pin, 10);
  assert.equal(await bcrypt.compare(pin, hash), true);
  assert.equal(await bcrypt.compare('wrong', hash), false);
});
