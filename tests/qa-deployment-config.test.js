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

test('QA Compose override requires an operator-supplied exact proxy address', async () => {
  const compose = await readQaCompose();
  assert.ok(compose.includes('${QA_TRUST_PROXY:?'));
  assert.match(compose, /NODE_ENV:\s*production/);
});
