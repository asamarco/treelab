

/**
 * @fileoverview
 * This file defines the Settings page for the application. It is a protected route.
 *
 * This page allows users to configure various aspects of the application:
 * 1.  Appearance: Users can switch between 'light', 'dark', and 'system' themes.
 * 2.  User Management (Admins only): Admins can manage other users, including
 *     deleting them or changing their admin status.
 */
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { AppHeader } from "@/components/header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuthContext } from "@/contexts/auth-context";
import { useTreeContext } from "@/contexts/tree-context";
import { Separator } from "@/components/ui/separator";
import { ProtectedRoute } from "@/components/protected-route";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Trash2, Shield, ShieldOff, UserRoundPlus, KeyRound, DatabaseZap, Github, Upload, Image } from "lucide-react";
import { User, StorageInfo } from "@/lib/types";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatBytes } from "@/lib/utils";
import Link from "next/link";
import { Logo } from "@/components/logo";

const DATE_FORMATS = [
    { value: "dd/MM/yyyy", label: "DD/MM/YYYY" },
    { value: "MM/dd/yyyy", label: "MM/DD/YYYY" },
    { value: "yyyy-MM-dd", label: "YYYY-MM-DD" },
    { value: "PPP", label: "Month Day, Year" },
];

function SettingsPage() {
  const { 
    theme, 
    setTheme, 
    currentUser,
    users,
    globalSettings,
    setGlobalSettings,
    addUserByAdmin,
    updateUserAdminStatus,
    deleteUser,
    changePassword,
    resetPasswordByAdmin,
    setGitSettings,
    setDateFormat,
    setInactivityTimeout,
  } = useAuthContext();
  
  const { analyzeStorage, purgeStorage } = useTreeContext();

  const { toast } = useToast();
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserIsAdmin, setNewUserIsAdmin] = useState(false);
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
  const [userToReset, setUserToReset] = useState<User | null>(null);
  const [passwordForReset, setPasswordForReset] = useState("");
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [githubPat, setGithubPat] = useState(currentUser?.gitSettings?.githubPat || "");
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(globalSettings?.customLogoPath || null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [inactivityTimeout, setInactivityTimeoutState] = useState(currentUser?.inactivityTimeoutMinutes ?? 15);


  useEffect(() => {
    setLogoPreview(globalSettings?.customLogoPath || '/favicon.svg');
  }, [globalSettings]);
  
  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== "image/svg+xml") {
        toast({ variant: "destructive", title: "Invalid File Type", description: "Please upload an SVG file for the logo." });
        return;
      }
      const reader = new FileReader();
      reader.onload = (readEvent) => {
        setLogoPreview(readEvent.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLogoUpload = async () => {
    const file = logoInputRef.current?.files?.[0];
    if (!file) {
      toast({ variant: "destructive", title: "No file selected" });
      return;
    }

    setIsUploadingLogo(true);
    const formData = new FormData();
    formData.append("logo", file);

    try {
      const response = await fetch('/api/upload/logo', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Logo upload failed');
      }

      const { path } = await response.json();
      await setGlobalSettings({ ...globalSettings, customLogoPath: path });
      
      toast({ title: "Logo Updated", description: "Your new logo has been saved." });
      
    } catch (error) {
      toast({ variant: "destructive", title: "Upload Failed", description: "Could not save the new logo." });
    } finally {
      setIsUploadingLogo(false);
    }
  };


  const fetchStorageInfo = useCallback(async () => {
    if (!currentUser) return;
    setIsAnalyzing(true);
    try {
        const info = await analyzeStorage();
        setStorageInfo(info);
    } catch (err) {
        console.error("Failed to analyze storage", err);
        setStorageInfo(null);
    } finally {
        setIsAnalyzing(false);
    }
  }, [currentUser, analyzeStorage]);

  useEffect(() => {
    fetchStorageInfo();
  }, [fetchStorageInfo]);
  
  useEffect(() => {
    if (currentUser?.gitSettings?.githubPat) {
      setGithubPat(currentUser.gitSettings.githubPat);
    }
    if (currentUser?.inactivityTimeoutMinutes !== undefined) {
      setInactivityTimeoutState(currentUser.inactivityTimeoutMinutes);
    }
  }, [currentUser]);


  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newUserPassword.length < 6) {
       toast({ variant: "destructive", title: "Password too short", description: "Password must be at least 6 characters long." });
       return;
    }
    const success = await addUserByAdmin(newUserUsername, newUserPassword, newUserIsAdmin);
    if (success) {
      toast({ title: "User Created", description: `Account for ${newUserUsername} has been created.` });
      setIsCreateUserOpen(false);
      setNewUserUsername("");
      setNewUserPassword("");
      setNewUserIsAdmin(false);
    } else {
      toast({ variant: "destructive", title: "Creation Failed", description: "A user with this username already exists." });
    }
  };

  const handleAdminStatusChange = async (user: User, isAdmin: boolean) => {
    await updateUserAdminStatus(user.id, isAdmin);
    toast({
      title: "User Updated",
      description: `${user.username}'s admin status has been changed.`,
    });
  };

  const handleDeleteUser = async (userId: string) => {
    await deleteUser(userId);
    toast({
      title: "User Deleted",
      description: "The user has been permanently deleted.",
    });
  };
  
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "Passwords do not match",
        description: "Please re-enter your new password and confirmation.",
      });
      return;
    }
    if (newPassword.length < 6) {
       toast({
        variant: "destructive",
        title: "Password too short",
        description: "Your new password must be at least 6 characters long.",
      });
      return;
    }

    setIsChangingPassword(true);
    const success = await changePassword(currentPassword, newPassword);

    if (success) {
      toast({
        title: "Password Changed",
        description: "Your password has been updated successfully.",
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } else {
      toast({
        variant: "destructive",
        title: "Password Change Failed",
        description: "Your current password was incorrect. Please try again.",
      });
    }
    setIsChangingPassword(false);
  };
  
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userToReset || passwordForReset.length < 6) {
        toast({ variant: "destructive", title: "Password too short", description: "New password must be at least 6 characters long." });
        return;
    }
    await resetPasswordByAdmin(userToReset.id, passwordForReset);
    toast({ title: "Password Reset", description: `Password for ${userToReset.username} has been changed.` });
    setIsResetPasswordOpen(false);
    setUserToReset(null);
    setPasswordForReset("");
  };

  const handlePurge = async () => {
    if (!currentUser) return;
    toast({title: "Purging files...", description: "This may take a moment."})
    const result = await purgeStorage();
    if(result) {
       toast({title: "Purge Complete", description: `${result.purgedCount} files removed, freeing ${formatBytes(result.purgedSize)}.`})
       fetchStorageInfo();
    } else {
       toast({variant: "destructive", title: "Purge Failed", description: "Could not purge files. Please try again."})
    }
 }

 const handleSaveGitSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await setGitSettings({ githubPat });
    toast({ title: "Settings Saved", description: "Your GitHub token has been updated." });
  };
  
  const handleInactivityTimeoutSave = () => {
    setInactivityTimeout(inactivityTimeout);
    toast({ title: "Settings Saved", description: "Your inactivity timeout has been updated." });
  };


  return (
    <ProtectedRoute>
      <div className="flex flex-col min-h-screen bg-muted/20">
        <AppHeader />
        <main className="flex-1 container mx-auto p-4 md:p-8">
          <div className="max-w-2xl mx-auto space-y-8">
            <h1 className="text-3xl font-bold">Settings</h1>
            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
                <CardDescription>
                  Customize the look and feel of the application. Your preference will be saved to your profile.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <Label>Theme</Label>
                  <p className="text-sm text-muted-foreground">
                    Select the theme for the application.
                  </p>
                  <RadioGroup
                    onValueChange={(value) => setTheme(value as "light" | "dark" | "system")}
                    value={theme}
                    className="grid max-w-md grid-cols-1 sm:grid-cols-3 gap-8 pt-2"
                  >
                    <div>
                      <RadioGroupItem
                        value="light"
                        id="light"
                        className="peer sr-only"
                      />
                      <Label
                        htmlFor="light"
                        className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary"
                      >
                        <div className="flex flex-col items-center">
                          <div className="w-16 h-10 rounded-lg bg-white border-2 border-primary mb-2"></div>
                          Light
                        </div>
                      </Label>
                    </div>
                    <div>
                      <RadioGroupItem
                        value="dark"
                        id="dark"
                        className="peer sr-only"
                      />
                      <Label
                        htmlFor="dark"
                        className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary"
                      >
                        <div className="flex flex-col items-center">
                          <div className="w-16 h-10 rounded-lg bg-gray-900 border-2 border-primary mb-2"></div>
                          Dark
                        </div>
                      </Label>
                    </div>
                    <div>
                      <RadioGroupItem
                        value="system"
                        id="system"
                        className="peer sr-only"
                      />
                      <Label
                        htmlFor="system"
                        className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary"
                      >
                        <div className="flex flex-col items-center">
                          <div className="w-16 h-10 rounded-lg bg-gradient-to-r from-white to-gray-900 border-2 border-primary mb-2"></div>
                          System
                        </div>
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
                 <div className="space-y-4 pt-4">
                  <Label>Date Format</Label>
                  <p className="text-sm text-muted-foreground">
                    Select the display format for dates throughout the application.
                  </p>
                   <Select
                    value={currentUser?.dateFormat || 'dd/MM/yyyy'}
                    onValueChange={setDateFormat}
                   >
                    <SelectTrigger className="max-w-md">
                      <SelectValue placeholder="Select date format" />
                    </SelectTrigger>
                    <SelectContent>
                      {DATE_FORMATS.map(f => (
                        <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {currentUser?.isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle>Branding</CardTitle>
                <CardDescription>
                  Customize the application logo. Use an SVG for best results.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-md border p-2 flex items-center justify-center bg-card">
                    {logoPreview ? (
                        <img src={logoPreview} alt="Logo preview" className="max-w-full max-h-full" />
                    ) : (
                        <Image className="w-12 h-12 text-muted-foreground"/>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="logo-upload">Custom Logo (SVG)</Label>
                    <Input id="logo-upload" type="file" accept="image/svg+xml" ref={logoInputRef} onChange={handleLogoFileChange} />
                  </div>
                </div>
                <div className="flex justify-end">
                    <Button onClick={handleLogoUpload} disabled={isUploadingLogo}>
                        {isUploadingLogo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4"/>}
                        Upload Logo
                    </Button>
                </div>
              </CardContent>
            </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Security</CardTitle>
                <CardDescription>
                  Manage your account security settings.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="current-password">Current Password</Label>
                    <Input
                      id="current-password"
                      type="password"
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-password">New Password</Label>
                    <Input
                      id="new-password"
                      type="password"
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirm New Password</Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={isChangingPassword}>
                      {isChangingPassword ? <Loader2 className="animate-spin mr-2" /> : null}
                      Change Password
                    </Button>
                  </div>
                </form>
                 <Separator />
                 <div className="space-y-4">
                    <Label>Automatic Logout</Label>
                    <p className="text-sm text-muted-foreground">
                        Set the number of minutes of inactivity before you are automatically logged out. Set to 0 to disable.
                    </p>
                    <div className="flex items-center justify-between p-2 rounded-md">
                        <div className="flex items-center gap-2">
                            <Input
                                id="inactivity-timeout"
                                type="number"
                                min="0"
                                value={inactivityTimeout}
                                onChange={(e) => setInactivityTimeoutState(Number(e.target.value))}
                                className="w-24"
                            />
                            <span className="text-sm text-muted-foreground">minutes</span>
                        </div>
                        <Button onClick={handleInactivityTimeoutSave}>
                          Save Timeout
                        </Button>
                    </div>
                </div>
              </CardContent>
            </Card>
            
             <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Github /> Git Integration
                </CardTitle>
                <CardDescription>
                  Connect your GitHub account to sync and version your trees.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSaveGitSettings} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="github-pat">GitHub Personal Access Token</Label>
                    <Input
                      id="github-pat"
                      type="password"
                      placeholder="ghp_..."
                      value={githubPat}
                      onChange={(e) => setGithubPat(e.target.value)}
                    />
                    <p className="text-sm text-muted-foreground">
                      This token is stored securely and is used to sync your trees with your GitHub repositories. 
                      You can create a token in your{" "}
                      <Link href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener noreferrer" className="underline">GitHub developer settings</Link>.
                    </p>
                  </div>
                   <div className="flex justify-end">
                    <Button type="submit">
                      Save Token
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Storage Management</CardTitle>
                    <CardDescription>
                        Analyze and clean up stored pictures and attachments.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {isAnalyzing ? (
                        <div className="flex justify-center items-center h-20">
                            <Loader2 className="animate-spin text-muted-foreground" />
                        </div>
                    ) : storageInfo ? (
                        <div className="space-y-4">
                            <div className="text-sm">
                                <p>Total space used: <span className="font-bold">{formatBytes(storageInfo.totalSize)}</span> across {storageInfo.totalCount} files.</p>
                                {storageInfo.purgeableSize > 0 && (
                                    <p className="text-destructive">
                                        You can free up <span className="font-bold">{formatBytes(storageInfo.purgeableSize)}</span> by deleting <span className="font-bold">{storageInfo.purgeableCount}</span> unreferenced files.
                                    </p>
                                )}
                                 {storageInfo.purgeableSize === 0 && (
                                    <p className="text-muted-foreground">
                                        There are no unreferenced files to purge.
                                    </p>
                                )}
                            </div>
                            <div className="flex justify-end">
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="destructive" disabled={storageInfo.purgeableCount === 0}>
                                            <DatabaseZap className="mr-2 h-4 w-4" /> Purge Unused Files
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This action will permanently delete {storageInfo.purgeableCount} files not referenced in any of your roots, freeing up {formatBytes(storageInfo.purgeableSize)}. This action cannot be undone.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={handlePurge} className="bg-destructive hover:bg-destructive/90">
                                                Delete Files
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </div>
                    ) : (
                        <p className="text-muted-foreground text-center">Could not load storage information.</p>
                    )}
                </CardContent>
            </Card>
            
            {currentUser?.isAdmin && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>User Management</CardTitle>
                    <CardDescription>
                      Manage user accounts and permissions.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center justify-between p-2 rounded-md">
                        <div className="flex items-center gap-2">
                            <Label htmlFor="allow-signups" className="font-medium">Allow Public Sign-ups</Label>
                        </div>
                        <Switch
                            id="allow-signups"
                            checked={globalSettings.allowPublicRegistration}
                            onCheckedChange={(checked) => setGlobalSettings({ ...globalSettings, allowPublicRegistration: checked })}
                        />
                    </div>
                    <Separator />
                    <div className="pt-2 flex justify-end">
                        <Dialog open={isCreateUserOpen} onOpenChange={setIsCreateUserOpen}>
                            <DialogTrigger asChild>
                                <Button>
                                    <UserRoundPlus className="mr-2 h-4 w-4"/>
                                    Create User
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <form onSubmit={handleCreateUser}>
                                    <DialogHeader>
                                        <DialogTitle>Create New User</DialogTitle>
                                    </DialogHeader>
                                    <div className="grid gap-4 py-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="new-username">Username</Label>
                                            <Input id="new-username" value={newUserUsername} onChange={e => setNewUserUsername(e.target.value)} required />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="new-password-admin">Password</Label>
                                            <Input id="new-password-admin" type="password" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} required />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Switch id="new-user-is-admin" checked={newUserIsAdmin} onCheckedChange={setNewUserIsAdmin} />
                                            <Label htmlFor="new-user-is-admin">Set as Administrator</Label>
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
                                        <Button type="submit">Create User</Button>
                                    </DialogFooter>
                                </form>
                            </DialogContent>
                        </Dialog>
                    </div>
                    {users.map((user) => (
                      <div key={user.id} className="flex items-center justify-between p-2 rounded-md hover:bg-accent">
                        <div>
                          <p className="font-medium flex items-center gap-2">
                            {user.username}
                            {user.isAdmin && <Shield className="h-4 w-4 text-primary" />}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                           <Dialog open={isResetPasswordOpen && userToReset?.id === user.id} onOpenChange={(open) => {if(!open) setUserToReset(null); setIsResetPasswordOpen(open); }}>
                                <DialogTrigger asChild>
                                    <Button variant="outline" size="sm" onClick={() => setUserToReset(user)} disabled={user.id === currentUser.id}>
                                        <KeyRound className="h-4 w-4"/>
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <form onSubmit={handleResetPassword}>
                                        <DialogHeader>
                                            <DialogTitle>Reset Password for {user.username}</DialogTitle>
                                        </DialogHeader>
                                        <div className="grid gap-4 py-4">
                                            <div className="space-y-2">
                                                <Label htmlFor="reset-password">New Password</Label>
                                                <Input id="reset-password" type="password" value={passwordForReset} onChange={e => setPasswordForReset(e.target.value)} required />
                                            </div>
                                        </div>
                                        <DialogFooter>
                                            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
                                            <Button type="submit">Reset Password</Button>
                                        </DialogFooter>
                                    </form>
                                </DialogContent>
                            </Dialog>
                          <div className="flex items-center gap-2">
                            <Label htmlFor={`admin-switch-${user.id}`} className="text-sm">Admin</Label>
                            <Switch
                              id={`admin-switch-${user.id}`}
                              checked={user.isAdmin}
                              onCheckedChange={(checked) => handleAdminStatusChange(user, checked)}
                              disabled={user.id === currentUser.id}
                            />
                          </div>
                           <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                disabled={user.id === currentUser.id}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This action cannot be undone. This will permanently delete the user account for "{user.username}".
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteUser(user.id)} className="bg-destructive hover:bg-destructive/90">
                                  Delete User
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}

export default SettingsPage;

    
    
    