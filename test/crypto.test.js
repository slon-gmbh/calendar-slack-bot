const { test } = require('node:test');
const assert = require('node:assert');

process.env.ENCRYPTION_KEY = '0'.repeat(64);

const { encrypt, decrypt, validateEncryptionKey } = require('../src/crypto.js');

test('encrypt/decrypt round-trip for a typical bot token', () => {
  const plain = 'xoxb-1234567890-abcdef';
  assert.strictEqual(decrypt(encrypt(plain)), plain);
});

test('encrypt/decrypt round-trip for a password with special characters', () => {
  const plain = 'p@ssw0rd!#$%^&*()';
  assert.strictEqual(decrypt(encrypt(plain)), plain);
});

test('encrypt produces different ciphertext on each call (random IV)', () => {
  const plain = 'same-plaintext';
  assert.notStrictEqual(encrypt(plain), encrypt(plain));
});

test('ciphertext format is iv:ct:tag — 3 colon-delimited hex parts', () => {
  const ct = encrypt('hello');
  const parts = ct.split(':');
  assert.strictEqual(parts.length, 3);
  assert.strictEqual(parts[0].length, 24);   // 12 bytes = 24 hex chars
  assert.strictEqual(parts[2].length, 32);   // 16 bytes = 32 hex chars
  assert.ok(/^[0-9a-f]+$/.test(parts[0]));
  assert.ok(/^[0-9a-f]+$/.test(parts[1]));
  assert.ok(/^[0-9a-f]+$/.test(parts[2]));
});

test('decrypt throws on tampered ciphertext', () => {
  const ct = encrypt('sensitive-value');
  const parts = ct.split(':');
  const tampered = parts[0] + ':' + 'ff' + parts[1].slice(2) + ':' + parts[2];
  assert.throws(() => decrypt(tampered));
});

test('validateEncryptionKey throws when ENCRYPTION_KEY is missing', () => {
  const saved = process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY;
  assert.throws(() => validateEncryptionKey(), /ENCRYPTION_KEY/);
  process.env.ENCRYPTION_KEY = saved;
});

test('validateEncryptionKey throws when key is 63 chars', () => {
  const saved = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = '0'.repeat(63);
  assert.throws(() => validateEncryptionKey(), /ENCRYPTION_KEY/);
  process.env.ENCRYPTION_KEY = saved;
});

test('validateEncryptionKey throws when key is 65 chars', () => {
  const saved = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = '0'.repeat(65);
  assert.throws(() => validateEncryptionKey(), /ENCRYPTION_KEY/);
  process.env.ENCRYPTION_KEY = saved;
});

test('validateEncryptionKey throws when key contains non-hex chars', () => {
  const saved = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = 'z'.repeat(64);
  assert.throws(() => validateEncryptionKey(), /ENCRYPTION_KEY/);
  process.env.ENCRYPTION_KEY = saved;
});

test('validateEncryptionKey passes for valid 64-char lowercase hex', () => {
  const saved = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = 'a1b2c3d4'.repeat(8);
  assert.doesNotThrow(() => validateEncryptionKey());
  process.env.ENCRYPTION_KEY = saved;
});
