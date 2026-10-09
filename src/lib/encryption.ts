
/**
 * @fileoverview
 * This file provides server-side utilities for application-level encryption
 * and decryption of data using Node.js's built-in crypto module.
 *
 * It uses AES-256-GCM, a modern and secure authenticated encryption algorithm.
 * The encryption key is read from the `DB_ENCRYPTION_KEY` environment variable.
 */
'use server';

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

const DB_ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY;

if (!DB_ENCRYPTION_KEY) {
    throw new Error('DB_ENCRYPTION_KEY environment variable is not set.');
}
const key = Buffer.from(DB_ENCRYPTION_KEY, 'utf-8');
if (key.length !== 32) {
    throw new Error(
        `DB_ENCRYPTION_KEY must encode to exactly 32 bytes when UTF-8 encoded (AES-256). ` +
        `Got ${key.length} bytes. Use only ASCII characters or a hex/base64 value to avoid ambiguity.`
    );
}

/**
 * Encrypts a string or a plain object.
 * @param data The data to encrypt (string, number, or object).
 * @returns The encrypted data as a Base64 string.
 */
export async function encrypt(data: string | object | number): Promise<string> {
    let textToEncrypt: string;

    if (typeof data === 'object') {
        textToEncrypt = JSON.stringify(data);
    } else {
        textToEncrypt = String(data);
    }
    
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(textToEncrypt, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Runs the AES-256-GCM decryption and returns the raw UTF-8 text without any
 * JSON.parse step. On failure (wrong key, not encrypted, corrupted) the
 * original input string is returned unchanged — preserving the existing
 * legacy-unencrypted-data behaviour.
 */
function rawDecrypt(encryptedData: string): string {
    try {
        const buffer = Buffer.from(encryptedData, 'base64');
        const iv = buffer.slice(0, IV_LENGTH);
        const authTag = buffer.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
        const encrypted = buffer.slice(IV_LENGTH + AUTH_TAG_LENGTH);

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
        // Decryption failed — return the original string (legacy / unencrypted data).
        return encryptedData;
    }
}

/**
 * Decrypts a Base64 string back into its original form (string or object).
 * Non-string inputs are returned as-is. After decryption JSON.parse is
 * attempted so objects/arrays/numbers stored via encrypt() are restored.
 * @param encryptedData The Base64 encrypted string.
 * @returns The decrypted data. Returns the original string if decryption fails.
 */
export async function decrypt(encryptedData: string | object): Promise<any> {
    // If data is not a string, it's likely already decrypted or not encrypted.
    if (typeof encryptedData !== 'string') {
        return encryptedData;
    }

    const decrypted = rawDecrypt(encryptedData);

    try {
        // Attempt to parse as JSON, if it fails, return as plain text
        return JSON.parse(decrypted);
    } catch {
        return decrypted;
    }
}

/**
 * Decrypts a Base64 string and returns the result as a plain string with NO
 * JSON.parse step. This is safe for node names: a name stored as "1234" stays
 * the string "1234" rather than becoming the number 1234.
 *
 * For non-string inputs (e.g. already-decrypted values that slipped through)
 * String(value ?? '') is returned so callers always get a string.
 *
 * @param encryptedData The Base64 encrypted string (or a non-string value).
 * @returns The decrypted text as a string.
 */
export async function decryptText(encryptedData: string | unknown): Promise<string> {
    if (typeof encryptedData !== 'string') {
        return String((encryptedData as any) ?? '');
    }

    return rawDecrypt(encryptedData);
}

