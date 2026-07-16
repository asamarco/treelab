/**
 * @fileoverview
 * Server-side service for managing Personal Access Tokens (PATs).
 * PATs allow programmatic API access via `Authorization: Bearer <token>`.
 *
 * Security model:
 * - Raw tokens are generated as `tlab_<48 hex chars>` and returned ONCE at creation.
 * - Only the SHA-256 hash of the token is stored in the database.
 * - The first 8 characters of the raw token (the "prefix") are stored for display.
 * - Expiry is optional; tokens default to never-expiring.
 */
'use server';

import crypto from 'crypto';
import { connectToDatabase } from './mongodb';
import { PersonalAccessTokenModel, PersonalAccessTokenDoc } from './models';
import { getSession } from './session';

// --- Helpers ---

const hashToken = (rawToken: string): string =>
  crypto.createHash('sha256').update(rawToken).digest('hex');

const toPublic = (doc: any): Omit<PersonalAccessTokenDoc, 'tokenHash'> => {
  const obj = doc.toObject ? doc.toObject({ getters: true, virtuals: true }) : doc;
  const { tokenHash: _th, _id, __v, ...rest } = obj;
  return { ...rest, id: (_id ?? rest.id)?.toString() };
};

// --- Public API ---

export interface CreateTokenResult {
  token: Omit<PersonalAccessTokenDoc, 'tokenHash'>;
  /** The raw token value. Shown ONLY once — store it securely. */
  rawToken: string;
}

/**
 * Creates a new Personal Access Token for the authenticated user.
 * The raw token is returned once and must be stored by the caller.
 */
export async function createPersonalAccessToken(
  name: string,
  expiresAt?: string | null,
): Promise<CreateTokenResult> {
  const session = await getSession();
  if (!session?.userId) throw new Error('Authentication required.');

  const safeName = String(name).trim();
  if (!safeName) throw new Error('Token name is required.');

  // Generate: tlab_ + 48 random hex chars = 53 chars total
  const randomPart = crypto.randomBytes(24).toString('hex'); // 48 hex chars
  const rawToken = `tlab_${randomPart}`;
  const prefix = rawToken.slice(0, 8); // "tlab_xxx"
  const tokenHash = hashToken(rawToken);

  await connectToDatabase();

  const doc = await new PersonalAccessTokenModel({
    userId: session.userId,
    name: safeName,
    tokenHash,
    prefix,
    ...(expiresAt ? { expiresAt } : {}),
  }).save();

  return { token: toPublic(doc), rawToken };
}

/**
 * Lists all PATs for the authenticated user (no hashes exposed).
 */
export async function listPersonalAccessTokens(): Promise<Omit<PersonalAccessTokenDoc, 'tokenHash'>[]> {
  const session = await getSession();
  if (!session?.userId) throw new Error('Authentication required.');

  await connectToDatabase();
  const docs = await PersonalAccessTokenModel
    .find({ userId: session.userId })
    .sort({ createdAt: -1 })
    .lean()
    .exec();

  return docs.map(toPublic);
}

/**
 * Revokes (deletes) a PAT by its ID. Enforces ownership.
 */
export async function revokePersonalAccessToken(tokenId: string): Promise<void> {
  const session = await getSession();
  if (!session?.userId) throw new Error('Authentication required.');

  await connectToDatabase();
  const result = await PersonalAccessTokenModel
    .findOneAndDelete({ _id: String(tokenId), userId: session.userId })
    .exec();

  if (!result) throw new Error('Token not found or access denied.');
}

/**
 * Validates a raw Bearer token string.
 * Returns the userId if valid, or null if invalid/expired.
 * Also updates `lastUsedAt` on success.
 */
export async function validatePersonalAccessToken(rawToken: string): Promise<string | null> {
  if (!rawToken || !rawToken.startsWith('tlab_')) return null;

  const tokenHash = hashToken(rawToken);

  await connectToDatabase();
  const doc = await PersonalAccessTokenModel
    .findOne({ tokenHash })
    .select('+tokenHash userId expiresAt')
    .exec();

  if (!doc) return null;

  // Check expiry
  if (doc.expiresAt && new Date(doc.expiresAt) < new Date()) {
    return null;
  }

  // Update lastUsedAt asynchronously (do not await to keep latency low)
  PersonalAccessTokenModel
    .findByIdAndUpdate(doc._id, { lastUsedAt: new Date().toISOString() })
    .exec()
    .catch(() => {});

  return doc.userId;
}
