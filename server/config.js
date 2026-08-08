const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export const normalizeFamilyPinHash = (value) => String(value ?? '').trim().replaceAll('$$', '$');

export const isBcryptHash = (value) => BCRYPT_HASH_PATTERN.test(normalizeFamilyPinHash(value));
