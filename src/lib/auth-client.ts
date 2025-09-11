
/**
 * @fileoverview
 * This file contains client-side functions for interacting with the authentication service.
 * These functions are safe to call from client components (like hooks and pages) and
 * will invoke the corresponding server actions.
 */
"use client";

import { User, GlobalSettings, GitSettings } from './types';
import { 
    validateLogin, 
    registerUser, 
    fetchUsers, 
    updateUserAdminStatus as updateUserAdminStatusOnServer,
    deleteUser as deleteUserOnServer,
    addUser as addUserOnServer,
    changeUserPassword,
    resetUserPasswordByAdmin,
    saveGlobalSettings as saveGlobalSettingsOnServer,
    updateUserSettings as updateUserSettingsOnServer,
} from './auth-service';


export const login = async (identifier: string, password: string): Promise<User | null> => {
    return validateLogin(identifier, password);
};

export const register = async (username: string, password: string): Promise<User | null> => {
    return registerUser(username, password);
};

export const fetchAllUsers = async (): Promise<User[]> => {
    return fetchUsers();
};

export const addUserByAdmin = async (username: string, password: string, isAdmin: boolean): Promise<User | null> => {
    return addUserOnServer({ username, password, isAdmin });
};

export const updateUserAdminStatus = async (userId: string, isAdmin: boolean): Promise<void> => {
    return updateUserAdminStatusOnServer(userId, isAdmin);
};

export const deleteUser = async (userId: string): Promise<void> => {
    return deleteUserOnServer(userId);
};

export const changePassword = async (userId: string, currentPassword: string, newPassword: string): Promise<boolean> => {
    return changeUserPassword(userId, currentPassword, newPassword);
};

export const resetPasswordByAdmin = async (userId: string, newPassword: string): Promise<void> => {
    return resetUserPasswordByAdmin(userId, newPassword);
};

export const saveGlobalSettings = async (settings: GlobalSettings): Promise<void> => {
    return saveGlobalSettingsOnServer(settings);
};

export const updateUserSettings = async (userId: string, settings: Partial<Pick<User, 'theme' | 'lastActiveTreeId' | 'gitSettings' | 'dateFormat'>>): Promise<void> => {
    return updateUserSettingsOnServer(userId, settings);
};
