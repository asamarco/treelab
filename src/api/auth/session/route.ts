/**
 * @fileoverview
 * This API route checks for a valid user session by verifying the
 * JWT stored in the session cookie. If the session is valid, it returns
 * the current user's data.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { UserModel } from '@/lib/models';
import { decrypt } from '@/lib/encryption';
import { connectToDatabase } from '@/lib/mongodb';

// Helper to convert a Mongoose doc to a plain object.
const toPlainObject = (doc: any): any => {
    if (!doc) return null;
    const obj = doc.toObject ? doc.toObject({getters: true, virtuals: true}) : doc;
    const plain: any = { id: obj._id.toString() };
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key) && key !== '_id' && key !== '__v') {
            plain[key] = obj[key];
        }
    }
    return plain;
};


export async function GET(request: NextRequest) {
  const session = await getSession();

  if (session?.userId) {
    await connectToDatabase();
    const userDoc = await UserModel.findById(session.userId).lean().exec();

    if (userDoc) {
      const { passwordHash, salt, ...userToReturn } = toPlainObject(userDoc);
      
      if (userToReturn.gitSettings?.githubPat) {
        try {
          userToReturn.gitSettings.githubPat = await decrypt(userToReturn.gitSettings.githubPat);
        } catch(e) {
          console.error("Failed to decrypt PAT for session user", e);
          // Return user without PAT if decryption fails
          delete userToReturn.gitSettings.githubPat;
        }
      }

      return NextResponse.json(userToReturn);
    }
  }

  // Return 200 with null instead of 401 to avoid unnecessary console errors
  // during initial app load when no user is signed in.
  return NextResponse.json(null);
}
