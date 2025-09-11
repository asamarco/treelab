
/**
 * @fileoverview
 * This file provides server-side utilities for application-level encryption
 * and decryption of data using Node.js's built-in crypto module.
 *
 * It uses AES-256-GCM, a modern and secure authenticated encryption algorithm.
 * The encryption key is read from the `ENCRYPTION_KEY` environment variable.
 */
'use server';

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 32) {
    throw new Error('ENCRYPTION_KEY environment variable must be a 32-character string.');
}
const key = Buffer.from(ENCRYPTION_KEY, 'utf-8');

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
 * Decrypts a Base64 string back into its original form (string or object).
 * @param encryptedData The Base64 encrypted string.
 * @returns The decrypted data. Returns the original string if decryption fails.
 */
export async function decrypt(encryptedData: string | object): Promise<any> {
    // If data is not a string, it's likely already decrypted or not encrypted.
    if (typeof encryptedData !== 'string') {
        return encryptedData;
    }
    
    try {
        const buffer = Buffer.from(encryptedData, 'base64');
        const iv = buffer.slice(0, IV_LENGTH);
        const authTag = buffer.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
        const encrypted = buffer.slice(IV_LENGTH + AUTH_TAG_LENGTH);
        
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
        
        try {
            // Attempt to parse as JSON, if it fails, return as plain text
            return JSON.parse(decrypted);
        } catch {
            return decrypted;
        }
    } catch (error) {
        // If decryption fails (e.g., not encrypted, wrong key, corrupted),
        // return the original string. This handles legacy unencrypted data.
        // console.warn('Decryption failed for a value, returning original. This may be expected for legacy data.');
        return encryptedData;
    }
}
