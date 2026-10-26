"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/header";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuthContext } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { getStorageReportByUser, purgeUnusedFilesForUser } from "@/lib/storage-service";
import { UserStorageReport, UserStorageRow } from "@/lib/types";
import { formatBytes, formatDate } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
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
  ArrowLeft,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  Loader2,
  AlertTriangle,
  HardDrive,
  Trash2,
} from "lucide-react";

type SortField =
  | "rank"
  | "username"
  | "fileCount"
  | "totalSize"
  | "shareOfTotal"
  | "largestFileSize"
  | "lastModified"
  | "purgeableSize"
  | "purgeableCount";

export default function AdminStoragePage() {
  const router = useRouter();
  const { currentUser } = useAuthContext();
  const { toast } = useToast();

  const [report, setReport] = useState<UserStorageReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includePurgeable, setIncludePurgeable] = useState(false);
  const [isAnalyzingPurgeable, setIsAnalyzingPurgeable] = useState(false);
  const [purgingUserId, setPurgingUserId] = useState<string | null>(null);

  // Sorting state
  const [sortField, setSortField] = useState<SortField>("totalSize");
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    if (currentUser && !currentUser.isAdmin) {
      router.push("/settings");
    }
  }, [currentUser, router]);

  const loadReport = useCallback(async (withPurgeable: boolean) => {
    if (withPurgeable) {
      setIsAnalyzingPurgeable(true);
    } else {
      setIsLoading(true);
    }
    setError(null);
    try {
      const data = await getStorageReportByUser(withPurgeable);
      setReport(data);
      setIncludePurgeable(withPurgeable);
    } catch (err: any) {
      setError(err?.message || "Failed to load storage report.");
    } finally {
      setIsLoading(false);
      setIsAnalyzingPurgeable(false);
    }
  }, []);

  useEffect(() => {
    if (currentUser?.isAdmin) {
      loadReport(false);
    }
  }, [currentUser?.isAdmin, loadReport]);

  const handlePurgeUser = async (user: UserStorageRow) => {
    const displayName = user.username || `deleted user (${user.userId})`;
    setPurgingUserId(user.userId);
    toast({
      title: "Purging user files...",
      description: `Removing unreferenced files for ${displayName}.`,
    });
    try {
      const result = await purgeUnusedFilesForUser(user.userId);
      toast({
        title: "Purge Complete",
        description: `Removed ${result.purgedCount} unused files for ${displayName}, freeing ${formatBytes(result.purgedSize)}.`,
      });
      await loadReport(includePurgeable);
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Purge Failed",
        description: err?.message || "Could not purge files for this user.",
      });
    } finally {
      setPurgingUserId(null);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      if (field === "username") {
        setSortAsc(true);
      } else {
        setSortAsc(false);
      }
    }
  };

  const sortedUsers = useMemo(() => {
    if (!report?.users) return [];
    const withRank = report.users.map((u, idx) => ({ ...u, rank: idx + 1 }));

    return [...withRank].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "rank":
          comparison = a.rank - b.rank;
          break;
        case "username": {
          const nameA = a.username || "(deleted user)";
          const nameB = b.username || "(deleted user)";
          comparison = nameA.localeCompare(nameB);
          break;
        }
        case "fileCount":
          comparison = a.fileCount - b.fileCount;
          break;
        case "totalSize":
          comparison = a.totalSize - b.totalSize;
          break;
        case "shareOfTotal":
          comparison = a.shareOfTotal - b.shareOfTotal;
          break;
        case "largestFileSize":
          comparison = a.largestFileSize - b.largestFileSize;
          break;
        case "lastModified": {
          const timeA = a.lastModified ? new Date(a.lastModified).getTime() : 0;
          const timeB = b.lastModified ? new Date(b.lastModified).getTime() : 0;
          comparison = timeA - timeB;
          break;
        }
        case "purgeableSize":
          comparison = (a.purgeableSize ?? 0) - (b.purgeableSize ?? 0);
          break;
        case "purgeableCount":
          comparison = (a.purgeableCount ?? 0) - (b.purgeableCount ?? 0);
          break;
      }
      return sortAsc ? comparison : -comparison;
    });
  }, [report, sortField, sortAsc]);

  const renderSortIndicator = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="ml-1 h-3.5 w-3.5 text-muted-foreground/60 inline-block" />;
    }
    return sortAsc ? (
      <ArrowUp className="ml-1 h-3.5 w-3.5 text-primary inline-block" />
    ) : (
      <ArrowDown className="ml-1 h-3.5 w-3.5 text-primary inline-block" />
    );
  };

  if (!currentUser?.isAdmin) return null;

  return (
    <ProtectedRoute>
      <div className="flex flex-col min-h-screen bg-muted/20">
        <AppHeader />
        <main className="flex-1 container mx-auto p-4 md:p-8">
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/admin">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back to admin
                  </Link>
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadReport(includePurgeable)}
                  disabled={isLoading || isAnalyzingPurgeable || !!purgingUserId}
                >
                  <RefreshCw
                    className={`mr-2 h-4 w-4 ${
                      isLoading || isAnalyzingPurgeable ? "animate-spin" : ""
                    }`}
                  />
                  Refresh
                </Button>
                {!includePurgeable ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadReport(true)}
                    disabled={isLoading || isAnalyzingPurgeable || !!purgingUserId}
                  >
                    {isAnalyzingPurgeable ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <HardDrive className="mr-2 h-4 w-4" />
                    )}
                    Include purgeable analysis
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => loadReport(false)}
                    disabled={isLoading || isAnalyzingPurgeable || !!purgingUserId}
                  >
                    Hide purgeable columns
                  </Button>
                )}
              </div>
            </div>

            {!includePurgeable && (
              <p className="text-xs text-muted-foreground">
                Purgeable analysis cross-references and decrypts database nodes across all trees and may take longer to run.
              </p>
            )}

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div>
                  <CardTitle className="text-2xl font-bold">Storage Usage by User</CardTitle>
                  <CardDescription>
                    Per-user attachment consumption report to monitor capacity and identify resource abuse.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center py-16 space-y-4">
                    <Loader2 className="animate-spin h-8 w-8 text-primary" />
                    <p className="text-sm text-muted-foreground animate-pulse">
                      Analyzing storage usage across users...
                    </p>
                  </div>
                ) : error ? (
                  <div className="flex flex-col items-center justify-center py-12 space-y-4">
                    <AlertTriangle className="h-10 w-10 text-destructive" />
                    <p className="text-sm text-destructive font-medium">{error}</p>
                    <Button variant="outline" size="sm" onClick={() => loadReport(includePurgeable)}>
                      Try Again
                    </Button>
                  </div>
                ) : !report || report.users.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
                    <p className="text-sm font-medium">No user storage data found.</p>
                    <p className="text-xs text-muted-foreground">
                      No user attachment directories exist or contain files.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {isAnalyzingPurgeable && (
                      <div className="flex items-center gap-2 p-3 text-xs bg-muted/60 border rounded-md">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span>Running global referenced-file scan and decrypting nodes...</span>
                      </div>
                    )}
                    <div className="rounded-md border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead
                              className="w-16 cursor-pointer select-none"
                              onClick={() => handleSort("rank")}
                            >
                              <div className="flex items-center">
                                Rank
                                {renderSortIndicator("rank")}
                              </div>
                            </TableHead>
                            <TableHead
                              className="cursor-pointer select-none"
                              onClick={() => handleSort("username")}
                            >
                              <div className="flex items-center">
                                User
                                {renderSortIndicator("username")}
                              </div>
                            </TableHead>
                            <TableHead
                              className="text-right cursor-pointer select-none"
                              onClick={() => handleSort("fileCount")}
                            >
                              <div className="flex items-center justify-end">
                                Files
                                {renderSortIndicator("fileCount")}
                              </div>
                            </TableHead>
                            <TableHead
                              className="text-right cursor-pointer select-none"
                              onClick={() => handleSort("totalSize")}
                            >
                              <div className="flex items-center justify-end">
                                Total Size
                                {renderSortIndicator("totalSize")}
                              </div>
                            </TableHead>
                            <TableHead
                              className="w-40 cursor-pointer select-none"
                              onClick={() => handleSort("shareOfTotal")}
                            >
                              <div className="flex items-center">
                                % of Total
                                {renderSortIndicator("shareOfTotal")}
                              </div>
                            </TableHead>
                            <TableHead
                              className="text-right cursor-pointer select-none"
                              onClick={() => handleSort("largestFileSize")}
                            >
                              <div className="flex items-center justify-end">
                                Largest File
                                {renderSortIndicator("largestFileSize")}
                              </div>
                            </TableHead>
                            <TableHead
                              className="cursor-pointer select-none"
                              onClick={() => handleSort("lastModified")}
                            >
                              <div className="flex items-center">
                                Last Upload
                                {renderSortIndicator("lastModified")}
                              </div>
                            </TableHead>
                            {includePurgeable && (
                              <>
                                <TableHead
                                  className="text-right cursor-pointer select-none text-destructive"
                                  onClick={() => handleSort("purgeableSize")}
                                >
                                  <div className="flex items-center justify-end">
                                    Purgeable Size
                                    {renderSortIndicator("purgeableSize")}
                                  </div>
                                </TableHead>
                                <TableHead
                                  className="text-right cursor-pointer select-none text-destructive"
                                  onClick={() => handleSort("purgeableCount")}
                                >
                                  <div className="flex items-center justify-end">
                                    Purgeable Files
                                    {renderSortIndicator("purgeableCount")}
                                  </div>
                                </TableHead>
                                <TableHead className="text-right">
                                  Action
                                </TableHead>
                              </>
                            )}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sortedUsers.map((user) => {
                            const isUserPurging = purgingUserId === user.userId;
                            const hasPurgeable = (user.purgeableCount ?? 0) > 0;
                            const displayName = user.username || `deleted user (${user.userId})`;

                            return (
                              <TableRow key={user.userId} className="hover:bg-accent/40">
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                  #{user.rank}
                                </TableCell>
                                <TableCell>
                                  {user.username ? (
                                    <span className="font-medium">{user.username}</span>
                                  ) : (
                                    <span className="text-muted-foreground italic">
                                      (deleted user)
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">
                                  {user.fileCount.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right font-medium">
                                  {formatBytes(user.totalSize)}
                                </TableCell>
                                <TableCell>
                                  <div className="space-y-1">
                                    <div className="flex justify-between text-xs font-mono text-muted-foreground">
                                      <span>{user.shareOfTotal.toFixed(1)}%</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                                      <div
                                        className="h-full bg-primary rounded-full"
                                        style={{
                                          width: `${Math.min(100, Math.max(0, user.shareOfTotal))}%`,
                                        }}
                                      />
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground text-sm">
                                  {user.largestFileSize > 0
                                    ? formatBytes(user.largestFileSize)
                                    : "—"}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {user.lastModified
                                    ? formatDate(user.lastModified, "yyyy-MM-dd HH:mm")
                                    : "—"}
                                </TableCell>
                                {includePurgeable && (
                                  <>
                                    <TableCell className="text-right text-destructive font-medium text-sm">
                                      {formatBytes(user.purgeableSize ?? 0)}
                                    </TableCell>
                                    <TableCell className="text-right text-destructive font-mono text-sm">
                                      {(user.purgeableCount ?? 0).toLocaleString()}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                            disabled={!hasPurgeable || !!purgingUserId}
                                            title={hasPurgeable ? `Purge unreferenced files for ${displayName}` : "No unreferenced files to purge"}
                                          >
                                            {isUserPurging ? (
                                              <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                              <Trash2 className="h-4 w-4" />
                                            )}
                                            <span className="ml-1 text-xs hidden sm:inline">Purge</span>
                                          </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                          <AlertDialogHeader>
                                            <AlertDialogTitle>Purge files for {displayName}?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                              This will permanently delete {user.purgeableCount} unreferenced files in this user&apos;s attachments directory, freeing {formatBytes(user.purgeableSize ?? 0)}. Other users&apos; attachments will remain untouched.
                                            </AlertDialogDescription>
                                          </AlertDialogHeader>
                                          <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction
                                              onClick={() => handlePurgeUser(user)}
                                              className="bg-destructive hover:bg-destructive/90"
                                            >
                                              Confirm Purge
                                            </AlertDialogAction>
                                          </AlertDialogFooter>
                                        </AlertDialogContent>
                                      </AlertDialog>
                                    </TableCell>
                                  </>
                                )}
                              </TableRow>
                            );
                          })}
                        </TableBody>
                        <TableFooter>
                          <TableRow className="font-bold bg-muted/30">
                            <TableCell colSpan={2}>Grand Total</TableCell>
                            <TableCell className="text-right font-mono">
                              {report.grandTotalCount.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatBytes(report.grandTotalSize)}
                            </TableCell>
                            <TableCell>
                              <span className="text-xs font-mono text-muted-foreground">
                                {report.grandTotalSize > 0 ? "100.0%" : "0.0%"}
                              </span>
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground">—</TableCell>
                            <TableCell className="text-muted-foreground">—</TableCell>
                            {includePurgeable && (
                              <>
                                <TableCell className="text-right text-destructive">
                                  {formatBytes(report.grandPurgeableSize ?? 0)}
                                </TableCell>
                                <TableCell className="text-right text-destructive font-mono">
                                  {(report.grandPurgeableCount ?? 0).toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground">—</TableCell>
                              </>
                            )}
                          </TableRow>
                        </TableFooter>
                      </Table>
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
