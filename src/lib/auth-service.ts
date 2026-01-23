/**
 * @fileoverview
 * This file contains all server-side logic for authentication and user management.
 * It directly interacts with the database and should only be called from server
 * components or other server actions.
 */
'use server';

import { connectToDatabase } from './mongodb';
import { UserModel, GlobalSettingsModel, TreeModel, TreeNodeModel } from './models';
import { User, GlobalSettings } from './types';
import { encrypt, decrypt } from './encryption';
import { createSessionInServerAction, getSession } from './session';
import crypto from 'crypto';
import { unstable_noStore as noStore } from 'next/cache';

// --- Password Hashing (Server-Side only) ---
const hashPassword = (password: string, salt: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, derivedKey) => {
            if (err) reject(err);
            resolve(derivedKey.toString('hex'));
        });
    });
};


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

// --- User Functions ---

export async function fetchUsers(): Promise<User[]> {
  // This is critical to prevent Next.js from caching the user list across different user sessions.
    noStore();
    const session = await getSession();
  if (!session?.userId) {
      // While this returns public info, it should still only be available to logged-in users.
      throw new Error("Authentication required to fetch users.");
  }
  
    await connectToDatabase();
    const users = await UserModel.find().select('-passwordHash -salt').lean<User[]>().exec();
  const decryptedUsers = await Promise.all(
        users.map(async (u: any) => {
            const plainUser = toPlainObject(u);
            if (plainUser.gitSettings?.githubPat) {
                plainUser.gitSettings.githubPat = await decrypt(plainUser.gitSettings.githubPat);
            }
            return plainUser;
        })
    );
  return decryptedUsers;
}


export async function validateLogin(identifier: string, password: string): Promise<User | null> {
    await connectToDatabase();
    
    // Avoid NoSQL Injection
    const safeIdentifier = String(identifier);
    const safePassword = String(password);

    const user = await UserModel.findOne({ username: safeIdentifier })
        .select('+passwordHash +salt')
        .exec();

    if (!user || !user.salt) {
        console.warn(`WARN: Login failed for identifier '${safeIdentifier}'`);
        return null;
    }

    const passwordHash = await hashPassword(safePassword, user.salt);

    if (passwordHash === user.passwordHash) {
        const { passwordHash: _ph, salt: _s, ...userToReturn } = toPlainObject(user);
        if (userToReturn.gitSettings?.githubPat) {
            userToReturn.gitSettings.githubPat = await decrypt(userToReturn.gitSettings.githubPat);
        }
        return userToReturn;
    }

    return null;
}

export async function registerUser(username: string, password: string): Promise<User | null> {
    await connectToDatabase();
    const safeUsername = String(username);
    
    const globalSettings = await loadGlobalSettings();
    if (!globalSettings?.allowPublicRegistration) {
        throw new Error("Registration disabled.");
    }
    
    const exists = await UserModel.exists({ username: safeUsername });
    if (exists) return null; 
    
    const isFirstUser = (await UserModel.countDocuments({})) === 0;
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = await hashPassword(password, salt);

    const newUserDoc = {
        username: safeUsername,
        passwordHash,
        salt,
        isAdmin: isFirstUser, 
    };
    
    const createdUser = await new UserModel(newUserDoc).save();
    const userToReturn = toPlainObject(createdUser);
    await createSessionInServerAction(userToReturn.id);
    
    return userToReturn;
}

export async function addUser(userData: Omit<User, 'id' | 'passwordHash' | 'salt'> & { password?: string }): Promise<User> {
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    const adminUser = await UserModel.findById(session.userId);
    if (!adminUser || !adminUser.isAdmin) throw new Error("Admin privileges required.");

    await connectToDatabase();
    const { password, ...rest } = userData;
    if (!password) throw new Error("Password is required for new user");
    
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = await hashPassword(password, salt);

    const newUser = new UserModel({ ...rest, passwordHash, salt });
    await newUser.save();
    const { passwordHash: savedHash, salt: savedSalt, ...userToReturn } = toPlainObject(newUser);
    return userToReturn;
}

export async function updateUserAdminStatus(userId: string, isAdmin: boolean): Promise<void> {
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    const adminUser = await UserModel.findById(session.userId);
    if (!adminUser || !adminUser.isAdmin) throw new Error("Admin privileges required.");
    if(session.userId === userId) throw new Error("Admins cannot change their own status.");

    await connectToDatabase();
    await UserModel.findByIdAndUpdate(userId, { isAdmin }).exec();
}

export async function deleteUser(userId: string): Promise<void> {
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    const adminUser = await UserModel.findById(session.userId);
    if (!adminUser || !adminUser.isAdmin) throw new Error("Admin privileges required.");
    if(session.userId === userId) throw new Error("Users cannot delete themselves.");

    await connectToDatabase();
    const userToDelete = await UserModel.findById(userId);
    if (!userToDelete) return;

    await TreeModel.deleteMany({ userId: userId });
    await TreeNodeModel.deleteMany({ userId: userId });
    await UserModel.findByIdAndDelete(userId);
    console.log(`INFO: Deleted user ${userId} and all associated data.`);
}

export async function changeUserPassword(currentPassword: string, newPassword: string): Promise<boolean> {
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    await connectToDatabase();
    const user = await UserModel.findById(session.userId).select('+passwordHash +salt').exec();
    if (!user) return false;

    // Handle legacy users without a salt - they must reset their password.
    if (!user.salt) return false;

    const currentPasswordHash = await hashPassword(currentPassword, user.salt);

    if (currentPasswordHash !== user.passwordHash) return false;
    
    // Generate a new salt when changing the password
    const newSalt = crypto.randomBytes(16).toString('hex');
    const newPasswordHash = await hashPassword(newPassword, newSalt);
    user.passwordHash = newPasswordHash;
    user.salt = newSalt;
    await user.save();
    return true;
}

export async function resetUserPasswordByAdmin(userId: string, newPassword: string): Promise<void> {
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    const adminUser = await UserModel.findById(session.userId);
    if (!adminUser || !adminUser.isAdmin) throw new Error("Admin privileges required.");

    await connectToDatabase();

    const newSalt = crypto.randomBytes(16).toString('hex');
    const newPasswordHash = await hashPassword(newPassword, newSalt);
    await UserModel.findByIdAndUpdate(userId, { passwordHash: newPasswordHash, salt: newSalt }).exec();
}

export async function updateUserSettings(settings: Partial<Pick<User, 'theme' | 'lastActiveTreeId' | 'gitSettings' | 'dateFormat' | 'inactivityTimeoutMinutes'>>): Promise<void> {
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    await connectToDatabase();

    const settingsToSave = { ...settings };

    // Check if gitSettings are being updated and if the PAT is present
    if (settingsToSave.gitSettings?.githubPat) {
        settingsToSave.gitSettings.githubPat = await encrypt(settingsToSave.gitSettings.githubPat);
    }
    
    await UserModel.findByIdAndUpdate(session.userId, settingsToSave).exec();
}


// --- GlobalSettings Functions ---

export async function loadGlobalSettings(): Promise<GlobalSettings | null> {
    await connectToDatabase();
  let settings = await GlobalSettingsModel.findOne().lean<GlobalSettings>().exec();
  
  if (settings) {
    return toPlainObject(settings);
  }
  
  const defaultSettings = new GlobalSettingsModel({ allowPublicRegistration: true });
  const savedSettings = await defaultSettings.save();
  return toPlainObject(savedSettings);
}

export async function saveGlobalSettings(settings: Partial<GlobalSettings>): Promise<void> {
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");
    const adminUser = await UserModel.findById(session.userId);
    if (!adminUser || !adminUser.isAdmin) throw new Error("Admin privileges required.");
    
    await connectToDatabase();
    // Ensure that customLogoPath is not set to an empty string, but rather removed if empty
    const updateData: Partial<GlobalSettings> & { updatedAt?: string } = { ...settings, updatedAt: new Date().toISOString() };
    if ('customLogoPath' in updateData && !updateData.customLogoPath) {
        delete updateData.customLogoPath;
        await GlobalSettingsModel.updateOne({}, { $set: updateData, $unset: { customLogoPath: 1 } }, { upsert: true }).exec();
    } else {
        await GlobalSettingsModel.updateOne({}, { $set: updateData }, { upsert: true }).exec();
    }
}
