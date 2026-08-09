import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const qaComposePath = new URL('../docker-compose.qa.yml', import.meta.url);

const readQaCompose = async () => {
  try {
    return await fs.readFile(qaComposePath, 'utf8');
  } catch (error) {
    assert.fail(`QA Compose override is required: ${error.message}`);
  }
};

test('QA Compose override trusts the controlled HTTPS proxy', async () => {
  const compose = await readQaCompose();
  assert.match(compose, /TRUST_PROXY:\s*["']192\.168\.16\.1\/32["']/);
  assert.match(compose, /NODE_ENV:\s*production/);
});
