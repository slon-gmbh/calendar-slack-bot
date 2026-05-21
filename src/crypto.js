const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');

const KEY = () => Buffer.from(process.env.ENCRYPTION_KEY, 'hex');

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * @param {string} plaintext
 * @returns {string} iv_hex:ciphertext_hex:tag_hex
 * @example encrypt('xoxb-token') // 'a3f2...c1d4:6e6f...:8f3a...'
 */
function encrypt(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${ct.toString('hex')}:${tag.toString('hex')}`;
}

/**
 * Decrypt a value produced by encrypt().
 * @param {string} stored - iv_hex:ciphertext_hex:tag_hex
 * @returns {string} plaintext
 */
function decrypt(stored) {
  const [ivHex, ctHex, tagHex] = stored.split(':');
  const decipher = createDecipheriv('aes-256-gcm', KEY(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctHex, 'hex')),
    decipher.final()
  ]).toString('utf8');
}

/**
 * Validate that process.env.ENCRYPTION_KEY is a 64-character hex string.
 * Throws with a keygen hint if invalid. Call at server startup before openDb().
 */
function validateEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      'ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
      'Generate one with: openssl rand -hex 32'
    );
  }
}

module.exports = { encrypt, decrypt, validateEncryptionKey };
