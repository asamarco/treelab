
/**
 * @fileoverview
 * This file defines the context for managing all UI state.
 * It handles state that affects the overall user interface but is not directly
 * tied to authentication or tree data, such as dialog visibility or view modes.
 */
"use client";

import React, { createContext, useContext, ReactNode, useState, useEffect, useMemo, useCallback } from "react";
import { User, GlobalSettings, GitSettings } from "@/lib/types";
import { useAuth as useAuthHook } from "@/hooks/useAuth";

type Theme = "light" | "dark" | "system";

interface AuthContextType {
  // Auth & User Management
  currentUser: User | null;
  isAuthLoading: boolean;
  isAuthRequired: boolean;
  users: User[];
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  addUserByAdmin: (username: string, password: string, isAdmin: boolean) => Promise<boolean>;
  updateUserAdminStatus: (userId: string, isAdmin: boolean) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
  resetPasswordByAdmin: (userId: string, newPassword: string) => Promise<void>;
  
  // User & Global Settings
  theme: Theme;
  setTheme: (theme: Theme) => void;
  dateFormat: string;
  setDateFormat: (format: string) => void;
  globalSettings: GlobalSettings;
  setGlobalSettings: (settings: GlobalSettings) => Promise<void>;
  setGitSettings: (gitSettings: GitSettings) => Promise<void>;
  setLastActiveTreeId: (treeId: string | null) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
  isAuthRequired: boolean;
  defaultUserId: string;
}

export function AuthProvider({ children, isAuthRequired, defaultUserId }: AuthProviderProps) {
  const {
    currentUser,
    isAuthLoading,
    users,
    globalSettings,
    setAppSettings,
    login,
    register,
    logout,
    addUserByAdmin,
    updateUserAdminStatus,
    deleteUser,
    changePassword,
    resetPasswordByAdmin,
    setTheme: setAuthTheme,
    setGitSettings,
    setLastActiveTreeId,
    setDateFormat: setAuthDateFormat,
  } = useAuthHook({ isAuthRequired, defaultUserId });

  const [theme, setThemeState] = useState<Theme>("system");
  const dateFormat = useMemo(() => currentUser?.dateFormat || 'dd/MM/yyyy', [currentUser]);

  useEffect(() => {
    if (currentUser?.theme) {
      setThemeState(currentUser.theme);
    }
  }, [currentUser?.theme]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);
  
  const handleSetTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    if (isAuthRequired) {
      setAuthTheme(newTheme);
    }
  }

  const value: AuthContextType = {
    currentUser,
    isAuthLoading,
    isAuthRequired,
    users,
    login,
    register,
    logout,
    addUserByAdmin,
    updateUserAdminStatus,
    deleteUser,
    changePassword,
    resetPasswordByAdmin,
    theme,
    setTheme: handleSetTheme,
    dateFormat,
    setDateFormat: setAuthDateFormat,
    globalSettings,
    setGlobalSettings: setAppSettings,
    setGitSettings,
    setLastActiveTreeId,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  return context;
}
