import { useState, useEffect, useCallback } from "react";
import { User, GlobalSettings, GitSettings } from "@/lib/types";
import {
    fetchUsers,
    addUser as addUserOnServer,
    updateUserAdminStatus as updateUserAdminStatusOnServer,
    deleteUser as deleteUserOnClient,
    changeUserPassword,
    resetUserPasswordByAdmin as resetPasswordByAdminOnServer,
    saveGlobalSettings,
    updateUserSettings,
} from '@/lib/auth-service';
import {
    login as loginOnClient,
    logout as logoutOnClient,
    getSessionUser,
    register as registerOnClient
} from '@/lib/auth-client';
import { loadGlobalSettings } from "@/lib/auth-service";
import { useIdleTimer } from "./use-idle-timer";
import { useToast } from "./use-toast";

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
  const { toast } = useToast();

  const handleLogout = useCallback(async (isIdle: boolean = false) => {
    if (currentUser) {
        if(isIdle) {
            toast({
                title: "You have been logged out",
                description: "Your session has ended due to inactivity.",
            });
        }
        console.log(`INFO: User '${currentUser.username}' logged out.`);
    }
    await logoutOnClient();
    setCurrentUser(null);
    setUsers([]); // Clear users on logout
    
    // Fail-safe redirect for idle logout
    if (isIdle) {
      window.location.href = '/login?reason=idle';
    } else {
      window.location.href = '/login';
    }
  }, [currentUser, toast]);

  const inactivityTimeoutMinutes = currentUser?.inactivityTimeoutMinutes;
  const idleTime = typeof inactivityTimeoutMinutes === 'number' && inactivityTimeoutMinutes > 0 
    ? inactivityTimeoutMinutes * 60 * 1000 
    : 0;

  useIdleTimer(() => handleLogout(true), idleTime);


  const initializeAuth = async () => {
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
        setUsers([dummyUser]);
        setIsAuthLoading(false);
        return;
    }

    try {
      const [userFromSession, loadedSettings] = await Promise.all([
          getSessionUser(),
          loadGlobalSettings(),
      ]);
      
      if (loadedSettings) {
        setAppSettings(loadedSettings);
      }
      
      setCurrentUser(userFromSession);
      
      if (userFromSession) {
          const allUsers = await fetchUsers(); // Only fetch all users if logged in
          setUsers(allUsers);
          console.log(`INFO: Restored user '${userFromSession.username}' and fetched all users.`);
      }

    } catch (error) {
      console.error("ERROR: Failed to initialize auth:", error);
    } finally {
      setIsAuthLoading(false);
    }
  };
  
  useEffect(() => {
    initializeAuth();
  }, [isAuthRequired, defaultUserId]);


  // Add a periodic check for session validity
  useEffect(() => {
    if (!isAuthRequired || typeof window === 'undefined') return;

    const interval = setInterval(async () => {
        if (document.cookie.includes('session=')) {
            const user = await getSessionUser();
            if (!user) {
                console.log("INFO: Session expired, logging out user.");
                handleLogout();
            }
        }
    }, 60 * 1000); // Check every 60 seconds

    return () => clearInterval(interval);
  }, [isAuthRequired, handleLogout]);


  // Persist user profile changes
  useEffect(() => {
    if (isAuthRequired && currentUser) {
      updateUserSettings({
          theme: currentUser.theme,
          lastActiveTreeId: currentUser.lastActiveTreeId,
          gitSettings: currentUser.gitSettings,
          dateFormat: currentUser.dateFormat,
          inactivityTimeoutMinutes: currentUser.inactivityTimeoutMinutes,
      });
    }
  }, [isAuthRequired, currentUser]);


  const handleLogin = async (identifier: string, password: string): Promise<boolean> => {
    const user = await loginOnClient(identifier, password);
    if (user) {
        setCurrentUser(user);
        const allUsers = await fetchUsers(); // Fetch all users on login
        setUsers(allUsers);
        return true;
    }
    return false;
  };

  const handleRegister = async (username: string, password: string): Promise<boolean> => {
    const newUser = await registerOnClient(username, password);
    if (newUser) {
        setCurrentUser(newUser);
        const allUsers = await fetchUsers(); // Fetch all users on register
        setUsers(allUsers);
        console.log(`INFO: User '${username}' registered and logged in.`);
        window.location.href = '/';
        return true;
    }
    return false;
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
    const newUser = await addUserOnServer({ username, password, isAdmin });
    if (newUser) {
        setUsers([...users, newUser]);
        console.log(`INFO: Admin '${currentUser.username}' created new user '${username}'.`);
        return true;
    }
    return false;
  };

  const updateUserAdminStatus = async (userId: string, isAdmin: boolean) => {
    if (!currentUser?.isAdmin) return;
    await updateUserAdminStatusOnServer(userId, isAdmin);
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
    return await changeUserPassword(currentPassword, newPassword);
  };
  
  const resetPasswordByAdmin = async (userId: string, newPassword: string): Promise<void> => {
    if (!currentUser?.isAdmin) return;
    await resetPasswordByAdminOnServer(userId, newPassword);
  };

  const setTheme = (newTheme: Theme) => {
    if (!isAuthRequired || !currentUser) return;
    setCurrentUser(prev => prev ? { ...prev, theme: newTheme } : null);
  }
  
  const setDateFormat = (newFormat: string) => {
    if (!isAuthRequired || !currentUser) return;
    setCurrentUser(prev => prev ? { ...prev, dateFormat: newFormat } : null);
  };

  const setInactivityTimeout = (minutes: number) => {
    if (!isAuthRequired || !currentUser) return;
    setCurrentUser(prev => prev ? { ...prev, inactivityTimeoutMinutes: minutes } : null);
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
    register: handleRegister,
    logout: handleLogout,
    addUserByAdmin,
    updateUserAdminStatus,
    deleteUser,
    changePassword,
    resetPasswordByAdmin,
    setTheme,
    setDateFormat,
    setInactivityTimeout,
    setGitSettings,
    setLastActiveTreeId,
  };
}
