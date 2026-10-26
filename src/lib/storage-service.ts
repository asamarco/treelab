/**
 * @fileoverview
 * This service handles all storage analysis for the application by interacting
 * with the server's filesystem and database. It is intended to be run on the server.
 */
'use server';

import fs from 'fs/promises';
import path from 'path';
import { connectToDatabase } from './mongodb';
import { TreeModel, TreeNodeModel, TeamModel, GlobalSettingsModel, UserModel } from './models';
import { decrypt } from './encryption';
import { TreeFile, TreeNode, Template, AttachmentInfo, StorageInfo, PurgeResult, Team, GlobalSettings, UserStorageReport, UserStorageRow } from './types';
import { getSession } from './session';
import { fetchAllUsers } from './auth-service';
import { getDataDir } from './data-dir';
import mongoose from 'mongoose';

async function getAllReferencedFileNames(userId?: string, treeId?: string): Promise<Set<string>> {
    await connectToDatabase();
    const referencedFiles = new Set<string>();

    const globalSettings = await GlobalSettingsModel.findOne().lean<GlobalSettings>().exec();
    if (globalSettings?.customLogoPath) {
        referencedFiles.add(path.basename(globalSettings.customLogoPath));
    }

    let query: any = {};
    if (treeId) {
        query = { _id: treeId };
    } else if (userId) {
        const userTeams = await TeamModel.find({ memberIds: userId }).lean<Team[]>().exec();
        const teamIds = userTeams.map(t => t._id ? t._id.toString() : (t as any).id);
        query = {
            $or: [
                { userId: userId },
                { sharedWith: userId },
                { 'shares.userId': userId },
                { 'teamShares.teamId': mongoose.trusted({ $in: teamIds }) },
            ],
        };
    }

    const treeFilesToScan = await TreeModel.find(query).lean<Omit<TreeFile, 'tree'>>().exec();

    for (const treeFile of Array.isArray(treeFilesToScan) ? treeFilesToScan : [treeFilesToScan]) {
        if (!treeFile) continue;

        const nodes = await TreeNodeModel.find({ treeId: treeFile._id.toString() }).lean<TreeNode[]>().exec();

        for (const node of nodes) {
            const template = treeFile.templates.find((t: Template) => t.id === node.templateId);
            if (template) {
                try {
                    const nodeData = await decrypt(node.data);
                    if (!nodeData) continue;

                    for (const field of template.fields) {
                        const value = nodeData[field.id];
                        if (!value) continue;

                        if (field.type === 'picture') {
                            const pictures = Array.isArray(value) ? value : [value];
                            pictures.forEach(p => {
                                if (typeof p === 'string') referencedFiles.add(path.basename(p));
                            });
                        } else if (field.type === 'attachment') {
                            const attachments = Array.isArray(value) ? value : [value];
                            attachments.forEach(a => {
                                if (a && typeof a === 'object' && 'path' in a) {
                                    referencedFiles.add(path.basename(a.path));
                                } else if (typeof a === 'string') {
                                    referencedFiles.add(path.basename(a));
                                }
                            });
                        }
                    }
                } catch (decryptError) {
                    console.error(`ERROR: Failed to decrypt data for node ${node._id || (node as any).id}:`, decryptError);
                }
            }
        }
    }
    return referencedFiles;
}

async function listFilesWithSizes(dir: string): Promise<{ name: string, size: number, path: string, mtime: Date }[]> {
    try {
        const fileNames = await fs.readdir(dir);
        const fileDetails = await Promise.all(
            fileNames.map(async (name) => {
                if (name.includes('..')) throw new Error('Invalid file name');
                const fullPath = path.join(dir, name);
                const stats = await fs.stat(fullPath);
                return { name, size: stats.size, path: fullPath, mtime: stats.mtime };
            })
        );
        return fileDetails.filter(details => details !== null) as { name: string, size: number, path: string, mtime: Date }[];
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

export async function getStorageInfo(treeId?: string, isGlobal: boolean = false): Promise<StorageInfo> {
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    // Check if user is admin if global is requested
    const allUsers = await fetchAllUsers();
    const currentUser = allUsers.find(u => u.id === session.userId);
    const isAdmin = currentUser?.isAdmin || false;
    const userId = session.userId;

    const DATA_DIR = getDataDir();
    const USERS_DIR = path.join(DATA_DIR, 'users');
    const defaultInfo: StorageInfo = {
        totalSize: 0,
        totalCount: 0,
        purgeableSize: 0,
        purgeableCount: 0,
    };

    let allAttachments: { name: string, size: number, path: string }[] = [];
    if (isGlobal && isAdmin) {
        const userDirs = await fs.readdir(USERS_DIR);
        for (const uId of userDirs) {
            const userAttachmentsDir = path.join(USERS_DIR, uId, 'attachments');
            const files = await listFilesWithSizes(userAttachmentsDir);
            allAttachments = [...allAttachments, ...files];
        }
    } else {
        const attachmentsDir = path.join(USERS_DIR, userId, 'attachments');
        await fs.mkdir(attachmentsDir, { recursive: true });
        allAttachments = await listFilesWithSizes(attachmentsDir);
    }

    const referencedFileNames = await getAllReferencedFileNames(
        isGlobal && isAdmin ? undefined : userId,
        treeId
    );

    const allUserFiles = [...allAttachments];
    if (allUserFiles.length === 0) {
        return defaultInfo;
    }

    if (treeId) {
        let treeTotalSize = 0;
        let treeTotalCount = 0;

        const fileMap = new Map<string, number>();
        allUserFiles.forEach(f => fileMap.set(f.name, f.size));

        referencedFileNames.forEach(fileName => {
            if (fileMap.has(fileName)) {
                treeTotalSize += fileMap.get(fileName)!;
                treeTotalCount++;
            }
        });

        return {
            totalSize: treeTotalSize,
            totalCount: treeTotalCount,
            purgeableSize: 0,
            purgeableCount: 0,
        };

    } else {
        let totalSize = 0;
        let purgeableSize = 0;
        let purgeableCount = 0;

        for (const file of allUserFiles) {
            totalSize += file.size;
            if (!referencedFileNames.has(file.name)) {
                purgeableSize += file.size;
                purgeableCount++;
            }
        }

        return {
            totalSize,
            totalCount: allUserFiles.length,
            purgeableSize,
            purgeableCount
        };
    }
}

export async function purgeUnusedFiles(treeId?: string, isGlobal: boolean = false): Promise<PurgeResult> {
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    const allUsers = await fetchAllUsers();
    const currentUser = allUsers.find(u => u.id === session.userId);
    const isAdmin = currentUser?.isAdmin || false;
    const userId = session.userId;

    const DATA_DIR = getDataDir();
    const USERS_DIR = path.join(DATA_DIR, 'users');

    let allFiles: { name: string, size: number, path: string }[] = [];
    if (isGlobal && isAdmin) {
        const userDirs = await fs.readdir(USERS_DIR);
        for (const uId of userDirs) {
            const userAttachmentsDir = path.join(USERS_DIR, uId, 'attachments');
            const files = await listFilesWithSizes(userAttachmentsDir);
            allFiles = [...allFiles, ...files];
        }
    } else {
        const attachmentsDir = path.join(USERS_DIR, userId, 'attachments');
        await fs.mkdir(attachmentsDir, { recursive: true });
        allFiles = await listFilesWithSizes(attachmentsDir);
    }

    const referencedFileNames = await getAllReferencedFileNames(
        isGlobal && isAdmin ? undefined : userId
    );
    let purgedSize = 0;
    let purgedCount = 0;
    const purgePromises: Promise<void>[] = [];

    for (const file of allFiles) {
        if (!referencedFileNames.has(file.name)) {
            purgePromises.push(fs.unlink(file.path));
            purgedSize += file.size;
            purgedCount++;
        }
    }

    await Promise.all(purgePromises);
    console.log(`INFO: Purged ${purgedCount} files for user ${userId}, freeing ${purgedSize} bytes.`);

    return { purgedSize, purgedCount };
}

export async function purgeUnusedFilesForUser(targetUserId: string): Promise<PurgeResult> {
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    const allUsers = await fetchAllUsers();
    const currentUser = allUsers.find(u => u.id === session.userId);
    if (!currentUser?.isAdmin) {
        throw new Error("Admin access required.");
    }

    if (!targetUserId || typeof targetUserId !== 'string' || targetUserId.includes('..') || targetUserId.includes('/') || targetUserId.includes('\\')) {
        throw new Error("Invalid target user ID.");
    }

    const DATA_DIR = getDataDir();
    const USERS_DIR = path.join(DATA_DIR, 'users');
    const userAttachmentsDir = path.join(USERS_DIR, targetUserId, 'attachments');

    const files = await listFilesWithSizes(userAttachmentsDir);
    if (files.length === 0) {
        return { purgedSize: 0, purgedCount: 0 };
    }

    // Global referenced-file scan to ensure safety across all trees
    const referencedFileNames = await getAllReferencedFileNames(undefined, undefined);

    let purgedSize = 0;
    let purgedCount = 0;
    const purgePromises: Promise<void>[] = [];

    for (const file of files) {
        if (!referencedFileNames.has(file.name)) {
            purgePromises.push(fs.unlink(file.path));
            purgedSize += file.size;
            purgedCount++;
        }
    }

    await Promise.all(purgePromises);
    console.log(`INFO: Admin purged ${purgedCount} unused files for user folder ${targetUserId}, freeing ${purgedSize} bytes.`);

    return { purgedSize, purgedCount };
}

export async function getStorageReportByUser(includePurgeable = false): Promise<UserStorageReport> {
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    const allUsers = await fetchAllUsers();
    const currentUser = allUsers.find(u => u.id === session.userId);
    if (!currentUser?.isAdmin) {
        throw new Error("Admin access required.");
    }

    await connectToDatabase();

    const DATA_DIR = getDataDir();
    const USERS_DIR = path.join(DATA_DIR, 'users');

    let userFolderEntries: import('fs').Dirent[] = [];
    try {
        userFolderEntries = await fs.readdir(USERS_DIR, { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }

    const validFolderIds: string[] = [];
    for (const entry of userFolderEntries) {
        if (entry.isDirectory()) {
            validFolderIds.push(entry.name);
        }
    }

    // Map folder ids to usernames with UserModel.find().select('username _id').lean()
    const dbUsers = await UserModel.find().select('username _id').lean().exec();
    const userMap = new Map<string, string>();
    for (const u of dbUsers) {
        const idStr = u._id ? u._id.toString() : (u as any).id;
        userMap.set(idStr, u.username);
    }

    // Read attachments per user folder
    type UserFileData = {
        userId: string;
        files: { name: string; size: number; path: string; mtime: Date }[];
    };

    const usersFiles: UserFileData[] = [];
    for (const folderId of validFolderIds) {
        const userAttachmentsDir = path.join(USERS_DIR, folderId, 'attachments');
        const files = await listFilesWithSizes(userAttachmentsDir);
        usersFiles.push({
            userId: folderId,
            files,
        });
    }

    let globalReferencedFiles: Set<string> | null = null;
    if (includePurgeable) {
        // ONE global referenced-file scan shared by all users
        globalReferencedFiles = await getAllReferencedFileNames(undefined, undefined);
    }

    let grandTotalSize = 0;
    let grandTotalCount = 0;
    let grandPurgeableSize = 0;
    let grandPurgeableCount = 0;

    interface UserPreRow {
        userId: string;
        username: string | null;
        fileCount: number;
        totalSize: number;
        largestFileSize: number;
        lastModified: string | null;
        purgeableSize?: number;
        purgeableCount?: number;
    }

    const preRows: UserPreRow[] = [];

    for (const { userId, files } of usersFiles) {
        let totalSize = 0;
        let largestFileSize = 0;
        let latestMtimeMs = 0;
        let purgeableSize = 0;
        let purgeableCount = 0;

        for (const file of files) {
            totalSize += file.size;
            if (file.size > largestFileSize) {
                largestFileSize = file.size;
            }
            const timeMs = file.mtime ? file.mtime.getTime() : 0;
            if (timeMs > latestMtimeMs) {
                latestMtimeMs = timeMs;
            }
            if (includePurgeable && globalReferencedFiles) {
                if (!globalReferencedFiles.has(file.name)) {
                    purgeableSize += file.size;
                    purgeableCount++;
                }
            }
        }

        grandTotalSize += totalSize;
        grandTotalCount += files.length;
        if (includePurgeable) {
            grandPurgeableSize += purgeableSize;
            grandPurgeableCount += purgeableCount;
        }

        const username = userMap.get(userId) ?? null;
        const lastModified = latestMtimeMs > 0 ? new Date(latestMtimeMs).toISOString() : null;

        const row: UserPreRow = {
            userId,
            username,
            fileCount: files.length,
            totalSize,
            largestFileSize,
            lastModified,
        };

        if (includePurgeable) {
            row.purgeableSize = purgeableSize;
            row.purgeableCount = purgeableCount;
        }

        preRows.push(row);
    }

    // Sort descending by totalSize
    preRows.sort((a, b) => b.totalSize - a.totalSize);

    // Compute share of total (percent)
    const users: UserStorageRow[] = preRows.map(row => {
        const shareOfTotal = grandTotalSize > 0 ? (row.totalSize / grandTotalSize) * 100 : 0;
        return {
            ...row,
            shareOfTotal,
        };
    });

    const report: UserStorageReport = {
        users,
        grandTotalSize,
        grandTotalCount,
    };

    if (includePurgeable) {
        report.grandPurgeableSize = grandPurgeableSize;
        report.grandPurgeableCount = grandPurgeableCount;
    }

    return report;
}
