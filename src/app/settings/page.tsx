"use client";

import { useState, useEffect } from "react";
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
import { Separator } from "@/components/ui/separator";
import { ProtectedRoute } from "@/components/protected-route";
import { useToast } from "@/hooks/use-toast";
import { Loader2, KeyRound, Github, LogOut } from "lucide-react";
import { Slider } from "@/components/ui/slider";
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
import Link from "next/link";

const DATE_FORMATS = [
    { value: "dd/MM/yyyy", label: "DD/MM/YYYY" },
    { value: "MM/dd/yyyy", label: "MM/DD/YYYY" },
    { value: "yyyy-MM-dd", label: "YYYY-MM-DD" },
    { value: "PPP", label: "Month Day, Year" },
];

export default function SettingsPage() {
  const { 
    theme, 
    setTheme, 
    currentUser,
    changePassword,
    setGitSettings,
    setDateFormat,
    setInactivityTimeout,
    setTwoPanelExpansionDepth,
    revokeAllSessions,
  } = useAuthContext();
  
  const { toast } = useToast();
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [githubPat, setGithubPat] = useState(currentUser?.gitSettings?.githubPat || "");
  const [inactivityTimeout, setInactivityTimeoutState] = useState(currentUser?.inactivityTimeoutMinutes ?? 15);
  const [isRevokingSessions, setIsRevokingSessions] = useState(false);

  const handleRevokeSessions = async () => {
    setIsRevokingSessions(true);
    try {
      await revokeAllSessions();
      toast({ title: "Sessions Revoked", description: "You have been signed out of all other devices." });
    } catch (e) {
      toast({ variant: "destructive", title: "Action Failed", description: "Could not revoke sessions." });
    } finally {
      setIsRevokingSessions(false);
    }
  };

  useEffect(() => {
    if (currentUser?.gitSettings?.githubPat) {
      setGithubPat(currentUser.gitSettings.githubPat);
    }
    if (currentUser?.inactivityTimeoutMinutes !== undefined) {
      setInactivityTimeoutState(currentUser.inactivityTimeoutMinutes);
    }
  }, [currentUser]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ variant: "destructive", title: "Passwords do not match", description: "Please re-enter your new password and confirmation." });
      return;
    }
    if (newPassword.length < 6) {
       toast({ variant: "destructive", title: "Password too short", description: "Your new password must be at least 6 characters long." });
      return;
    }

    setIsChangingPassword(true);
    const success = await changePassword(currentPassword, newPassword);

    if (success) {
      toast({ title: "Password Changed", description: "Your password has been updated successfully." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } else {
      toast({ variant: "destructive", title: "Password Change Failed", description: "Your current password was incorrect. Please try again." });
    }
    setIsChangingPassword(false);
  };
  
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
            <h1 className="text-3xl font-bold">User Settings</h1>
            
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
                  <RadioGroup
                    onValueChange={(value) => setTheme(value as "light" | "dark" | "system")}
                    value={theme}
                    className="grid max-w-md grid-cols-1 sm:grid-cols-3 gap-8 pt-2"
                  >
                    <div>
                      <RadioGroupItem value="light" id="light" className="peer sr-only" />
                      <Label htmlFor="light" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">
                        <div className="flex flex-col items-center">
                          <div className="w-16 h-10 rounded-lg bg-white border-2 border-primary mb-2"></div>
                          Light
                        </div>
                      </Label>
                    </div>
                    <div>
                      <RadioGroupItem value="dark" id="dark" className="peer sr-only" />
                      <Label htmlFor="dark" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">
                        <div className="flex flex-col items-center">
                          <div className="w-16 h-10 rounded-lg bg-gray-900 border-2 border-primary mb-2"></div>
                          Dark
                        </div>
                      </Label>
                    </div>
                    <div>
                      <RadioGroupItem value="system" id="system" className="peer sr-only" />
                      <Label htmlFor="system" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">
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
                   <Select value={currentUser?.dateFormat || 'dd/MM/yyyy'} onValueChange={setDateFormat}>
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

                <Separator className="my-6" />

                <div className="space-y-4 pt-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-base">Two-Panel Auto-Expansion Depth</Label>
                    <span className="text-sm font-medium bg-secondary px-2.5 py-0.5 rounded-full">
                      {currentUser?.twoPanelExpansionDepth ?? 1}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Determines how many levels of descendants are automatically expanded when selecting a node in two-panel view.
                  </p>
                  <div className="pt-2 pb-2 px-1">
                    <Slider
                      value={[currentUser?.twoPanelExpansionDepth ?? 1]}
                      min={0}
                      max={5}
                      step={1}
                      onValueChange={(value) => setTwoPanelExpansionDepth(value[0])}
                    />
                    <div className="flex justify-between text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mt-3">
                      <span>Max Performance (0)</span>
                      <span>Higher Depth (5)</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Security</CardTitle>
                <CardDescription>Manage your account security and sessions.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="current-password">Current Password</Label>
                    <Input id="current-password" type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-password">New Password</Label>
                    <Input id="new-password" type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirm New Password</Label>
                    <Input id="confirm-password" type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={isChangingPassword}>
                      {isChangingPassword ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <KeyRound className="mr-2 h-4 w-4"/>}
                      Change Password
                    </Button>
                  </div>
                </form>
                 <Separator />
                 <div className="space-y-4">
                    <Label>Automatic Logout</Label>
                    <p className="text-sm text-muted-foreground">Minutes of inactivity before automatic logout. Set to 0 to disable.</p>
                    <div className="flex items-center justify-between p-2 rounded-md">
                        <div className="flex items-center gap-2">
                            <Input id="inactivity-timeout" type="number" min="0" value={inactivityTimeout} onChange={(e) => setInactivityTimeoutState(Number(e.target.value))} className="w-24" />
                            <span className="text-sm text-muted-foreground">minutes</span>
                        </div>
                        <Button onClick={handleInactivityTimeoutSave}>Save Timeout</Button>
                    </div>
                </div>
                 <Separator />
                 <div className="space-y-4">
                    <Label>Active Sessions</Label>
                    <div className="pt-1">
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" disabled={isRevokingSessions}>
                                    {isRevokingSessions ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <LogOut className="mr-2 h-4 w-4"/>}
                                    Sign Out of All Other Devices
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                    <AlertDialogDescription>This will invalidate all sessions for your account on other devices.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleRevokeSessions} className="bg-destructive hover:bg-destructive/90">Sign Out Everywhere</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                </div>
              </CardContent>
            </Card>
            
             <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Github className="h-5 w-5" /> Git Integration
                </CardTitle>
                <CardDescription>Connect your GitHub account to sync your trees.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSaveGitSettings} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="github-pat">GitHub Personal Access Token</Label>
                    <Input id="github-pat" type="password" placeholder="ghp_..." value={githubPat} onChange={(e) => setGithubPat(e.target.value)} />
                    <p className="text-xs text-muted-foreground">
                      Stored securely. Used to sync with your repositories. 
                      Create one in <Link href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener noreferrer" className="underline">GitHub settings</Link>.
                    </p>
                  </div>
                   <div className="flex justify-end">
                    <Button type="submit">Save Token</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}