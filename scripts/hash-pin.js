#!/usr/bin/env node
import bcrypt from 'bcryptjs';

const pin = process.argv[2];
if (!pin) {
  console.error('Usage: node ./scripts/hash-pin.js <PIN>');
  process.exit(1);
}

const hash = await bcrypt.hash(String(pin), 10);
const composeSafeHash = hash.split('$').join('$$');
console.log(`FAMILY_PIN_HASH=${composeSafeHash}`);
