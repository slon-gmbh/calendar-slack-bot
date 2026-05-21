# Credential Encryption at Rest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt `workspaces.bot_token` and `caldav_credentials.password` in SQLite using AES-256-GCM before any credential is written.

**Architecture:** New `src/crypto.js` owns all encryption primitives. `src/db.js` calls it transparently — callers always deal in plaintext. `src/server.js` validates `ENCRYPTION_KEY` before the DB opens. `src/config.js` drops its raw credential SQL in favour of the new `db.js` functions.

**Tech Stack:** Node.js built-in `node:crypto`, `better-sqlite3`, `node:test` test runner.

---

### Task 1: src/crypto.js + test/crypto.test.js

**Files:**
- Create: `test/crypto.test.js`
- Create: `src/crypto.js`

- [ ] **Step 1: Write test/crypto.test.js**

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `NODE_ENV=test node --test test/crypto.test.js`

Expected: `Error: Cannot find module '../src/crypto.js'`

- [ ] **Step 3: Implement src/crypto.js**

```js
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
  return decipher.update(Buffer.from(ctHex, 'hex')) + decipher.final('utf8');
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `NODE_ENV=test node --test test/crypto.test.js`

Expected: `✔ 10 tests passed`

- [ ] **Step 5: Commit**

```bash
git add test/crypto.test.js src/crypto.js
git commit -m "feat: add AES-256-GCM crypto module

refs: #45"
```

---

### Task 2: db.js — add encryption (test-first)

**Files:**
- Modify: `test/db.test.js`
- Modify: `src/db.js`

- [ ] **Step 1: Add ENCRYPTION_KEY setup at top of test/db.test.js**

Insert after the existing `require` lines, before the `function memDb()` declaration:

```js
process.env.ENCRYPTION_KEY = '0'.repeat(64);
```

The top of the file should look like:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { openDb, loadEvents, saveEvents, loadColor, saveColor, loadRunState, saveRunState, loadPending, savePending, getWorkspace, upsertWorkspace } = require('../src/db.js');

process.env.ENCRYPTION_KEY = '0'.repeat(64);

function memDb() {
  return openDb(':memory:');
}
```

- [ ] **Step 2: Append new encryption tests to end of test/db.test.js**

```js
test('upsertWorkspace encrypts bot_token — raw stored value differs from plaintext', () => {
  const db = memDb();
  upsertWorkspace(db, { teamId: 'T_ENC', teamName: 'Enc Test', botToken: 'xoxb-plaintext-token' });
  const raw = db.prepare('SELECT bot_token FROM workspaces WHERE team_id = ?').get('T_ENC');
  assert.notStrictEqual(raw.bot_token, 'xoxb-plaintext-token');
  assert.ok(raw.bot_token.includes(':'), 'stored value must be in iv:ct:tag format');
  db.close();
});

test('getWorkspace decrypts bot_token — returns original plaintext', () => {
  const db = memDb();
  upsertWorkspace(db, { teamId: 'T_DEC', teamName: 'Dec Test', botToken: 'xoxb-plaintext-token' });
  const row = getWorkspace(db, 'T_DEC');
  assert.strictEqual(row.bot_token, 'xoxb-plaintext-token');
  db.close();
});

const { upsertCaldavCredentials, getCaldavCredentials } = require('../src/db.js');

test('upsertCaldavCredentials encrypts password — raw stored value differs from plaintext', () => {
  const db = memDb();
  upsertWorkspace(db, { teamId: 'T_CRED', teamName: 'Cred Test' });
  upsertCaldavCredentials(db, 'T_CRED', 'admin', 'super-secret-pass');
  const raw = db.prepare('SELECT password FROM caldav_credentials WHERE workspace_id = ?').get('T_CRED');
  assert.notStrictEqual(raw.password, 'super-secret-pass');
  assert.ok(raw.password.includes(':'), 'stored value must be in iv:ct:tag format');
  db.close();
});

test('getCaldavCredentials decrypts password — returns original plaintext', () => {
  const db = memDb();
  upsertWorkspace(db, { teamId: 'T_CRED2', teamName: 'Cred Test 2' });
  upsertCaldavCredentials(db, 'T_CRED2', 'user@example.com', 'super-secret-pass');
  const creds = getCaldavCredentials(db, 'T_CRED2');
  assert.strictEqual(creds.username, 'user@example.com');
  assert.strictEqual(creds.password, 'super-secret-pass');
  db.close();
});

test('getCaldavCredentials returns null for unknown workspace', () => {
  const db = memDb();
  assert.strictEqual(getCaldavCredentials(db, 'T_NONE'), null);
  db.close();
});

test('upsertCaldavCredentials is idempotent — updates on conflict', () => {
  const db = memDb();
  upsertWorkspace(db, { teamId: 'T_IDEM', teamName: 'Idem Test' });
  upsertCaldavCredentials(db, 'T_IDEM', 'user1', 'pass1');
  upsertCaldavCredentials(db, 'T_IDEM', 'user2', 'pass2');
  const creds = getCaldavCredentials(db, 'T_IDEM');
  assert.strictEqual(creds.username, 'user2');
  assert.strictEqual(creds.password, 'pass2');
  db.close();
});
```

- [ ] **Step 3: Run test/db.test.js to confirm new tests fail**

Run: `NODE_ENV=test node --test test/db.test.js`

Expected: Existing tests pass. New tests fail:
- `upsertCaldavCredentials is not a function`
- `raw.bot_token === 'xoxb-plaintext-token'` (encryption not yet implemented)

- [ ] **Step 4: Add crypto import to src/db.js**

After `const Database = require('better-sqlite3');`, add:

```js
const { encrypt, decrypt } = require('./crypto.js');
```

- [ ] **Step 5: Modify upsertWorkspace to encrypt botToken**

In `upsertWorkspace`, change the `.run(...)` call. The line currently ends with `botToken, installedBy, ...`. Change it to:

```js
  `).run(teamId, teamName || teamId, botToken ? encrypt(botToken) : null, installedBy, new Date().toISOString(), locale, timezone, errorChannel, nextcloudUrl);
```

- [ ] **Step 6: Modify getWorkspace to decrypt bot_token**

Replace the current `getWorkspace` function body:

```js
function getWorkspace(db, workspaceId) {
  const row = db.prepare('SELECT * FROM workspaces WHERE team_id = ?').get(workspaceId) || null;
  if (row?.bot_token) row.bot_token = decrypt(row.bot_token);
  return row;
}
```

- [ ] **Step 7: Add upsertCaldavCredentials before the module.exports block**

```js
/**
 * Insert or update CalDAV credentials. Encrypts password transparently.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @param {string} username
 * @param {string} password - plaintext; stored encrypted
 */
function upsertCaldavCredentials(db, workspaceId, username, password) {
  db.prepare(`
    INSERT INTO caldav_credentials (workspace_id, username, password)
    VALUES (?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      username = excluded.username,
      password = excluded.password
  `).run(workspaceId, username, encrypt(password));
}
```

- [ ] **Step 8: Add getCaldavCredentials before the module.exports block**

```js
/**
 * Get CalDAV credentials, decrypting password transparently.
 * @param {import('better-sqlite3').Database} db
 * @param {string} workspaceId
 * @returns {{username: string, password: string}|null}
 */
function getCaldavCredentials(db, workspaceId) {
  const row = db.prepare(
    'SELECT username, password FROM caldav_credentials WHERE workspace_id = ?'
  ).get(workspaceId);
  if (!row) return null;
  return { username: row.username, password: decrypt(row.password) };
}
```

- [ ] **Step 9: Add new functions to module.exports**

Replace the existing `module.exports` block:

```js
module.exports = {
  openDb,
  loadEvents,
  saveEvents,
  loadColor,
  saveColor,
  loadRunState,
  saveRunState,
  loadPending,
  savePending,
  getWorkspace,
  upsertWorkspace,
  upsertCaldavCredentials,
  getCaldavCredentials
};
```

- [ ] **Step 10: Run test/db.test.js to verify all tests pass**

Run: `NODE_ENV=test node --test test/db.test.js`

Expected: All tests pass, including the new encryption assertions.

- [ ] **Step 11: Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "feat: encrypt bot_token and caldav password in db.js

refs: #45"
```

---

### Task 3: config.js — drop raw credential SQL

**Files:**
- Modify: `test/config-db.test.js`
- Modify: `src/config.js`

- [ ] **Step 1: Add ENCRYPTION_KEY setup to test/config-db.test.js**

Insert after the `require` lines, before `const FIXTURE_CONFIG`:

```js
process.env.ENCRYPTION_KEY = '0'.repeat(64);
```

The top of the file should look like:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db.js');
const { loadConfigFromDb, seedWorkspace, validateConfig } = require('../src/config.js');

process.env.ENCRYPTION_KEY = '0'.repeat(64);

const FIXTURE_CONFIG = { ... };
```

- [ ] **Step 2: Update the raw password assertion in config-db.test.js**

Find in `test('seedWorkspace inserts all config data into the database', ...)`:

```js
  const creds = db.prepare('SELECT * FROM caldav_credentials WHERE workspace_id = ?').get('T_TEST');
  assert.strictEqual(creds.username, 'admin');
  assert.strictEqual(creds.password, 'secret');
```

Replace with:

```js
  const creds = db.prepare('SELECT * FROM caldav_credentials WHERE workspace_id = ?').get('T_TEST');
  assert.strictEqual(creds.username, 'admin');
  assert.notStrictEqual(creds.password, 'secret');
  assert.ok(creds.password.includes(':'), 'stored password must be in iv:ct:tag format');
```

- [ ] **Step 3: Run config-db tests to confirm the updated assertion fails**

Run: `NODE_ENV=test node --test test/config-db.test.js`

Expected: `seedWorkspace inserts all config data` fails because `config.js` still writes raw plaintext. All other tests pass.

- [ ] **Step 4: Update the require line in src/config.js**

Change:

```js
const { getWorkspace, upsertWorkspace } = require('./db.js');
```

To:

```js
const { getWorkspace, upsertWorkspace, upsertCaldavCredentials, getCaldavCredentials } = require('./db.js');
```

- [ ] **Step 5: Replace raw caldav INSERT in seedWorkspace()**

In `seedWorkspace`, remove:

```js
    db.prepare(`
      INSERT INTO caldav_credentials (workspace_id, username, password)
      VALUES (?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        username = excluded.username,
        password = excluded.password
    `).run(workspaceId, configJson.caldav_credentials.username, configJson.caldav_credentials.password);
```

Replace with:

```js
    upsertCaldavCredentials(db, workspaceId, configJson.caldav_credentials.username, configJson.caldav_credentials.password);
```

- [ ] **Step 6: Replace raw caldav SELECT in loadConfigFromDb()**

In `loadConfigFromDb`, replace:

```js
  const creds = db.prepare('SELECT username, password FROM caldav_credentials WHERE workspace_id = ?').get(workspaceId);
  if (!creds) throw new Error(`No CalDAV credentials for workspace: ${workspaceId}`);
```

With:

```js
  const creds = getCaldavCredentials(db, workspaceId);
  if (!creds) throw new Error(`No CalDAV credentials for workspace: ${workspaceId}`);
```

- [ ] **Step 7: Run config-db tests**

Run: `NODE_ENV=test node --test test/config-db.test.js`

Expected: All tests pass, including the updated raw password assertion.

- [ ] **Step 8: Commit**

```bash
git add src/config.js test/config-db.test.js
git commit -m "feat: route caldav credentials through db.js in config.js

refs: #45"
```

---

### Task 4: server.js — startup validation

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Add validateEncryptionKey import to src/server.js**

After the existing requires, add:

```js
const { validateEncryptionKey } = require('./crypto.js');
```

The full require block becomes:

```js
const http = require('node:http');
const path = require('node:path');
const cron = require('node-cron');
const { loadConfigFromDb } = require('./config.js');
const { openDb } = require('./db.js');
const { runScheduledDigests, runChangeDetection } = require('./runner.js');
const { validateEncryptionKey } = require('./crypto.js');
```

- [ ] **Step 2: Call validateEncryptionKey() as first line of start()**

Change the opening of `start()`:

```js
async function start() {
  validateEncryptionKey();
  const dataDir = process.env.DATA_DIR;
  if (!dataDir) throw new Error('DATA_DIR environment variable not set');
```

- [ ] **Step 3: Run the full test suite**

Run: `NODE_ENV=test node --test test/*.test.js`

Expected: All tests pass. (The `start()` function is not invoked by `require('./src/server.js')` — it is guarded by `require.main === module`.)

- [ ] **Step 4: Commit**

```bash
git add src/server.js
git commit -m "feat: validate ENCRYPTION_KEY at server startup

refs: #45"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `NODE_ENV=test node --test test/*.test.js`

Expected: All tests pass.

- [ ] **Step 2: Smoke test encrypt/decrypt with a real key**

```bash
ENCRYPTION_KEY=$(openssl rand -hex 32) node -e "
  const { encrypt, decrypt } = require('./src/crypto.js');
  const plain = 'xoxb-12345-super-secret';
  const ct = encrypt(plain);
  console.log('ciphertext:', ct);
  console.log('parts:', ct.split(':').length, '(expect 3)');
  console.log('roundtrip:', decrypt(ct) === plain ? 'PASS' : 'FAIL');
"
```

Expected output:
```
ciphertext: <24-char hex>:<variable hex>:<32-char hex>
parts: 3 (expect 3)
roundtrip: PASS
```

- [ ] **Step 3: Smoke test startup rejection without key**

```bash
node -e "
  const { validateEncryptionKey } = require('./src/crypto.js');
  try { validateEncryptionKey(); console.log('FAIL'); }
  catch (e) { console.log('PASS:', e.message); }
"
```

Expected: `PASS: ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate one with: openssl rand -hex 32`
