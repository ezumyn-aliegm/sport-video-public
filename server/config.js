import { isIP } from 'node:net';

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export const normalizeFamilyPinHash = (value) => String(value ?? '').trim().replaceAll('$$', '$');

const isExactIpv4 = (value) => {
  const parts = value.split('/');
  if (parts.length > 2 || isIP(parts[0]) !== 4) return false;
  return parts[1] === undefined || parts[1] === '32';
};

export const normalizeTrustProxy = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'false' || normalized === '') return false;
  if (isExactIpv4(normalized)) return normalized;
  throw new Error('TRUST_PROXY must be false or an explicit IPv4 proxy address (/32)');
};

export const isBcryptHash = (value) => BCRYPT_HASH_PATTERN.test(normalizeFamilyPinHash(value));
