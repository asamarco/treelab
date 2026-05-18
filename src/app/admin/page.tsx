"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AppHeader } from "@/components/header";
import { useAuthContext } from "@/contexts/auth-context";
import { useTreeContext } from "@/contexts/tree-context";
import { ProtectedRoute } from "@/components/protected-route";
import { useToast } from "@/hooks/use-toast";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
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
import { 
  Loader2, 
  UserRoundPlus, 
  Shield, 
  KeyRound, 
  Trash2, 
  DatabaseZap, 
  Upload, 
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  Users
} from "lucide-react";
import { User, Team } from "@/lib/types";
import { formatBytes } from "@/lib/utils";
import { useRouter } from "next/navigation";

export default function AdminSettingsPage() {
  const router = useRouter();
  const { 
    currentUser,
    users,
    globalSettings,
    setGlobalSettings,
    addUserByAdmin,
    updateUserAdminStatus,
    deleteUser,
    resetPasswordByAdmin,
    fetchAllUsers,
  } = useAuthContext();
  
  const { analyzeStorage, purgeStorage, userTeams, loadTeams } = useTreeContext();
  const { toast } = useToast();

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [storageInfo, setStorageInfo] = useState<any>(null);
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserIsAdmin, setNewUserIsAdmin] = useState(false);
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
  const [userToReset, setUserToReset] = useState<User | null>(null);
  const [passwordForReset, setPasswordForReset] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(globalSettings?.customLogoPath || null);

  const [maxUploadSizeInput, setMaxUploadSizeInput] = useState<string>("");

  useEffect(() => {
    if (globalSettings?.maxUploadSizeMB !== undefined) {
      setMaxUploadSizeInput(globalSettings.maxUploadSizeMB.toString());
    } else {
      setMaxUploadSizeInput("5");
    }
  }, [globalSettings?.maxUploadSizeMB]);

  const handleMaxUploadSizeSave = async () => {
    const val = parseInt(maxUploadSizeInput, 10);
    if (isNaN(val) || val <= 0) {
      toast({ variant: "destructive", title: "Invalid Limit", description: "Please enter a valid positive number for the file size limit." });
      setMaxUploadSizeInput((globalSettings?.maxUploadSizeMB ?? 5).toString());
      return;
    }
    try {
      await setGlobalSettings({ ...globalSettings, maxUploadSizeMB: val });
      toast({ title: "Setting Saved", description: `Maximum uploaded file size set to ${val}MB.` });
    } catch (error) {
      toast({ variant: "destructive", title: "Save Failed", description: "Could not save the new setting." });
    }
  };

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

  useEffect(() => {
    if (currentUser && !currentUser.isAdmin) {
      router.push("/settings");
    }
  }, [currentUser, router]);

  useEffect(() => {
    if (currentUser?.isAdmin) {
      fetchAllUsers();
      loadTeams();
    }
  }, [currentUser?.isAdmin, fetchAllUsers, loadTeams]);

  const fetchStorageInfo = useCallback(async () => {
    setIsAnalyzing(true);
    try {
        const info = await analyzeStorage(undefined, true);
        setStorageInfo(info);
    } catch (err) {
        setStorageInfo(null);
    } finally {
        setIsAnalyzing(false);
    }
  }, [analyzeStorage]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await addUserByAdmin(newUserUsername, newUserPassword, newUserIsAdmin);
    if (success) {
      toast({ title: "User Created", description: `Account for ${newUserUsername} has been created.` });
      setIsCreateUserOpen(false);
      setNewUserUsername("");
      setNewUserPassword("");
      setNewUserIsAdmin(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    await deleteUser(userId);
    toast({ title: "User Deleted", description: "The user has been permanently deleted." });
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userToReset) return;
    await resetPasswordByAdmin(userToReset.id, passwordForReset);
    toast({ title: "Password Reset", description: `Password for ${userToReset.username} has been changed.` });
    setIsResetPasswordOpen(false);
    setUserToReset(null);
    setPasswordForReset("");
  };

  const handlePurge = async () => {
    toast({title: "Purging files...", description: "This may take a moment."})
    const result = await purgeStorage(undefined, true);
    if(result) {
       toast({title: "Purge Complete", description: `${result.purgedCount} files removed, freeing ${formatBytes(result.purgedSize)}.`})
       fetchStorageInfo();
    }
  };

  // Pagination logic
  const totalPages = Math.ceil(users.length / pageSize);
  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return users.slice(start, start + pageSize);
  }, [users, currentPage, pageSize]);

  const userToTeamsMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    users.forEach(u => map[u.id] = []);
    userTeams.forEach(t => {
      t.memberIds.forEach(mId => {
        if (map[mId]) map[mId].push(t.name);
      });
    });
    return map;
  }, [users, userTeams]);

  if (!currentUser?.isAdmin) return null;

  return (
    <ProtectedRoute>
      <div className="flex flex-col min-h-screen bg-muted/20">
        <AppHeader />
        <main className="flex-1 container mx-auto p-4 md:p-8">
          <div className="max-w-4xl mx-auto space-y-8">
            <h1 className="text-3xl font-bold">Admin Settings</h1>

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
                        <ImageIcon className="w-12 h-12 text-muted-foreground"/>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="logo-upload">Custom Logo (SVG)</Label>
                    <Input id="logo-upload" type="file" accept="image/svg+xml" ref={logoInputRef} onChange={handleLogoFileChange} />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                    {globalSettings?.customLogoPath && (
                        <Button 
                            variant="outline" 
                            onClick={async () => {
                                await setGlobalSettings({ ...globalSettings, customLogoPath: "" });
                                toast({ title: "Logo Reset", description: "The custom logo has been removed." });
                            }}
                            type="button"
                        >
                            Reset to Default
                        </Button>
                    )}
                    <Button onClick={handleLogoUpload} disabled={isUploadingLogo}>
                        {isUploadingLogo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4"/>}
                        Upload Logo
                    </Button>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Global Settings</CardTitle>
                <CardDescription>Configure system-wide settings for all users.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
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
                <div className="space-y-2 p-2">
                    <Label htmlFor="max-upload-size" className="font-medium">Maximum Upload File Size (MB)</Label>
                    <div className="flex items-center gap-2 max-w-md">
                        <Input
                            id="max-upload-size"
                            type="number"
                            min="1"
                            value={maxUploadSizeInput}
                            onChange={(e) => setMaxUploadSizeInput(e.target.value)}
                            onBlur={handleMaxUploadSizeSave}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    handleMaxUploadSizeSave();
                                }
                            }}
                            className="w-24"
                        />
                        <Button 
                            variant="outline" 
                            size="sm" 
                            type="button"
                            onClick={handleMaxUploadSizeSave}
                        >
                            Save
                        </Button>
                        <span className="text-xs text-muted-foreground ml-2">Enforced on all image and attachment uploads (default: 5MB)</span>
                    </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>User Management</CardTitle>
                  <CardDescription>Manage user accounts, permissions, and team associations.</CardDescription>
                </div>
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
              </CardHeader>
              <CardContent>
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="px-4 py-3 text-left font-medium">User</th>
                        <th className="px-4 py-3 text-left font-medium">Admin</th>
                        <th className="px-4 py-3 text-left font-medium">Team(s)</th>
                        <th className="px-4 py-3 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {paginatedUsers.map((user) => (
                        <tr key={user.id} className="hover:bg-accent/50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{user.username}</span>
                              {user.isAdmin && <Shield className="h-3 w-3 text-primary" />}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Switch
                              checked={user.isAdmin}
                              onCheckedChange={(checked) => updateUserAdminStatus(user.id, checked)}
                              disabled={user.id === currentUser.id}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {userToTeamsMap[user.id]?.length > 0 ? (
                                userToTeamsMap[user.id].map(tName => (
                                  <span key={tName} className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                                    {tName}
                                  </span>
                                ))
                              ) : (
                                <span className="text-muted-foreground italic text-xs">None</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-2">
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => {
                                  setUserToReset(user);
                                  setIsResetPasswordOpen(true);
                                }}
                              >
                                <KeyRound className="h-4 w-4"/>
                              </Button>

                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" disabled={user.id === currentUser.id}>
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete User Account</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Are you sure you want to delete {user.username}? This will remove all their personal trees and cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => handleDeleteUser(user.id)} className="bg-destructive hover:bg-destructive/90">
                                        Delete Forever
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Rows per page:</span>
                    <Select value={pageSize.toString()} onValueChange={(val) => { setPageSize(Number(val)); setCurrentPage(1); }}>
                      <SelectTrigger className="w-16 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="20">20</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground">
                      Page {currentPage} of {totalPages || 1}
                    </span>
                    <div className="flex gap-1">
                      <Button 
                        variant="outline" 
                        size="icon" 
                        className="h-8 w-8" 
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="icon" 
                        className="h-8 w-8" 
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages || totalPages === 0}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                <Dialog open={isResetPasswordOpen} onOpenChange={setIsResetPasswordOpen}>
                    <DialogContent>
                        <form onSubmit={handleResetPassword}>
                            <DialogHeader>
                                <DialogTitle>Reset Password for {userToReset?.username}</DialogTitle>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="space-y-2">
                                    <Label htmlFor="reset-password">New Password</Label>
                                    <Input 
                                      id="reset-password" 
                                      type="password" 
                                      value={passwordForReset} 
                                      onChange={e => setPasswordForReset(e.target.value)} 
                                      required 
                                      autoFocus
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="ghost" onClick={() => setIsResetPasswordOpen(false)}>Cancel</Button>
                                <Button type="submit">Reset Password</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
              </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Data Persistence</CardTitle>
                    <CardDescription>Manage application storage and clean up orphaned files.</CardDescription>
                </CardHeader>
                <CardContent>
                    {!storageInfo && !isAnalyzing ? (
                        <div className="flex flex-col items-center justify-center py-8 space-y-4">
                            <p className="text-sm text-muted-foreground text-center max-w-sm">
                                Analysis will scan all user directories and cross-reference them with all database nodes. This may be computationally intensive.
                            </p>
                            <Button onClick={fetchStorageInfo} variant="outline">
                                <DatabaseZap className="mr-2 h-4 w-4" /> Run Storage Analysis
                            </Button>
                        </div>
                    ) : isAnalyzing ? (
                        <div className="flex flex-col items-center justify-center py-12 space-y-4">
                            <Loader2 className="animate-spin h-8 w-8 text-primary" />
                            <p className="text-sm text-muted-foreground animate-pulse">Scanning trees and files...</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="text-sm border rounded-md p-4 bg-muted/30">
                                <p>Total space used: <span className="font-bold">{formatBytes(storageInfo.totalSize)}</span> across {storageInfo.totalCount} files.</p>
                                {storageInfo.purgeableSize > 0 && (
                                    <p className="text-destructive mt-1 font-medium italic">
                                        Optimization available: {formatBytes(storageInfo.purgeableSize)} can be recovered by purging {storageInfo.purgeableCount} unreferenced files.
                                    </p>
                                )}
                                {storageInfo.purgeableSize === 0 && (
                                    <p className="text-muted-foreground mt-1 italic">All files are currently referenced. No purgeable data found.</p>
                                )}
                            </div>
                            <div className="flex justify-between">
                                <Button variant="ghost" onClick={fetchStorageInfo} size="sm">
                                    <Loader2 className={`mr-2 h-4 w-4 ${isAnalyzing ? 'animate-spin' : ''}`} /> Recalculate
                                </Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="destructive" disabled={storageInfo.purgeableCount === 0}>
                                            <Trash2 className="mr-2 h-4 w-4" /> Purge Unused Files
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This action will permanently delete {storageInfo.purgeableCount} files not referenced in any roots system-wide, freeing up {formatBytes(storageInfo.purgeableSize)}. This action cannot be undone.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={handlePurge} className="bg-destructive hover:bg-destructive/90">
                                                Confirm System Purge
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
