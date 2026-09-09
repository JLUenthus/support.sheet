// ===========================================================
// support.sheet – Private Workspace: Crypto-Modul
// AES-256-GCM + PBKDF2-HMAC-SHA-256, .support Binärformat
// ===========================================================
(function () {
  'use strict';

  const MAGIC = 'SSUPPORT';
  const MAGIC_BYTES = new TextEncoder().encode(MAGIC); // 8 Byte
  const VERSION = 1;
  const KDF_ID_PBKDF2_SHA256 = 0x01;
  const ITERATIONS = 600000;
  const SALT_LEN = 32;
  const IV_LEN = 12;
  const TAG_LEN = 16;
  // MAGIC(8) + VERSION(2) + KDF_ID(1) + ITERATIONS(4) + SALT_LEN(1) + SALT(32)
  // + IV_LEN(1) + IV(12) + TAG_LEN(1) = 62 Byte
  const HEADER_LEN = 8 + 2 + 1 + 4 + 1 + SALT_LEN + 1 + IV_LEN + 1;
  // Obergrenze gegen absurd hohe ITERATIONS-Werte in manipulierten/fremden Dateien
  const MAX_ITERATIONS = 5000000;

  const ErrorCodes = Object.freeze({
    INVALID_MAGIC: 'INVALID_MAGIC',
    UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
    INVALID_HEADER: 'INVALID_HEADER',
    CORRUPT_DATA: 'CORRUPT_DATA',
    AUTH_FAILED: 'AUTH_FAILED',
    WEBCRYPTO_UNAVAILABLE: 'WEBCRYPTO_UNAVAILABLE'
  });

  class PrivateCryptoError extends Error {
    constructor(code, message) {
      super(message || code);
      this.name = 'PrivateCryptoError';
      this.code = code;
    }
  }

  function describeError(err) {
    const code = err && err.code;
    switch (code) {
      case ErrorCodes.INVALID_MAGIC:
      case ErrorCodes.INVALID_HEADER:
        return 'Keine gültige .support Datei.';
      case ErrorCodes.UNSUPPORTED_VERSION:
        return 'Datei wurde mit einer neueren Version erstellt.';
      case ErrorCodes.AUTH_FAILED:
      case ErrorCodes.CORRUPT_DATA:
        return 'Falsches Passwort oder beschädigte Datei.';
      case ErrorCodes.WEBCRYPTO_UNAVAILABLE:
        return 'Verschlüsselung wird von diesem Browser oder dieser Verbindung nicht unterstützt (HTTPS/secure context erforderlich).';
      default:
        return 'Falsches Passwort oder beschädigte Datei.';
    }
  }

  function ensureWebCryptoAvailable() {
    if (!globalThis.crypto || !globalThis.crypto.subtle) {
      throw new PrivateCryptoError(ErrorCodes.WEBCRYPTO_UNAVAILABLE, 'Web Crypto API ist in dieser Umgebung nicht verfügbar (secure context erforderlich).');
    }
  }

  function toUint8Array(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    throw new TypeError('Erwartet wird ein Uint8Array oder ArrayBuffer.');
  }

  function concatBytes(...parts) {
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  }

  function randomBytes(len) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return arr;
  }

  async function deriveKey(password, salt, iterations) {
    const passwordBytes = new TextEncoder().encode(password);
    const baseKey = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false, // extractable
      ['encrypt', 'decrypt']
    );
  }

  function buildHeader(salt, iv, iterations) {
    const buffer = new ArrayBuffer(HEADER_LEN);
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);

    bytes.set(MAGIC_BYTES, 0);
    view.setUint16(8, VERSION, true);
    bytes[10] = KDF_ID_PBKDF2_SHA256;
    view.setUint32(11, iterations, true);
    bytes[15] = SALT_LEN;
    bytes.set(salt, 16);
    bytes[48] = IV_LEN;
    bytes.set(iv, 49);
    bytes[61] = TAG_LEN;

    return bytes;
  }

  function parseHeader(fullBytes) {
    if (!(fullBytes instanceof Uint8Array) || fullBytes.length < HEADER_LEN) {
      throw new PrivateCryptoError(ErrorCodes.INVALID_HEADER, 'Datei ist zu kurz für einen gültigen Header.');
    }

    for (let i = 0; i < MAGIC_BYTES.length; i++) {
      if (fullBytes[i] !== MAGIC_BYTES[i]) {
        throw new PrivateCryptoError(ErrorCodes.INVALID_MAGIC, 'Ungültiges Dateiformat (MAGIC stimmt nicht überein).');
      }
    }

    const view = new DataView(fullBytes.buffer, fullBytes.byteOffset, fullBytes.byteLength);

    const version = view.getUint16(8, true);
    if (version > VERSION) {
      throw new PrivateCryptoError(ErrorCodes.UNSUPPORTED_VERSION, `Nicht unterstützte Version: ${version}`);
    }
    if (version !== VERSION) {
      throw new PrivateCryptoError(ErrorCodes.INVALID_HEADER, `Unerwartete Version: ${version}`);
    }

    const kdfId = fullBytes[10];
    if (kdfId !== KDF_ID_PBKDF2_SHA256) {
      throw new PrivateCryptoError(ErrorCodes.INVALID_HEADER, `Unbekannte KDF_ID: ${kdfId}`);
    }

    const iterations = view.getUint32(11, true);
    if (iterations <= 0 || iterations > MAX_ITERATIONS) {
      throw new PrivateCryptoError(ErrorCodes.INVALID_HEADER, `Ungültige Iterationsanzahl: ${iterations}`);
    }

    const saltLen = fullBytes[15];
    if (saltLen !== SALT_LEN) {
      throw new PrivateCryptoError(ErrorCodes.INVALID_HEADER, `Ungültige SALT_LEN: ${saltLen}`);
    }
    const salt = fullBytes.slice(16, 16 + SALT_LEN);

    const ivLen = fullBytes[48];
    if (ivLen !== IV_LEN) {
      throw new PrivateCryptoError(ErrorCodes.INVALID_HEADER, `Ungültige IV_LEN: ${ivLen}`);
    }
    const iv = fullBytes.slice(49, 49 + IV_LEN);

    const tagLen = fullBytes[61];
    if (tagLen !== TAG_LEN) {
      throw new PrivateCryptoError(ErrorCodes.INVALID_HEADER, `Ungültige TAG_LEN: ${tagLen}`);
    }

    const ciphertext = fullBytes.slice(HEADER_LEN);
    if (ciphertext.length < TAG_LEN) {
      throw new PrivateCryptoError(ErrorCodes.CORRUPT_DATA, 'Datei ist abgeschnitten (Ciphertext fehlt oder ist zu kurz).');
    }

    return { version, kdfId, iterations, salt, iv, ciphertext };
  }

  function validateHeader(data) {
    ensureWebCryptoAvailable();
    const bytes = toUint8Array(data);
    const parsed = parseHeader(bytes);
    return { valid: true, version: parsed.version, iterations: parsed.iterations };
  }

  async function encrypt(workspace, password) {
    ensureWebCryptoAvailable();
    if (!workspace || typeof workspace !== 'object') {
      throw new TypeError('workspace muss ein Objekt sein.');
    }
    if (typeof password !== 'string' || password.length === 0) {
      throw new TypeError('password muss ein nicht-leerer String sein.');
    }

    const plaintext = new TextEncoder().encode(JSON.stringify(workspace));
    const salt = randomBytes(SALT_LEN);
    const iv = randomBytes(IV_LEN); // pro Aufruf neu, nie wiederverwenden
    const key = await deriveKey(password, salt, ITERATIONS);

    const cipherBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: TAG_LEN * 8 },
      key,
      plaintext
    );

    const header = buildHeader(salt, iv, ITERATIONS);
    return concatBytes(header, new Uint8Array(cipherBuffer));
  }

  async function decrypt(data, password) {
    ensureWebCryptoAvailable();
    if (typeof password !== 'string' || password.length === 0) {
      throw new TypeError('password muss ein nicht-leerer String sein.');
    }

    const bytes = toUint8Array(data);
    const { salt, iv, iterations, ciphertext } = parseHeader(bytes);
    const key = await deriveKey(password, salt, iterations);

    let plainBuffer;
    try {
      plainBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, tagLength: TAG_LEN * 8 },
        key,
        ciphertext
      );
    } catch (err) {
      throw new PrivateCryptoError(ErrorCodes.AUTH_FAILED, 'Entschlüsselung fehlgeschlagen (falsches Passwort oder beschädigte Daten).');
    }

    let plaintext;
    try {
      plaintext = new TextDecoder('utf-8', { fatal: true }).decode(plainBuffer);
    } catch (err) {
      throw new PrivateCryptoError(ErrorCodes.CORRUPT_DATA, 'Entschlüsselte Daten sind kein gültiger UTF-8 Text.');
    }

    let obj;
    try {
      obj = JSON.parse(plaintext);
    } catch (err) {
      throw new PrivateCryptoError(ErrorCodes.CORRUPT_DATA, 'Entschlüsselte Daten sind kein gültiges JSON.');
    }

    return obj;
  }

  function isValidWorkspaceShape(obj) {
    return !!obj &&
      typeof obj === 'object' &&
      obj.version === 1 &&
      typeof obj.name === 'string' &&
      typeof obj.created === 'string' &&
      typeof obj.modified === 'string' &&
      !!obj.sections &&
      Array.isArray(obj.sections.notes) &&
      Array.isArray(obj.sections.entries);
  }

  async function openWorkspace(data, password) {
    const obj = await decrypt(data, password);
    if (!isValidWorkspaceShape(obj)) {
      throw new PrivateCryptoError(ErrorCodes.CORRUPT_DATA, 'Entschlüsselte Daten entsprechen nicht dem erwarteten Workspace-Format.');
    }
    return obj;
  }

  async function createWorkspace(name, password) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new TypeError('name muss ein nicht-leerer String sein.');
    }
    const now = new Date().toISOString();
    const workspace = {
      version: 1,
      created: now,
      modified: now,
      name,
      sections: { notes: [], entries: [] }
    };
    return encrypt(workspace, password);
  }

  window.PrivateCrypto = Object.freeze({
    createWorkspace,
    openWorkspace,
    encrypt,
    decrypt,
    validateHeader,
    ErrorCodes,
    describeError
  });
})();
