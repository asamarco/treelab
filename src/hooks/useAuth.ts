

import { useState, useEffect, useCallback } from "react";
import { User, GlobalSettings, GitSettings } from "@/lib/types";
import { 
    fetchAllUsers, 
    login, 
    register, 
    addUserByAdmin as addUserByAdminOnClient,
    updateUserAdminStatus as updateUserAdminStatusOnClient,
    deleteUser as deleteUserOnClient,
    changePassword as changePasswordOnClient,
    resetPasswordByAdmin as resetPasswordByAdminOnClient,
    saveGlobalSettings,
    updateUserSettings,
} from '@/lib/auth-client';
import { loadGlobalSettings } from "@/lib/auth-service";

type Theme = "light" | "dark" | "system";

interface UseAuthProps {
    isAuthRequired: boolean;
    defaultUserId: string;
}

export function useAuth({ isAuthRequired, defaultUserId }: UseAuthProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [globalSettings, setAppSettings] = useState<GlobalSettings>({ allowPublicRegistration: true });

  const initializeAuth = useCallback(async () => {
    console.log("INFO: Initializing auth state...");
    
    if (!isAuthRequired) {
        console.log("INFO: Authentication not required. Using default user.");
        const dummyUser: User = {
            id: defaultUserId,
            username: defaultUserId,
            passwordHash: '',
            salt: '',
            isAdmin: true,
            dateFormat: 'dd/MM/yyyy',
        };
        setCurrentUser(dummyUser);
        setIsAuthLoading(false);
        return;
    }

    try {
      // Settings can be loaded on the client if needed, but users should be fetched via a server action
      const [loadedUsers, loadedSettings] = await Promise.all([
        fetchAllUsers(),
        loadGlobalSettings(),
      ]);

      setUsers(loadedUsers);
      if (loadedSettings) {
        setAppSettings(loadedSettings);
      }

      const storedUserJson = sessionStorage.getItem("currentUser");
      if (storedUserJson) {
        const userFromSession = JSON.parse(storedUserJson);
        const freshUser = loadedUsers.find(u => u.id === userFromSession.id);
        if (freshUser) {
            setCurrentUser(freshUser);
            console.log(`INFO: Restored user '${freshUser.username}' from session.`);
        }
      }
    } catch (error) {
      console.error("ERROR: Failed to initialize auth:", error);
    } finally {
      setIsAuthLoading(false);
    }
  }, [isAuthRequired, defaultUserId]);

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  // Persist user profile changes
  useEffect(() => {
    if (isAuthRequired && currentUser) {
      updateUserSettings(currentUser.id, {
          theme: currentUser.theme,
          lastActiveTreeId: currentUser.lastActiveTreeId,
          gitSettings: currentUser.gitSettings,
          dateFormat: currentUser.dateFormat,
      });
    }
  }, [isAuthRequired, currentUser?.theme, currentUser?.lastActiveTreeId, currentUser?.gitSettings, currentUser?.dateFormat]);


  const handleLogin = async (identifier: string, password: string): Promise<boolean> => {
    const user = await login(identifier, password);
    if (user) {
        setCurrentUser(user);
        sessionStorage.setItem("currentUser", JSON.stringify(user));
        return true;
    }
    return false;
  };

  const registerUser = async (username: string, password: string): Promise<boolean> => {
    if (!globalSettings.allowPublicRegistration) {
        console.error("ERROR: Registration attempt failed: Public registration is disabled.");
        return false;
    }
    const newUser = await register(username, password);
    if (newUser) {
        setUsers(prev => [...prev, newUser]);
        setCurrentUser(newUser);
        sessionStorage.setItem("currentUser", JSON.stringify(newUser));
        console.log(`INFO: User '${username}' registered and logged in. First user? ${newUser.isAdmin}`);
        window.location.href = '/';
        return true;
    }
    return false;
  };

  const logout = () => {
    if (currentUser) {
        console.log(`INFO: User '${currentUser.username}' logged out.`);
    }
    setCurrentUser(null);
    sessionStorage.removeItem("currentUser");
    localStorage.removeItem(`lastActiveTreeId_${currentUser?.id}`);
  };

  const addUserByAdmin = async (username: string, password: string, isAdmin: boolean): Promise<boolean> => {
    if (!currentUser?.isAdmin) {
      console.error("ERROR: Permission denied for creating user.");
      return false;
    }
    if (users.some(u => u.username === username)) {
      console.warn(`WARN: Admin failed to create user. Username '${username}' already exists.`);
      return false; 
    }
    const newUser = await addUserByAdminOnClient(username, password, isAdmin);
    if (newUser) {
        setUsers([...users, newUser]);
        console.log(`INFO: Admin '${currentUser.username}' created new user '${username}'.`);
        return true;
    }
    return false;
  };

  const updateUserAdminStatus = async (userId: string, isAdmin: boolean) => {
    if (!currentUser?.isAdmin) return;
    await updateUserAdminStatusOnClient(userId, isAdmin);
    const updatedUsers = users.map(user =>
      user.id === userId ? { ...user, isAdmin } : user
    );
    setUsers(updatedUsers);
  };

  const deleteUser = async (userId: string) => {
    if (!currentUser?.isAdmin || currentUser.id === userId) return;
    await deleteUserOnClient(userId);
    setUsers(users.filter(user => user.id !== userId));
  };
  
  const changePassword = async (currentPassword: string, newPassword: string): Promise<boolean> => {
    if (!currentUser) return false;
    return await changePasswordOnClient(currentUser.id, currentPassword, newPassword);
  };
  
  const resetPasswordByAdmin = async (userId: string, newPassword: string): Promise<void> => {
    if (!currentUser?.isAdmin) return;
    await resetPasswordByAdminOnClient(userId, newPassword);
  };

  const setTheme = (newTheme: Theme) => {
    if (!isAuthRequired || !currentUser) return;
    setCurrentUser(prev => prev ? { ...prev, theme: newTheme } : null);
  }
  
  const setDateFormat = (newFormat: string) => {
    if (!isAuthRequired || !currentUser) return;
    setCurrentUser(prev => prev ? { ...prev, dateFormat: newFormat } : null);
  };

  const setGlobalSettingsState = async (settings: GlobalSettings) => {
    await saveGlobalSettings(settings);
    setAppSettings(settings);
    console.log(`INFO: Global settings updated: ${JSON.stringify(settings)}`);
  };
  
  const setGitSettings = async (gitSettings: GitSettings) => {
    if (!currentUser) return;
    setCurrentUser(prev => prev ? { ...prev, gitSettings } : null);
  };

  const setLastActiveTreeId = (treeId: string | null) => {
    if (!isAuthRequired || !currentUser) return;
    setCurrentUser(prev => prev ? { ...prev, lastActiveTreeId: treeId } : null);
  };

  return {
    currentUser,
    isAuthLoading,
    users,
    globalSettings,
    setAppSettings: setGlobalSettingsState,
    login: handleLogin,
    register: registerUser,
    logout,
    addUserByAdmin,
    updateUserAdminStatus,
    deleteUser,
    changePassword,
    resetPasswordByAdmin,
    setTheme,
    setDateFormat,
    setGitSettings,
    setLastActiveTreeId,
  };
}
