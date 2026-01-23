/**
 * @fileoverview
 * This service handles all storage analysis for the application by interacting
 * with the server's filesystem and database. It is intended to be run on the server.
 */
'use server';

import fs from 'fs/promises';
import path from 'path';
import { connectToDatabase } from './mongodb';
import { TreeModel, TreeNodeModel } from './models';
import { decrypt } from './encryption';
import { TreeFile, TreeNode, Template, AttachmentInfo, StorageInfo, PurgeResult } from './types';
import { getSession } from './session';


async function getAllReferencedFileNames(userId: string, treeId?: string): Promise<Set<string>> {
    await connectToDatabase();
    const referencedFiles = new Set<string>();

    const treeFilesToScan = treeId 
        ? [await TreeModel.findById(treeId).lean<Omit<TreeFile, 'tree'>>().exec()]
        : await TreeModel.find({ userId: userId }).lean<Omit<TreeFile, 'tree'>>().exec();
    
    for (const treeFile of Array.isArray(treeFilesToScan) ? treeFilesToScan : [treeFilesToScan]) {
        if (!treeFile) continue;
        
        const nodes = await TreeNodeModel.find({ treeId: treeFile._id.toString() }).lean<TreeNode[]>().exec();
        
        if (Array.isArray(treeFile.templates)) {
            for (const node of nodes) {
                const template = treeFile.templates.find((t: Template) => t.id === node.templateId);
                if (template) {
                    const nodeData = await decrypt(node.data);
                    for (const field of template.fields) {
                        const value = (nodeData || {})[field.id];
                        if (!value) continue;

                        if (field.type === 'picture') {
                            const pictures = Array.isArray(value) ? value : [value];
                            pictures.forEach(p => {
                                if (typeof p === 'string') referencedFiles.add(path.basename(p));
                            });
                        } else if (field.type === 'attachment') {
                            (value as AttachmentInfo[]).forEach(a => {
                                if (typeof a.path === 'string') referencedFiles.add(path.basename(a.path));
                            });
                        }
                    }
                }
            }
        }
    }
    return referencedFiles;
}

async function listFilesWithSizes(dir: string): Promise<{ name: string, size: number, path: string }[]> {
    try {
        const fileNames = await fs.readdir(dir);
        const fileDetails = await Promise.all(
            fileNames.map(async (name) => {
                const fullPath = path.join(dir, name);
                const stats = await fs.stat(fullPath);
                return { name, size: stats.size, path: fullPath };
            })
        );
        return fileDetails.filter(details => details !== null) as { name: string, size: number, path: string }[];
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

export async function getStorageInfo(treeId?: string): Promise<StorageInfo> {
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");
    const userId = session.userId;

    const DATA_DIR = path.join(process.cwd(), process.env.DATA_DIR || 'data');
    const USERS_DIR = path.join(DATA_DIR, 'users');
    const defaultInfo: StorageInfo = {
        totalSize: 0,
        totalCount: 0,
        purgeableSize: 0,
        purgeableCount: 0,
    };
    
    const attachmentsDir = path.join(USERS_DIR, userId, 'attachments');
    await fs.mkdir(attachmentsDir, { recursive: true });


    const [allAttachments, referencedFileNames] = await Promise.all([
        listFilesWithSizes(attachmentsDir),
        getAllReferencedFileNames(userId, treeId)
    ]);

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
        
        const globalReferencedFileNames = await getAllReferencedFileNames(userId);

        for (const file of allUserFiles) {
            totalSize += file.size;
            if (!globalReferencedFileNames.has(file.name)) {
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

export async function purgeUnusedFiles(treeId?: string): Promise<PurgeResult> {
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");
    const userId = session.userId;

    const DATA_DIR = path.join(process.cwd(), process.env.DATA_DIR || 'data');
    const USERS_DIR = path.join(DATA_DIR, 'users');
    const attachmentsDir = path.join(USERS_DIR, userId, 'attachments');
    await fs.mkdir(attachmentsDir, { recursive: true });
    
    const [allAttachments, referencedFileNames] = await Promise.all([
        listFilesWithSizes(attachmentsDir),
        getAllReferencedFileNames(userId)
    ]);

    const allFiles = [...allAttachments];
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
