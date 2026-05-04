"use client";

import { useState, useEffect } from "react";
import { AppHeader } from "@/components/header";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuthContext } from "@/contexts/auth-context";
import { useTreeContext } from "@/contexts/tree-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Users, Shield, Trash2, UserPlus, X, Search, Check, ShieldCheck, Edit } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
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

export default function TeamsPage() {
  const { currentUser, users, fetchAllUsers } = useAuthContext();
  const { userTeams, createTeam, deleteTeam, updateTeamMembers, assignTeamLeaders, renameTeam } = useTreeContext();
  const { toast } = useToast();
  
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [selectedLeaders, setSelectedLeaders] = useState<string[]>([]);
  
  const [isManageMembersOpen, setIsManageMembersOpen] = useState(false);
  const [selectedTeamForMembers, setSelectedTeamForMembers] = useState<any>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [pendingMemberIds, setPendingMemberIds] = useState<string[]>([]);
  
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [teamToRename, setTeamToRename] = useState<any>(null);
  const [renamedTeamName, setRenamedTeamName] = useState("");

  useEffect(() => {
    fetchAllUsers();
  }, [fetchAllUsers]);

  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return;
    // Current user can also be a leader if selected or if admin
    await createTeam(newTeamName.trim(), selectedLeaders);
    setNewTeamName("");
    setSelectedLeaders([]);
    setIsCreateDialogOpen(false);
  };

  const handleUpdateMembers = async () => {
    if (!selectedTeamForMembers) return;
    await updateTeamMembers(selectedTeamForMembers.id, pendingMemberIds);
    setIsManageMembersOpen(false);
  };
  
  const handleRenameTeam = async () => {
    if (!teamToRename || !renamedTeamName.trim()) return;
    await renameTeam(teamToRename.id, renamedTeamName.trim());
    setIsRenameDialogOpen(false);
    setTeamToRename(null);
    setRenamedTeamName("");
  };

  const isUserAdmin = currentUser?.isAdmin;

  return (
    <ProtectedRoute>
      <div className="flex flex-col min-h-screen bg-background">
        <AppHeader />
        <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Teams</h1>
              <p className="text-muted-foreground mt-1">Manage collaboration groups and permissions.</p>
            </div>
            {isUserAdmin && (
              <Button onClick={() => setIsCreateDialogOpen(true)} className="rounded-full px-6">
                <Plus className="mr-2 h-4 w-4" /> Create Team
              </Button>
            )}
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {userTeams.length === 0 ? (
              <div className="col-span-full py-24 text-center border-2 border-dashed rounded-2xl bg-muted/5">
                <div className="bg-primary/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                   <Users className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">No teams discovered</h3>
                <p className="text-muted-foreground max-w-sm mx-auto mb-8">Teams help organize users and simplify tree sharing across groups.</p>
                {isUserAdmin && (
                   <Button onClick={() => setIsCreateDialogOpen(true)} variant="outline">
                      Start by creating a team
                   </Button>
                )}
              </div>
            ) : (
              userTeams.map(team => {
                const isLeader = team.leaderIds.includes(currentUser?.id || "");
                const canManage = isUserAdmin || isLeader;
                
                return (
                  <Card key={team.id} className="overflow-hidden border-2 hover:border-primary/50 transition-all duration-300 shadow-sm hover:shadow-md group">
                    <CardHeader className="bg-muted/30 pb-4 border-b">
                      <div className="flex justify-between items-start">
                        <div className="space-y-1">
                          <CardTitle className="text-xl font-bold group-hover:text-primary transition-colors flex items-center gap-2">
                             {team.name}
                             {canManage && (
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" 
                                  onClick={() => {
                                    setTeamToRename(team);
                                    setRenamedTeamName(team.name);
                                    setIsRenameDialogOpen(true);
                                  }}
                                >
                                  <Edit className="h-3 w-3" />
                                </Button>
                             )}
                          </CardTitle>
                          <Badge variant="outline" className="font-normal text-xs bg-background/50">
                             {team.memberIds.length} {team.memberIds.length === 1 ? 'member' : 'members'}
                          </Badge>
                        </div>
                        <div className="bg-background p-2 rounded-lg shadow-sm border">
                           <Users className="h-5 w-5 text-primary" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-6 space-y-5">
                      <div className="space-y-3">
                        <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest pl-1">Team Leaders</Label>
                        <div className="flex flex-wrap gap-2">
                          {team.leaderIds.map(lid => {
                            const user = users.find(u => u.id === lid);
                            return (
                              <div key={lid} className="flex items-center gap-1.5 bg-muted/50 px-2 py-1 rounded-md text-xs font-medium border border-primary/10">
                                <ShieldCheck className="h-3 w-3 text-primary" />
                                {user?.username || "Unknown"}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      
                      <div className="flex gap-2 pt-4 border-t">
                        {canManage && (
                          <Button 
                            variant="default" 
                            size="sm" 
                            className="flex-1 shadow-sm"
                            onClick={() => {
                              setSelectedTeamForMembers(team);
                              setPendingMemberIds([...team.memberIds]);
                              setIsManageMembersOpen(true);
                            }}
                          >
                            <UserPlus className="mr-2 h-4 w-4" /> Manage
                          </Button>
                        )}
                        {isUserAdmin && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Team</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete team "{team.name}"? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteTeam(team.id)} className="bg-destructive hover:bg-destructive/90 text-white">Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                        {!canManage && (
                          <div className="w-full text-center py-2 bg-muted/20 rounded text-[11px] text-muted-foreground font-medium uppercase tracking-tighter">
                            Participating Member
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            )}
          </div>

          {/* Create Team Dialog */}
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle className="text-2xl">Create New Team</DialogTitle>
                <DialogDescription>Grouping users simplifies sharing and access control.</DialogDescription>
              </DialogHeader>
              <div className="space-y-6 py-6 border-y my-2">
                <div className="space-y-3">
                  <Label htmlFor="team-name" className="text-sm font-semibold">Team Name</Label>
                  <Input 
                    id="team-name" 
                    placeholder="e.g. Marketing Department, Region North"
                    className="h-11"
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                  />
                </div>
                <div className="space-y-3">
                  <Label className="text-sm font-semibold">Initial Leaders</Label>
                  <ScrollArea className="h-48 border rounded-xl bg-muted/5">
                    <div className="p-3 space-y-1">
                      {users.map(user => (
                        <div key={user.id} className="flex items-center space-x-3 p-2.5 hover:bg-muted rounded-lg transition-colors">
                          <Checkbox 
                            id={`leader-${user.id}`} 
                            checked={selectedLeaders.includes(user.id)}
                            onCheckedChange={(checked) => {
                              if (checked) setSelectedLeaders(prev => [...prev, user.id]);
                              else setSelectedLeaders(prev => prev.filter(id => id !== user.id));
                            }}
                          />
                          <label htmlFor={`leader-${user.id}`} className="text-sm font-medium cursor-pointer flex-1">
                            {user.username} {user.id === currentUser?.id && <span className="text-primary text-[10px] ml-1">(You)</span>}
                            {user.isAdmin && <Badge variant="outline" className="ml-2 scale-75 h-4 border-primary/20 text-primary">Admin</Badge>}
                          </label>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                  <p className="text-[10px] text-muted-foreground italic">Leaders are automatically added as team members.</p>
                </div>
              </div>
              <DialogFooter className="pt-2">
                <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                <Button onClick={handleCreateTeam} disabled={!newTeamName.trim()} className="px-8">Create Team</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Manage Members Dialog */}
          <Dialog open={isManageMembersOpen} onOpenChange={setIsManageMembersOpen}>
            <DialogContent className="sm:max-w-[450px]">
              <DialogHeader>
                <DialogTitle className="text-xl">Manage: {selectedTeamForMembers?.name}</DialogTitle>
                <DialogDescription>Update who belongs to this team.</DialogDescription>
              </DialogHeader>
              <div className="space-y-6 py-4 border-y my-2">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Filter people..." 
                    className="pl-10 h-10"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                  />
                </div>
                
                <div className="space-y-2">
                   <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest pl-1">Member Directory</Label>
                   <ScrollArea className="h-64 border rounded-xl bg-muted/5">
                    <div className="p-3 space-y-1">
                      {users.filter(u => u.username.toLowerCase().includes(memberSearch.toLowerCase())).map(user => {
                        const isMember = pendingMemberIds.includes(user.id);
                        const isLeader = selectedTeamForMembers?.leaderIds.includes(user.id);
                        
                        return (
                          <div key={user.id} className="flex items-center justify-between p-2.5 hover:bg-muted rounded-lg transition-colors">
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-semibold">{user.username}</span>
                              {isLeader && <Badge className="text-[9px] h-3.5 px-1.5 uppercase font-bold tracking-tighter bg-primary/20 text-primary hover:bg-primary/20 border-0">Team Leader</Badge>}
                              {user.id === currentUser?.id && <span className="text-[9px] text-muted-foreground italic">(You)</span>}
                            </div>
                            <Checkbox 
                              checked={isMember}
                              onCheckedChange={(checked) => {
                                if (checked) setPendingMemberIds(prev => [...prev, user.id]);
                                else if (!isLeader) setPendingMemberIds(prev => prev.filter(id => id !== user.id));
                                else toast({ variant: "destructive", title: "Action protected", description: "Leaders cannot be removed from members list. Revoke leadership first." });
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
                
                {isUserAdmin && (
                   <div className="space-y-3 pt-2">
                     <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest pl-1">Leadership Roles (Admin Only)</Label>
                     <div className="flex flex-wrap gap-2">
                        {users.filter(u => pendingMemberIds.includes(u.id)).map(user => {
                           const isLeader = selectedTeamForMembers?.leaderIds.includes(user.id);
                           return (
                             <Button 
                               key={user.id}
                               variant={isLeader ? "default" : "outline"}
                               size="sm"
                               className={cn(
                                 "h-8 text-[11px] font-semibold border-2 transition-all",
                                 isLeader ? "border-primary" : "border-dashed"
                               )}
                               onClick={async () => {
                                 const currentLeaders = selectedTeamForMembers?.leaderIds || [];
                                 const newLeaders = isLeader 
                                   ? currentLeaders.filter((id: string) => id !== user.id)
                                   : [...currentLeaders, user.id];
                                 
                                 if (newLeaders.length === 0) {
                                    toast({ variant: "destructive", title: "Safety Warning", description: "Team must have at least one leader." });
                                    return;
                                 }
                                 
                                 await assignTeamLeaders(selectedTeamForMembers.id, newLeaders);
                                 setSelectedTeamForMembers((prev: any) => ({ ...prev, leaderIds: newLeaders }));
                               }}
                             >
                               {isLeader ? <ShieldCheck className="mr-1.5 h-3 w-3" /> : <Shield className="mr-1.5 h-3 w-3" />}
                               {user.username}
                             </Button>
                           )
                        })}
                     </div>
                   </div>
                )}
              </div>
              <DialogFooter className="pt-2">
                <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                <Button onClick={handleUpdateMembers} className="px-8 shadow-md">Apply Membership Changes</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {/* Rename Team Dialog */}
          <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Rename Team</DialogTitle>
                <DialogDescription>Change the name of "{teamToRename?.name}".</DialogDescription>
              </DialogHeader>
              <div className="py-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="rename-team-name">New Team Name</Label>
                  <Input 
                    id="rename-team-name"
                    value={renamedTeamName}
                    onChange={(e) => setRenamedTeamName(e.target.value)}
                    placeholder="Enter new team name..."
                  />
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                <Button onClick={handleRenameTeam} disabled={!renamedTeamName.trim()}>Save Changes</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </main>
      </div>
    </ProtectedRoute>
  );
}
