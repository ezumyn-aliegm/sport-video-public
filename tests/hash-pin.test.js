import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import bcrypt from 'bcryptjs';
import { normalizeFamilyPinHash } from '../server/config.js';

const execFileAsync = promisify(execFile);

test('bcrypt pin hash roundtrip', async () => {
  const pin = '1234';
  const hash = await bcrypt.hash(pin, 10);
  assert.equal(await bcrypt.compare(pin, hash), true);
  assert.equal(await bcrypt.compare('wrong', hash), false);
});

test('hash-pin emits a Compose-safe env assignment', async () => {
  const { stdout } = await execFileAsync(process.execPath, ['./scripts/hash-pin.js', '1234']);
  const assignment = stdout.trim();
  assert.match(assignment, /^FAMILY_PIN_HASH=\$\$2[aby]\$\$\d{2}\$\$/);
  const escapedHash = assignment.slice('FAMILY_PIN_HASH='.length);
  const normalizedHash = normalizeFamilyPinHash(escapedHash);
  assert.equal(await bcrypt.compare('1234', normalizedHash), true);
});
