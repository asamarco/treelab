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
import { generateClientSideId } from './utils';
import crypto from 'crypto';


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
  await connectToDatabase();
  const users = await UserModel.find().lean<User[]>().exec();
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
    const user = await UserModel.findOne({ username: identifier }).select('+passwordHash +salt').exec();
    if (!user) {
        console.warn(`WARN: Failed login attempt for identifier '${identifier}': User not found.`);
        return null;
    }
    
    // Handle legacy users without a salt
    if (!user.salt) {
        console.warn(`WARN: Failed login attempt for username '${user.username}': Account is missing a password salt and cannot be authenticated.`);
        return null;
    }

    const passwordHash = await hashPassword(password, user.salt);

    if (passwordHash === user.passwordHash) {
        console.log(`INFO: User '${user.username}' logged in successfully.`);
        const { passwordHash, salt, ...userToReturn } = toPlainObject(user);
        
        if (userToReturn.gitSettings?.githubPat) {
          userToReturn.gitSettings.githubPat = await decrypt(userToReturn.gitSettings.githubPat);
        }

        return userToReturn;
    }

    console.warn(`WARN: Failed login attempt for username '${user.username}': Invalid password.`);
    return null;
}

export async function registerUser(username: string, password: string): Promise<User | null> {
    await connectToDatabase();
    const existingUsers = await UserModel.find().lean<User[]>().exec();
    if (existingUsers.some(u => u.username === username)) {
      console.warn(`WARN: Registration failed: Username '${username}' already exists.`);
      return null; 
    }
    
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = await hashPassword(password, salt);

    const newUserDoc: Omit<User, 'id'> = {
      username,
      passwordHash,
      salt,
      isAdmin: existingUsers.length === 0,
    };
    
    const createdUser = await new UserModel(newUserDoc).save();
    const { passwordHash: savedHash, salt: savedSalt, ...userToReturn } = toPlainObject(createdUser);
    return userToReturn;
}

export async function addUser(userData: Omit<User, 'id' | 'passwordHash' | 'salt'> & { password?: string }): Promise<User> {
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
    await connectToDatabase();
    await UserModel.findByIdAndUpdate(userId, { isAdmin }).exec();
}

export async function deleteUser(userId: string): Promise<void> {
    await connectToDatabase();
    const userToDelete = await UserModel.findById(userId);
    if (!userToDelete) return;

    await TreeModel.deleteMany({ userId: userId });
    await TreeNodeModel.deleteMany({ userId: userId });
    await UserModel.findByIdAndDelete(userId);
    console.log(`INFO: Deleted user ${userId} and all associated data.`);
}

export async function changeUserPassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
    await connectToDatabase();
    const user = await UserModel.findById(userId).select('+passwordHash +salt').exec();
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
    await connectToDatabase();
    
    const newSalt = crypto.randomBytes(16).toString('hex');
    const newPasswordHash = await hashPassword(newPassword, newSalt);
    await UserModel.findByIdAndUpdate(userId, { passwordHash: newPasswordHash, salt: newSalt }).exec();
}

export async function updateUserSettings(userId: string, settings: Partial<Pick<User, 'theme' | 'lastActiveTreeId' | 'gitSettings' | 'dateFormat'>>): Promise<void> {
    await connectToDatabase();

    const settingsToSave = { ...settings };

    // Check if gitSettings are being updated and if the PAT is present
    if (settingsToSave.gitSettings?.githubPat) {
        settingsToSave.gitSettings.githubPat = await encrypt(settingsToSave.gitSettings.githubPat);
    }
    
    await UserModel.findByIdAndUpdate(userId, settingsToSave).exec();
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
  await connectToDatabase();
  await GlobalSettingsModel.updateOne({}, { $set: settings }, { upsert: true }).exec();
}
