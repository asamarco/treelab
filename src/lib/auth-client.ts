/**
 * @fileoverview
 * This file contains client-side functions for interacting with the authentication service.
 * These functions are safe to call from client components (like hooks and pages) and
 * will invoke the corresponding API routes.
 */
"use client";

import { User } from './types';

export const login = async (identifier: string, password: string): Promise<User | null> => {
    const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
    });

    if (response.ok) {
        return await response.json();
    }
    return null;
};

export const register = async (username: string, password: string): Promise<User | null> => {
    // The register server action will handle both registration and login (session creation)
    const { registerUser } = await import('./auth-service');
    return registerUser(username, password);
};

export const logout = async (): Promise<void> => {
    await fetch('/api/auth/logout', { method: 'POST' });
};

export const getSessionUser = async (): Promise<User | null> => {
    try {
        const response = await fetch('/api/auth/session', {
            credentials: 'include',
        });
        if (response.ok) {
            return await response.json();
        }
        return null;
    } catch (error) {
        console.error("Failed to fetch session:", error);
        return null;
    }
};

// Functions that still call server actions directly (admin actions, etc.)
export { 
    fetchUsers, 
    addUser as addUserByAdmin,
    updateUserAdminStatus,
    deleteUser,
    changeUserPassword,
    resetUserPasswordByAdmin,
    saveGlobalSettings,
    updateUserSettings,
} from './auth-service';
