
/**
 * @fileoverview
 * This service handles all data persistence for the application by interacting
 * with the server's filesystem. It provides functions to read, write, and delete
 * JSON data for trees and users, as well as handle binary files for images.
 */
'use server';

import fs from 'fs/promises';
import path from 'path';
import { TreeFile, User, ExampleInfo, GlobalSettings, AttachmentInfo, TreeNode, StorageInfo, PurgeResult, GitProvider, GitBlob, GitCommit, Template, TreePermissions, TreeShare, Team, TeamShare } from './types';
import { lookup } from 'mime-types';
import { Octokit } from 'octokit';
import { connectToDatabase } from './mongodb';
import { UserModel, TreeModel, TreeNodeModel, TeamModel } from './models';
import { encrypt, decrypt } from './encryption';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { generateJsonForExport, generateNodeName, getContextualOrder, toPlainObject, assertId } from './utils';
import { unstable_noStore as noStore } from 'next/cache';
import { getSession } from './session';
import { getDataDir } from './data-dir';

// --- Permission Helper ---
// Computes the effective permissions for a user on a tree.
// Legacy sharedWith users get read-only access. New shares entries carry granular permissions.
// The owner always gets full permissions.
// Computes the effective permissions for a user on a tree.
// Legacy sharedWith users get read-only access. New shares entries carry granular permissions.
// The owner always gets full permissions.
async function getTreePermissions(tree: Pick<TreeFile, 'userId' | 'sharedWith' | 'shares' | 'teamShares'>, userId: string): Promise<TreePermissions & { isOwner: boolean; hasAccess: boolean }> {
    const isOwner = tree.userId.toString() === userId;
    if (isOwner) {
        return { isOwner: true, hasAccess: true, editNodes: true, editTemplates: true, admin: true };
    }

    // Initialize with more restrictive permissions
    let editNodes = false;
    let editTemplates = false;
    let admin = false;
    let hasAccess = false;

    // 1. Check legacy sharedWith array => read-only
    if ((tree.sharedWith || []).includes(userId)) {
        hasAccess = true;
    }

    // 2. Check the new shares array (individual permissions)
    const individualShare = (tree.shares || []).find(s => s.userId === userId);
    if (individualShare) {
        hasAccess = true;
        editNodes = editNodes || individualShare.permissions.editNodes || individualShare.permissions.admin;
        editTemplates = editTemplates || individualShare.permissions.editTemplates || individualShare.permissions.admin;
        admin = admin || individualShare.permissions.admin;
    }

    // 3. Check team shares
    const teamShares = tree.teamShares || [];
    if (teamShares.length > 0) {
        await connectToDatabase();
        // Find teams where user is a member or leader
        const userTeams = await TeamModel.find(mongoose.trusted({
            $or: [
                { memberIds: userId },
                { leaderIds: userId }
            ]
        })).select('_id').lean().exec();

        const userTeamIds = userTeams.map(t => t._id.toString());

        const relevantTeamShares = teamShares.filter(ts => userTeamIds.includes(ts.teamId));
        if (relevantTeamShares.length > 0) {
            hasAccess = true;
            for (const ts of relevantTeamShares) {
                editNodes = editNodes || ts.permissions.editNodes || ts.permissions.admin;
                editTemplates = editTemplates || ts.permissions.editTemplates || ts.permissions.admin;
                admin = admin || ts.permissions.admin;
            }
        }
    }

    return {
        isOwner: false,
        hasAccess,
        editNodes,
        editTemplates,
        admin,
    };
}

async function authorizeTreeAccess(
    treeId: string,
    requiredPermission?: 'owner' | 'admin' | 'editNodes' | 'editTemplates' | 'hasAccess'
) {
    assertId(treeId, 'treeId');
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    await connectToDatabase();

    const tree = await TreeModel.findById(treeId).lean<Omit<TreeFile, 'tree'>>();
    if (!tree) throw new Error("Tree not found.");

    const perms = await getTreePermissions(tree, session.userId);

    if (requiredPermission === 'owner' && !perms.isOwner) {
        throw new Error("Authorization denied: Only the owner can perform this action.");
    }
    if (requiredPermission === 'admin' && !perms.isOwner && !perms.admin) {
        throw new Error("Authorization denied: Only the owner or an admin can perform this action.");
    }
    if (requiredPermission === 'editNodes' && !perms.editNodes) {
        throw new Error("Authorization denied: You do not have permission to edit nodes.");
    }
    if (requiredPermission === 'editTemplates' && !perms.editTemplates) {
        throw new Error("Authorization denied: You do not have permission to edit templates.");
    }
    if (requiredPermission === 'hasAccess' && !perms.hasAccess) {
        throw new Error("Authorization denied.");
    }

    return { session, tree, perms };
}

export async function findNodeById(nodeId: string): Promise<TreeNode | null> {
    assertId(nodeId, 'nodeId');
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    await connectToDatabase();
    const node = await TreeNodeModel.findById(nodeId).lean<TreeNode>().exec();
    if (!node) return null;

    if (node.userId.toString() !== session.userId) {
        const tree = await TreeModel.findById(node.treeId).lean<TreeFile>();
        if (!tree) throw new Error("Authorization denied.");
        const perms = await getTreePermissions(tree, session.userId);
        if (!tree.isPublic && !perms.hasAccess) {
            throw new Error("Authorization denied.");
        }
    }

    // Decrypt sensitive fields after loading
    node.name = await decrypt(node.name);
    node.data = await decrypt(node.data);

    return toPlainObject(node);
}


// Internal helper for hydrating user profiles
async function fetchUserProfilesInternal(userIds: string[]): Promise<Record<string, { id: string, username: string }>> {
    if (!userIds || userIds.length === 0) return {};
    await connectToDatabase();
    const uniqueIds = Array.from(new Set(userIds.filter(id => !!id)));
    const users = await UserModel.find({ _id: mongoose.trusted({ $in: uniqueIds }) }).select('username _id').lean().exec();
    const profiles: Record<string, { id: string, username: string }> = {};
    users.forEach((u: any) => {
        const id = u._id.toString();
        profiles[id] = { id, username: u.username };
    });
    return profiles;
}

// --- TreeFile Functions (MongoDB) ---

export async function createTreeFile(treeFile: Omit<TreeFile, 'tree' | 'id'>, initialNodes: Omit<TreeNode, 'id' | 'children' | '_id'>[]): Promise<TreeFile> {
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");
    if (treeFile.userId !== session.userId) throw new Error("Authorization denied.");

    await connectToDatabase();
    try {
        const { id, _id, nodes, rootNodeIds, ...rest } = treeFile as any;
        const dataWithCleanedExpandedIds = { ...rest, expandedNodeIds: [] };
        const newTreeFile = new TreeModel(dataWithCleanedExpandedIds);
        const savedTreeFile = await newTreeFile.save();
        const canonicalTreeId = String(savedTreeFile._id);

        if (initialNodes && initialNodes.length > 0) {
            const nodesToCreate = await Promise.all(initialNodes.map(async (node: Omit<TreeNode, 'id' | 'children' | '_id'>) => ({
                ...node,
                name: await encrypt(node.name), // Encrypt name
                data: await encrypt(node.data), // Encrypt data
                treeId: canonicalTreeId,
                userId: session.userId,
            })));
            await TreeNodeModel.insertMany(nodesToCreate);
        }

        console.log(`INFO: Created tree '${savedTreeFile.title}' (ID: ${canonicalTreeId}) and initial nodes in DB`);

        const treeNodes = await loadTreeNodes(canonicalTreeId);

        const plainTreeFile = toPlainObject(savedTreeFile);
        const profiles = await fetchUserProfilesInternal([plainTreeFile.userId]);
        const owner = profiles[plainTreeFile.userId];

        return { ...plainTreeFile, owner, tree: treeNodes };

    } catch (error) {
        console.error("Error creating tree file:", error);
        throw error;
    }
}

export async function saveTreeFile(treeFile: Partial<Omit<TreeFile, 'tree'>> & { id: string }, timestamp?: string): Promise<string> {
    assertId(treeFile?.id, 'treeId');
    const { perms, tree } = await authorizeTreeAccess(treeFile.id);
    const canonicalTreeId = String(tree._id);

    const allowedKeys: Array<keyof TreeFile> = ['title', 'templates', 'gitSync', 'order', 'expandedNodeIds', 'lastDrilledNodeId'];
    const cleanTreeData: Record<string, any> = {};
    for (const key of allowedKeys) {
        if (key in treeFile) {
            cleanTreeData[key] = (treeFile as any)[key];
        }
    }

    if (!perms.isOwner) {
        const updateKeys = Object.keys(cleanTreeData);
        const isTemplateUpdate = updateKeys.includes('templates');
        const isTitleUpdate = updateKeys.includes('title');
        const isGitSyncUpdate = updateKeys.includes('gitSync');

        if (isTemplateUpdate && !perms.editTemplates) {
            throw new Error("Authorization denied: You do not have permission to edit templates.");
        }
        if (isTitleUpdate && !perms.admin) {
            throw new Error("Authorization denied: You do not have permission to edit the tree title.");
        }
        if (isGitSyncUpdate && !perms.admin && !perms.editNodes && !perms.editTemplates) {
            throw new Error("Authorization denied: You do not have permission to configure GitHub sync.");
        }
        if (!perms.hasAccess) {
            throw new Error("Authorization denied.");
        }
    }

    const newTimestamp = timestamp || new Date().toISOString();
    const updateKeys = Object.keys(cleanTreeData);
    const isOnlyViewChange = updateKeys.length > 0 && updateKeys.every(k => k === 'expandedNodeIds' || k === 'lastDrilledNodeId');

    const updatePayload: any = { $set: { ...cleanTreeData } };

    // Only update the 'updatedAt' timestamp if it's not just a view change
    if (!isOnlyViewChange) {
        updatePayload.$set.updatedAt = newTimestamp;
    }

    // If gitSync is explicitly not present in cleanTreeData, it means we are unlinking.
    if (!('gitSync' in cleanTreeData) && Object.keys(treeFile).length > 2) {
        updatePayload.$unset = { gitSync: 1 };
    }

    await TreeModel.findByIdAndUpdate(canonicalTreeId, updatePayload).exec();

    if (!isOnlyViewChange) {
        console.log(`INFO: Saved tree meta '${treeFile.title || tree.title}' (ID: ${canonicalTreeId}) to DB with new timestamp.`);
    } else {
        console.log(`INFO: Saved expanded nodes for tree (ID: ${canonicalTreeId}) without updating timestamp.`);
    }

    return newTimestamp;
}

export async function updateTreeOrder(updates: { id: string; order: number }[]) {
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    if (!Array.isArray(updates) || updates.length === 0) {
        console.warn('updateTreeOrder called with no updates');
        return { success: false, modifiedCount: 0 };
    }

    updates.forEach(u => assertId(u?.id, 'treeId'));

    console.log(`INFO: Updating order for ${updates.length} trees in DB.`);
    await connectToDatabase();

    try {
        const treeIds = updates.map(u => new mongoose.Types.ObjectId(u.id));
        const treesToUpdate = await TreeModel.find({ _id: mongoose.trusted({ $in: treeIds }) });

        if (treesToUpdate.some(t => t.userId.toString() !== session.userId)) {
            throw new Error("Authorization denied: Cannot reorder trees you do not own.");
        }

        const bulkOps = updates.map(({ id, order }) => ({
            updateOne: {
                filter: { _id: new mongoose.Types.ObjectId(id) },
                update: { $set: { order: order } }
            }
        }));

        const result = await TreeModel.bulkWrite(bulkOps);
        console.log(`INFO: updateTreeOrder successfully modified ${result.modifiedCount} documents.`);
        return { success: true, modifiedCount: result.modifiedCount };
    } catch (err) {
        console.error('Error in updateTreeOrder:', err);
        throw err;
    }
}

export async function loadTreeFile(treeId: string): Promise<TreeFile | null> {
    assertId(treeId, 'treeId');
    noStore();
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    await connectToDatabase();
    const treeFileDoc = await TreeModel.findById(treeId).lean<Omit<TreeFile, 'tree'>>().exec();
    if (!treeFileDoc) return null;

    const canonicalTreeId = String(treeFileDoc._id);
    const loadPerms = await getTreePermissions(treeFileDoc, session.userId);
    if (!loadPerms.hasAccess) {
        throw new Error("Authorization denied.");
    }

    const nodes = await loadTreeNodes(canonicalTreeId);

    // Ensure publicId exists (for existing trees)
    if (!treeFileDoc.publicId) {
        const publicId = crypto.randomUUID();
        await TreeModel.findByIdAndUpdate(canonicalTreeId, { publicId }).exec();
        treeFileDoc.publicId = publicId;
    }

    // Hydrate owner and collaborators
    const userIdsToFetch = [treeFileDoc.userId, ...(treeFileDoc.shares || []).map(s => s.userId), ...(treeFileDoc.sharedWith || [])];
    const userProfiles = await fetchUserProfilesInternal(userIdsToFetch);

    const plainDoc: TreeFile = {
        id: canonicalTreeId,
        userId: treeFileDoc.userId,
        owner: userProfiles[treeFileDoc.userId],
        sharedWith: treeFileDoc.sharedWith,
        shares: (treeFileDoc.shares || []).map(s => ({
            ...s,
            user: userProfiles[s.userId]
        })),
        isPublic: treeFileDoc.isPublic,
        title: treeFileDoc.title,
        templates: treeFileDoc.templates.map((t: any) => ({
            ...t,
            preferredChildTemplates: t.preferredChildTemplates || [],
        })),
        expandedNodeIds: treeFileDoc.expandedNodeIds,
        lastDrilledNodeId: treeFileDoc.lastDrilledNodeId ?? null,
        gitSync: treeFileDoc.gitSync,
        publicId: treeFileDoc.publicId,
        teamShares: treeFileDoc.teamShares,
        order: treeFileDoc.order,
        createdAt: treeFileDoc.createdAt,
        updatedAt: treeFileDoc.updatedAt,
        tree: nodes
    };
    delete (plainDoc as any)._id;
    delete (plainDoc as any).__v;

    return plainDoc;
}

export async function loadPublicTreeFile(treeId: string): Promise<TreeFile | null> {
    const safeTreeId = assertId(treeId, 'treeId');
    noStore();
    try {
        await connectToDatabase();

        // Try finding by publicId first
        let treeFileDoc = await TreeModel.findOne({ publicId: safeTreeId }).lean<Omit<TreeFile, 'tree'>>().exec();

        if (treeFileDoc) {
            if (!treeFileDoc.isPublic) {
                return null;
            }
        } else if (mongoose.Types.ObjectId.isValid(safeTreeId)) {
            treeFileDoc = await TreeModel.findOne({ _id: safeTreeId, isPublic: true }).lean<Omit<TreeFile, 'tree'>>().exec();
        }
        if (!treeFileDoc) {
            return null;
        }

        const actualTreeId = treeFileDoc._id.toString();
        const nodes = await loadTreeNodes(actualTreeId);

        // Sanitize the document: Only include fields safe for public exposure.
        const plainDoc: any = {
            id: actualTreeId,
            title: treeFileDoc.title,
            templates: treeFileDoc.templates.map((t: any) => ({
                ...t,
                preferredChildTemplates: t.preferredChildTemplates || [],
            })),
            tree: nodes,
            publicId: treeFileDoc.publicId,
            isPublic: true,
            createdAt: treeFileDoc.createdAt,
            updatedAt: treeFileDoc.updatedAt,
            expandedNodeIds: treeFileDoc.expandedNodeIds || [],
            globalStyle: (treeFileDoc as any).globalStyle,
        };

        return plainDoc as TreeFile;
    } catch (err) {
        console.error(`ERROR: [loadPublicTreeFile] Fatal database error:`, err);
        throw err; // Rethrow to see it in Next.js logs
    }
}


export async function loadAllTreeFiles(): Promise<TreeFile[]> {
    noStore();
    const session = await getSession();
    if (!session?.userId) return [];

    await connectToDatabase();

    // Find teams the user belongs to
    const userTeams = await TeamModel.find(mongoose.trusted({
        $or: [
            mongoose.trusted({ memberIds: session.userId }),
            mongoose.trusted({ leaderIds: session.userId })
        ]
    })).select('_id').lean().exec();
    const userTeamIds = userTeams.map(t => t._id.toString());

    const query = mongoose.trusted({
        $or: [
            mongoose.trusted({ userId: session.userId }),
            mongoose.trusted({ sharedWith: mongoose.trusted({ $in: [session.userId] }) }),
            mongoose.trusted({ 'shares.userId': session.userId }),
            mongoose.trusted({ 'teamShares.teamId': mongoose.trusted({ $in: userTeamIds }) })
        ]
    });

    const treeFileDocs = await TreeModel.find(query).lean<Omit<TreeFile, 'tree'>[]>().exec();

    const treeIds = treeFileDocs.map((t: any) => t._id.toString());
    // Fetch all nodes for the user in one go
    const allNodesForUser = await TreeNodeModel.find({ treeId: mongoose.trusted({ $in: treeIds }) }).lean<TreeNode[]>().exec();

    // Group nodes by treeId
    const nodesByTreeId = new Map<string, TreeNode[]>();
    for (const node of allNodesForUser) {
        // Decrypt sensitive fields
        node.name = await decrypt(node.name);
        node.data = await decrypt(node.data);

        const treeId = node.treeId.toString();
        if (!nodesByTreeId.has(treeId)) {
            nodesByTreeId.set(treeId, []);
        }
        nodesByTreeId.get(treeId)!.push(node);
    }

    // Hydrate everything in one go for efficiency
    const allUserIds = new Set<string>();
    treeFileDocs.forEach((doc: any) => {
        allUserIds.add(doc.userId);
        (doc.shares || []).forEach((s: any) => allUserIds.add(s.userId));
        (doc.sharedWith || []).forEach((id: string) => allUserIds.add(id));
    });
    const userProfiles = await fetchUserProfilesInternal(Array.from(allUserIds));

    const fullTreeFiles = await Promise.all(treeFileDocs.map(async (doc: any) => {
        const treeId = doc._id.toString();
        const nodesForTree = nodesByTreeId.get(treeId) || [];
        const hierarchicalNodes = buildTreeHierarchy(nodesForTree);

        // Ensure publicId exists
        if (!doc.publicId) {
            const publicId = crypto.randomUUID();
            await TreeModel.findByIdAndUpdate(treeId, { publicId }).exec();
            doc.publicId = publicId;
        }

        const plainDoc: TreeFile = {
            id: treeId,
            userId: doc.userId,
            owner: userProfiles[doc.userId],
            sharedWith: doc.sharedWith,
            shares: (doc.shares || []).map((s: any) => ({
                ...s,
                user: userProfiles[s.userId]
            })),
            isPublic: doc.isPublic,
            title: doc.title,
            templates: doc.templates.map((t: any) => ({
                ...t,
                preferredChildTemplates: t.preferredChildTemplates || [],
            })),
            expandedNodeIds: doc.expandedNodeIds,
            lastDrilledNodeId: doc.lastDrilledNodeId ?? null,
            teamShares: doc.teamShares,
            gitSync: doc.gitSync,
            publicId: doc.publicId,
            order: doc.order,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
            tree: hierarchicalNodes
        };
        return plainDoc;
    }));

    return fullTreeFiles;
}

export async function deleteTreeFile(treeId: string): Promise<void> {
    assertId(treeId, 'treeId');
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    await connectToDatabase();

    const treeToDelete = await TreeModel.findById(treeId).lean<Omit<TreeFile, 'tree'>>();
    if (!treeToDelete) return;
    if (treeToDelete.userId.toString() !== session.userId) {
        throw new Error("Authorization denied: Only the owner can delete a tree.");
    }

    try {
        const canonicalTreeId = String(treeToDelete._id);
        // Perform deletions sequentially
        await TreeNodeModel.deleteMany({ treeId: canonicalTreeId });
        await TreeModel.findByIdAndDelete(canonicalTreeId);

        console.log(`INFO: Deleted tree (ID: ${canonicalTreeId}) and all associated nodes from DB`);
    } catch (error) {
        console.error("Error deleting tree file:", error);
        throw error;
    }
}



// --- TreeNode Functions ---

const buildTreeHierarchy = (nodes: TreeNode[]): TreeNode[] => {
    if (!nodes || nodes.length === 0) return [];

    const nodeMap = new Map<string, TreeNode>();
    // First pass: Create a canonical object for each node.
    nodes.forEach((node: any) => {
        const plainNode = toPlainObject(node);
        nodeMap.set(plainNode.id, { ...plainNode, children: [] });
    });

    const rootNodes: TreeNode[] = [];

    // Second pass: Build the hierarchy using object references.
    nodeMap.forEach(node => {
        const parentIds = node.parentIds && node.parentIds.length > 0 ? node.parentIds : ['root'];

        parentIds.forEach(parentId => {
            if (parentId === 'root') {
                if (!rootNodes.some(rn => rn.id === node.id)) {
                    rootNodes.push(node);
                }
            } else {
                const parentNode = nodeMap.get(parentId);
                if (parentNode) {
                    if (!parentNode.children.some(child => child.id === node.id)) {
                        // This is the crucial change: push the actual object reference.
                        parentNode.children.push(node);
                    }
                }
            }
        });
    });

    const sortChildrenRecursive = (nodesToSort: TreeNode[], parentId: string | null) => {
        if (!nodesToSort || nodesToSort.length === 0) return;
        nodesToSort.sort((a, b) => getContextualOrder(a, nodesToSort, parentId) - getContextualOrder(b, nodesToSort, parentId));
        nodesToSort.forEach(node => {
            if (node.children && node.children.length > 0) {
                sortChildrenRecursive(node.children, node.id);
            }
        });
    };

    sortChildrenRecursive(rootNodes, null);

    return rootNodes;
};

export async function loadTreeNodes(treeId: string): Promise<TreeNode[]> {
    assertId(treeId, 'treeId');
    await connectToDatabase();

    const treeFileDoc = await TreeModel.findById(treeId).lean<Omit<TreeFile, 'tree'>>();
    if (!treeFileDoc) {
        throw new Error("Tree not found when trying to load its nodes.");
    }

    const canonicalTreeId = String(treeFileDoc._id);
    const isPublic = treeFileDoc.isPublic === true;

    if (!isPublic) {
        const session = await getSession();
        if (!session?.userId) {
            return [];
        }
        const nodePerms = await getTreePermissions(treeFileDoc, session.userId);

        if (!nodePerms.hasAccess) {
            throw new Error("Authorization denied: You do not have permission to view these nodes.");
        }
    }

    const nodes = await TreeNodeModel.find({ treeId: canonicalTreeId }).lean<TreeNode[]>().exec();

    await Promise.all(nodes.map(async (node) => {
        node.name = await decrypt(node.name);
        node.data = await decrypt(node.data);
    }));

    return buildTreeHierarchy(nodes);
}

export async function createNode(nodeData: Omit<TreeNode, 'id' | 'children'> & { _id?: string, id?: string }): Promise<TreeNode> {
    assertId(nodeData?.treeId, 'treeId');
    const { session, tree } = await authorizeTreeAccess(nodeData.treeId, 'editNodes');
    const canonicalTreeId = String(tree._id);

    const { id, _id, name, data, templateId, isStarred, parentIds, order } = nodeData as any;

    if (id) assertId(id, 'id');
    if (_id) assertId(_id, '_id');

    const dataToSave: Record<string, any> = {
        name: await encrypt(name),
        data: await encrypt(data || {}),
        userId: session.userId,
        treeId: canonicalTreeId,
        templateId,
        isStarred: !!isStarred,
        parentIds: Array.isArray(parentIds) ? parentIds : ['root'],
        order: Array.isArray(order) ? order : [0],
    };

    const targetId = id || _id;
    const documentToSave = targetId ? { ...dataToSave, _id: targetId } : dataToSave;

    const newNode = new TreeNodeModel(documentToSave);
    await newNode.save();

    const canonicalNodeId = String(newNode._id);
    await TreeModel.findByIdAndUpdate(canonicalTreeId, { updatedAt: new Date().toISOString() });

    const plainNode = toPlainObject(newNode);

    // Decrypt for returning to the client
    plainNode.name = await decrypt(plainNode.name);
    plainNode.data = await decrypt(plainNode.data);

    return { ...plainNode, id: canonicalNodeId, children: [] };
}

export async function updateNode(nodeId: string, updates: Partial<Omit<TreeNode, 'id' | 'children'>>, timestamp?: string): Promise<string> {
    assertId(nodeId, 'nodeId');
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    await connectToDatabase();

    const node = await TreeNodeModel.findById(nodeId).select('treeId userId _id').lean<TreeNode>();
    if (!node) {
        throw new Error("Node not found for update.");
    }

    const canonicalNodeId = String((node as any)._id || nodeId);
    const canonicalTreeId = String(node.treeId);

    await authorizeTreeAccess(canonicalTreeId, 'editNodes');

    const { name, data, templateId, isStarred, parentIds, order } = updates as any;
    const newTimestamp = timestamp || new Date().toISOString();

    const encryptedUpdates: Record<string, any> = { updatedAt: newTimestamp };
    if (templateId !== undefined) encryptedUpdates.templateId = templateId;
    if (isStarred !== undefined) encryptedUpdates.isStarred = isStarred;
    if (parentIds !== undefined) encryptedUpdates.parentIds = parentIds;
    if (order !== undefined) encryptedUpdates.order = order;

    if (name) {
        encryptedUpdates.name = await encrypt(name);
    }
    if (data !== undefined) {
        encryptedUpdates.data = await encrypt(data as any);
    }

    await TreeNodeModel.findByIdAndUpdate(canonicalNodeId, { $set: encryptedUpdates }).exec();
    await TreeModel.findByIdAndUpdate(canonicalTreeId, { updatedAt: newTimestamp });
    return newTimestamp;
}

export const resequenceSiblings = async (parentId: string | null, treeId: string): Promise<void> => {
    assertId(treeId, 'treeId');
    if (parentId) assertId(parentId, 'parentId');
    const { tree } = await authorizeTreeAccess(treeId, 'editNodes');
    const canonicalTreeId = String(tree._id);

    const parentQuery = parentId ? { parentIds: parentId } : mongoose.trusted({ $or: [mongoose.trusted({ parentIds: mongoose.trusted({ $size: 0 }) }), mongoose.trusted({ parentIds: ['root'] })] });
    const siblings = await TreeNodeModel.find(mongoose.trusted({ treeId: canonicalTreeId, ...parentQuery })).exec();

    if (siblings.length === 0) return;

    // Get contextual order for sorting
    const getContextualOrderForSort = (node: any) => {
        const pIndex = parentId ? (node.parentIds || []).indexOf(parentId) : (node.parentIds || []).indexOf('root');
        const fallbackOrder = siblings.findIndex(s => s.id === node.id);
        const finalPIndex = pIndex === -1 ? 0 : pIndex;
        return (finalPIndex !== -1 && node.order && node.order.length > finalPIndex) ? node.order[finalPIndex] : fallbackOrder;
    };

    siblings.sort((a, b) => getContextualOrderForSort(a) - getContextualOrderForSort(b));

    const bulkOps = siblings.map((sibling, index) => {
        const parentIdToUpdate = parentId || 'root';
        const parentIndex = (sibling.parentIds || []).indexOf(parentIdToUpdate);
        if (parentIndex !== -1) {
            const newOrder = [...sibling.order];
            newOrder[parentIndex] = index; // Explicitly set to zero-based index
            return {
                updateOne: {
                    filter: { _id: sibling._id },
                    update: { $set: { order: newOrder } },
                }
            };
        }
        return null;
    }).filter(op => op !== null);

    if (bulkOps.length > 0) {
        await TreeNodeModel.bulkWrite(bulkOps as any);
        console.log(`INFO: Resequenced ${bulkOps.length} siblings for parent '${parentId || 'root'}'.`);
    }
};

export async function deleteNodeWithChildren(nodeId: string, parentIdToUnlink: string | null, timestamp?: string): Promise<{ deletedIds: string[], newTimestamp: string }> {
    assertId(nodeId, 'nodeId');
    if (parentIdToUnlink) assertId(parentIdToUnlink, 'parentIdToUnlink');
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    await connectToDatabase();

    const node = await TreeNodeModel.findById(nodeId).exec();
    if (!node) return { deletedIds: [], newTimestamp: new Date().toISOString() };

    const canonicalNodeId = String(node._id);
    const canonicalTreeId = String(node.treeId);

    await authorizeTreeAccess(canonicalTreeId, 'editNodes');

    const parentId = parentIdToUnlink ?? 'root';
    const newTimestamp = timestamp || new Date().toISOString();


    // This block handles unlinking one instance of a cloned node.
    if (node.parentIds.length > 1) {
        const parentIndex = node.parentIds.indexOf(parentId);
        if (parentIndex > -1) {
            console.log(`INFO: Unlinking clone instance of node ${canonicalNodeId} from parent ${parentId}`);
            node.parentIds.splice(parentIndex, 1);
            node.order.splice(parentIndex, 1);
            await node.save();
            await TreeModel.findByIdAndUpdate(canonicalTreeId, { updatedAt: newTimestamp });
            // After unlinking, re-sequence the remaining siblings in the old parent context.
            await resequenceSiblings(parentId === 'root' ? null : parentId, canonicalTreeId);
        }
        return { deletedIds: [], newTimestamp }; // Return empty array as no nodes were permanently deleted
    }

    // This block handles deleting a node for good (last instance).
    const deletedIds: string[] = [];
    const parentsToResequence = new Set<string | null>(node.parentIds.length > 0 ? node.parentIds : [null]);


    const findChildrenAndUnlinkOrDelete = async (id: string) => {
        const children = await TreeNodeModel.find({ parentIds: id }).exec();
        for (const child of children) {
            const childId = child._id.toString();
            // If the child is only parented to the node being deleted, it gets deleted too.
            if (child.parentIds.length === 1 && child.parentIds[0] === id) {
                deletedIds.push(childId);
                await findChildrenAndUnlinkOrDelete(childId); // Recurse
            } else {
                // Otherwise, just unlink it from the node being deleted.
                const parentIndex = child.parentIds.indexOf(id);
                if (parentIndex !== -1) {
                    child.parentIds.splice(parentIndex, 1);
                    child.order.splice(parentIndex, 1);
                    await child.save();
                }
            }
        }
    };

    deletedIds.push(canonicalNodeId);
    await findChildrenAndUnlinkOrDelete(canonicalNodeId);

    if (deletedIds.length > 0) {
        await TreeNodeModel.deleteMany({ _id: mongoose.trusted({ $in: deletedIds }) }).exec();
    }

    await TreeModel.findByIdAndUpdate(canonicalTreeId, { updatedAt: newTimestamp });

    // Resequence siblings in all original parent contexts
    const resequencePromises = Array.from(parentsToResequence).map(pid => resequenceSiblings(pid === 'root' ? null : pid, canonicalTreeId));
    await Promise.all(resequencePromises);

    console.log(`INFO: Permanently deleted ${deletedIds.length} nodes from DB.`);
    return { deletedIds, newTimestamp };
}

export async function batchDeleteNodes(deletions: { nodeId: string; parentIdToUnlink: string | null }[], timestamp?: string): Promise<{ deletedIds: string[], newTimestamp: string }> {
    if (!Array.isArray(deletions) || deletions.length === 0) return { deletedIds: [], newTimestamp: timestamp || new Date().toISOString() };

    deletions.forEach(d => {
        assertId(d?.nodeId, 'nodeId');
        if (d?.parentIdToUnlink) assertId(d.parentIdToUnlink, 'parentIdToUnlink');
    });

    let allDeletedIds: string[] = [];
    const newTimestamp = timestamp || new Date().toISOString();

    // We process sequentially to avoid race conditions with tree structure modifications.
    for (const { nodeId, parentIdToUnlink } of deletions) {
        const { deletedIds } = await deleteNodeWithChildren(nodeId, parentIdToUnlink, newTimestamp);
        allDeletedIds.push(...deletedIds);
    }

    // Return only the unique list of permanently deleted node IDs.
    return { deletedIds: Array.from(new Set(allDeletedIds)), newTimestamp };
}


export async function reorderSiblingsForAdd(treeId: string, parentId: string | null, order: number, timestamp?: string) {
    assertId(treeId, 'treeId');
    if (parentId) assertId(parentId, 'parentId');
    const { tree } = await authorizeTreeAccess(treeId, 'editNodes');
    const canonicalTreeId = String(tree._id);

    const parentIdToUpdate = parentId || 'root';
    const newTimestamp = timestamp || new Date().toISOString();

    // Get all siblings in this context
    const siblings = await TreeNodeModel.find({ treeId: canonicalTreeId, parentIds: parentIdToUpdate }).exec();

    // Perform bulk update to increment order
    const bulkOps = siblings
        .filter(s => {
            const parentIndex = s.parentIds.indexOf(parentIdToUpdate);
            return parentIndex !== -1 && s.order[parentIndex] >= order;
        })
        .map(s => {
            const parentIndex = s.parentIds.indexOf(parentIdToUpdate);
            const newOrder = [...s.order];
            newOrder[parentIndex]++;
            return {
                updateOne: {
                    filter: { _id: s._id },
                    update: { $set: { order: newOrder } }
                }
            };
        });

    if (bulkOps.length > 0) {
        await TreeNodeModel.bulkWrite(bulkOps);
    }
    await TreeModel.findByIdAndUpdate(canonicalTreeId, { updatedAt: newTimestamp });
}


export async function batchCreateNodes(nodes: Partial<Omit<TreeNode, 'id' | 'children' | '_id'>>[], timestamp?: string): Promise<{ createdNodes: TreeNode[], newTimestamp: string }> {
    if (!Array.isArray(nodes) || nodes.length === 0) return { createdNodes: [], newTimestamp: timestamp || new Date().toISOString() };

    const treeId = nodes[0]?.treeId;
    if (!treeId) throw new Error("Batch create requires nodes to have a treeId.");
    assertId(treeId, 'treeId');

    // Reject batch if any node does not match the first node's treeId
    for (const n of nodes) {
        if (!n || n.treeId !== treeId) {
            throw new Error("Batch create nodes must all share the same authorized treeId.");
        }
    }

    const { session, tree } = await authorizeTreeAccess(treeId, 'editNodes');
    const canonicalTreeId = String(tree._id);

    const newTimestamp = timestamp || new Date().toISOString();

    const nodesToInsert = await Promise.all(nodes.map(async (n) => {
        const { id, _id, name, data, templateId, isStarred, parentIds, order } = n as any;

        const docId = id || _id;
        if (docId) assertId(docId, 'nodeId');

        const docToInsert: Record<string, any> = {
            name: await encrypt(name),
            data: await encrypt(data || {}),
            userId: session.userId,
            treeId: canonicalTreeId,
            templateId,
            isStarred: !!isStarred,
            parentIds: Array.isArray(parentIds) ? parentIds : ['root'],
            order: Array.isArray(order) ? order : [0],
            createdAt: newTimestamp,
            updatedAt: newTimestamp,
        };

        if (docId) {
            docToInsert._id = docId;
        }
        return docToInsert;
    }));

    const createdDocs = await TreeNodeModel.insertMany(nodesToInsert);

    await TreeModel.findByIdAndUpdate(canonicalTreeId, { updatedAt: newTimestamp });

    const decryptedDocs = await Promise.all(createdDocs.map(async (doc) => {
        const plainDoc = toPlainObject(doc);
        plainDoc.name = await decrypt(plainDoc.name);
        plainDoc.data = await decrypt(plainDoc.data);
        return plainDoc;
    }));
    return { createdNodes: decryptedDocs, newTimestamp };
}


export async function batchUpdateNodes(updates: { id: string; updates: Partial<TreeNode> }[], timestamp?: string): Promise<string> {
    if (!Array.isArray(updates) || updates.length === 0) return timestamp || new Date().toISOString();

    updates.forEach(u => assertId(u?.id, 'nodeId'));

    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    await connectToDatabase();

    const nodeIds = updates.map(u => u.id);
    const nodesToUpdate = await TreeNodeModel.find({ _id: mongoose.trusted({ $in: nodeIds }) }).select('treeId').lean<TreeNode[]>();

    const firstTreeId = nodesToUpdate[0]?.treeId;
    if (!firstTreeId) {
        throw new Error("Could not determine tree for update operation.");
    }

    const firstTreeIdStr = firstTreeId.toString();
    const allNodesInSameTree = nodesToUpdate.every(node => node.treeId.toString() === firstTreeIdStr);
    if (!allNodesInSameTree) {
        throw new Error("Batch updates can only target nodes within the same tree.");
    }

    const { tree } = await authorizeTreeAccess(firstTreeIdStr, 'editNodes');
    const canonicalTreeId = String(tree._id);

    const newTimestamp = timestamp || new Date().toISOString();

    const bulkOps = await Promise.all(updates.map(async ({ id, updates: nodeUpdates }) => {
        const { name, data, templateId, isStarred, parentIds, order } = (nodeUpdates || {}) as any;
        const encryptedUpdates: Record<string, any> = { updatedAt: newTimestamp };
        if (templateId !== undefined) encryptedUpdates.templateId = templateId;
        if (isStarred !== undefined) encryptedUpdates.isStarred = isStarred;
        if (parentIds !== undefined) encryptedUpdates.parentIds = parentIds;
        if (order !== undefined) encryptedUpdates.order = order;

        if (name) {
            encryptedUpdates.name = await encrypt(name);
        }
        if (data !== undefined) {
            encryptedUpdates.data = await encrypt(data as any);
        }

        return {
            updateOne: {
                filter: { _id: id, treeId: canonicalTreeId },
                update: { $set: encryptedUpdates },
            },
        };
    }));

    await TreeNodeModel.bulkWrite(bulkOps);
    await TreeModel.findByIdAndUpdate(canonicalTreeId, { updatedAt: newTimestamp });
    console.log(`INFO: Batch updated ${updates.length} nodes in DB.`);
    return newTimestamp;
}

export async function addParentToNode(nodeId: string, newParentId: string | null, newOrder: number, timestamp?: string): Promise<string> {
    assertId(nodeId, 'nodeId');
    if (newParentId) assertId(newParentId, 'newParentId');

    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    await connectToDatabase();
    const node = await TreeNodeModel.findById(nodeId).exec();
    if (!node) {
        throw new Error("Node to clone not found");
    }

    const canonicalNodeId = String(node._id);
    const canonicalTreeId = String(node.treeId);

    await authorizeTreeAccess(canonicalTreeId, 'editNodes');

    const parentIdToAdd = newParentId || 'root';
    const newTimestamp = timestamp || new Date().toISOString();

    if (!node.parentIds.includes(parentIdToAdd)) {
        node.parentIds.push(parentIdToAdd);
        node.order.push(newOrder);
        await node.save();
        await TreeModel.findByIdAndUpdate(canonicalTreeId, { updatedAt: newTimestamp });
        console.log(`INFO: Cloned node ${canonicalNodeId} under new parent ${parentIdToAdd}`);
    } else {
        const parentIndex = node.parentIds.indexOf(parentIdToAdd);
        if (parentIndex !== -1) {
            node.order[parentIndex] = newOrder;
            await node.save();
            await TreeModel.findByIdAndUpdate(canonicalTreeId, { updatedAt: newTimestamp });
            console.log(`INFO: Updated order for existing clone ${canonicalNodeId} under parent ${parentIdToAdd}`);
        }
    }
    return newTimestamp;
}

export async function removeParentFromNode(nodeId: string, parentIdToRemove: string, timestamp?: string): Promise<string> {
    assertId(nodeId, 'nodeId');
    assertId(parentIdToRemove, 'parentIdToRemove');

    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    await connectToDatabase();
    const node = await TreeNodeModel.findById(nodeId).exec();
    if (!node) {
        throw new Error("Node not found for unlinking.");
    }

    const canonicalNodeId = String(node._id);
    const canonicalTreeId = String(node.treeId);

    await authorizeTreeAccess(canonicalTreeId, 'editNodes');

    const parentIdString = parentIdToRemove || 'root';
    const newTimestamp = timestamp || new Date().toISOString();
    const parentIndex = node.parentIds.indexOf(parentIdString);

    if (parentIndex > -1) {
        node.parentIds.splice(parentIndex, 1);
        node.order.splice(parentIndex, 1);
        await node.save();
        await TreeModel.findByIdAndUpdate(canonicalTreeId, { updatedAt: newTimestamp });
        await resequenceSiblings(parentIdString === 'root' ? null : parentIdString, canonicalTreeId);
        console.log(`INFO: Unlinked node ${canonicalNodeId} from parent ${parentIdString} and resequenced siblings.`);
    }

    return newTimestamp;
}


// --- Attachment Function (Filesystem-based) ---

export async function saveAttachment(userId: string, relativePath: string, dataUri: string, originalFileName: string): Promise<AttachmentInfo> {
    assertId(userId, 'userId');
    const session = await getSession();
    if (!session?.userId || session.userId !== userId) throw new Error("Authentication required.");

    const DATA_DIR = getDataDir();
    const USERS_DIR = path.join(DATA_DIR, 'users');

    const cleanRelativePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(USERS_DIR, userId, 'attachments', cleanRelativePath);

    if (!fullPath.startsWith(path.join(USERS_DIR, userId, 'attachments'))) {
        throw new Error("Access denied: path is outside of the user's attachments directory.");
    }

    // Ensure the directory for the file exists
    const dirName = path.dirname(fullPath);
    await fs.mkdir(dirName, { recursive: true });

    const matches = dataUri.match(/^data:(.*);base64,(.*)$/);
    if (!matches) {
        throw new Error('Invalid Data URI for attachment');
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    await fs.writeFile(fullPath, buffer);

    const serverPath = path.join('/attachments', userId, cleanRelativePath).replace(/\\/g, '/');
    console.log(`INFO: Saved attachment for user ${userId} at ${serverPath}`);

    return {
        path: serverPath,
        name: originalFileName,
        size: buffer.length,
        type: mimeType,
    };
}


// --- Example Functions (Filesystem-based) ---

export async function listExamples(): Promise<ExampleInfo[]> {
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    const EXAMPLES_DIR = path.join(process.cwd(), 'public', 'examples');
    try {
        const files = await fs.readdir(EXAMPLES_DIR);
        const exampleInfo = await Promise.all(
            files
                .filter(file => file.endsWith('.json'))
                .map(async (file) => {
                    const filePath = path.join(EXAMPLES_DIR, file);
                    const data = await fs.readFile(filePath, 'utf-8');
                    const content = JSON.parse(data) as Partial<TreeFile> & { title?: string };
                    return {
                        fileName: file,
                        title: content.title || 'Untitled Example'
                    };
                })
        );
        return exampleInfo;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            await fs.mkdir(EXAMPLES_DIR, { recursive: true });
            return [];
        }
        console.error("Failed to list examples", error);
        return [];
    }
}
export async function loadExampleFromFile(fileName: string): Promise<Partial<TreeFile> | null> {
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    // Reject anything that isn't a bare filename — no path separators, no traversal.
    if (
        typeof fileName !== 'string' ||
        fileName.length === 0 ||
        fileName.length > 255 ||
        fileName !== path.basename(fileName) ||
        !fileName.endsWith('.json')
    ) {
        throw new Error("Invalid example file name.");
    }

    await connectToDatabase();
    const EXAMPLES_DIR = path.join(process.cwd(), 'public', 'examples');
    const filePath = path.join(EXAMPLES_DIR, fileName);

    // Defense in depth: even after the basename check above, confirm the
    // resolved path still lives inside EXAMPLES_DIR.
    if (!filePath.startsWith(EXAMPLES_DIR + path.sep)) {
        throw new Error("Access denied.");
    }

    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}


// --- Archive/Storage Functions (Filesystem-based) ---

export async function fetchFileAsBuffer(userId: string, serverPath: string): Promise<Buffer> {
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    const DATA_DIR = getDataDir();

    const pathParts = serverPath.split('/').filter(Boolean); // e.g., ['attachments', 'userId', 'fileName.ext']
    if (pathParts.length < 3 || pathParts[0] !== 'attachments') {
        throw new Error("Invalid or forbidden file path for fetcher.");
    }

    const fileOwnerId = pathParts[1];

    // We allow the fetch if the user is authenticated. 
    // This supports archive exports for shared trees.
    // The high entropy of the filename (Timestamp + UUID) protects against unauthorized discovery.

    const cleanRelativePath = path.join(...pathParts.slice(2));
    const fullPath = path.join(DATA_DIR, 'users', fileOwnerId, 'attachments', cleanRelativePath);

    // Final security check to prevent any directory traversal shenanigans
    if (!fullPath.startsWith(path.join(DATA_DIR, 'users'))) {
        throw new Error("Access denied.");
    }

    try {
        return await fs.readFile(fullPath);
    } catch (error) {
        console.error(`Failed to fetch file: ${fullPath}`, error);
        throw new Error(`Could not read file: ${serverPath}`);
    }
}

// --- Git Provider Functions ---

export async function createRepo(
    token: string,
    repoName: string,
    isPrivate: boolean
): Promise<{ success: boolean; repo?: GitProvider; error?: string }> {
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    try {
        const octokit = new Octokit({ auth: token });
        const response = await octokit.rest.repos.createForAuthenticatedUser({
            name: repoName,
            private: isPrivate,
            auto_init: true,
            description: 'Data for Treelab application',
        });

        if (response.status === 201) {
            const repoData = response.data;
            return {
                success: true,
                repo: {
                    owner: repoData.owner.login,
                    name: repoData.name,
                    fullName: repoData.full_name,
                    defaultBranch: repoData.default_branch,
                },
            };
        } else {
            return { success: false, error: `GitHub API returned status ${response.status}` };
        }
    } catch (error: any) {
        console.error('Failed to create GitHub repository:', error);
        return { success: false, error: error.message || 'An unknown error occurred' };
    }
}

// Helper to sanitize node names for directory/file paths
const sanitizeName = (name: string) => String(name).replace(/[\\?%*:|"<>]/g, '_').replace(/\s+/g, '-');

const getFullNodePath = (node: TreeNode, allNodesMap: Map<string, TreeNode>): string => {
    const pathParts: string[] = [];
    let current: TreeNode | undefined = node;
    while (current) {
        pathParts.unshift(sanitizeName(current.name));
        const parentId: string | undefined = current.parentIds?.[0];
        current = parentId ? allNodesMap.get(parentId) : undefined;
    }
    return path.join(...pathParts);
};


export async function commitTreeFileToRepo(
    token: string,
    treeId: string,
    message: string,
    treeFileToCommit?: TreeFile
): Promise<{ success: boolean; error?: string; commitSha?: string }> {
    assertId(treeId, 'treeId');
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    const treeFile = treeFileToCommit || await loadTreeFile(treeId);

    if (!treeFile || !treeFile.gitSync) {
        return { success: false, error: "Tree is not linked to a repository." };
    }

    if (treeFile.userId.toString() !== session.userId) {
        throw new Error("Authorization denied.");
    }

    const octokit = new Octokit({ auth: token });
    const { repoOwner, repoName, branch } = treeFile.gitSync;

    try {
        const { data: branchData } = await octokit.rest.repos.getBranch({
            owner: repoOwner,
            repo: repoName,
            branch,
        });
        const latestCommitSha = branchData.commit.sha;

        const allNodesMap = new Map<string, TreeNode>();
        const buildNodeMap = (nodes: TreeNode[]) => {
            for (const node of nodes) {
                allNodesMap.set(node.id, node);
                if (node.children) buildNodeMap(node.children);
            }
        };
        buildNodeMap(treeFile.tree);

        const treePayload: { path: string; mode: '100644'; type: 'blob'; content: string }[] = [];

        const treeJsonData = generateJsonForExport(treeFile.title, treeFile.tree, treeFile.templates);

        treePayload.push({
            path: 'tree.json',
            mode: '100644',
            type: 'blob',
            content: JSON.stringify(treeJsonData, null, 2),
        });

        const traverseAndCreateTree = (nodes: TreeNode[], currentPath: string) => {
            for (const node of nodes) {
                const template = treeFile.templates.find((t) => t.id === node.templateId);
                if (!template) continue;

                const nodePath = path.join(currentPath, sanitizeName(node.name)).replace(/\\/g, '/');
                const bodyContent = generateNodeName(template, node.data, template.bodyTemplate);

                treePayload.push({
                    path: `${nodePath}.md`,
                    mode: '100644',
                    type: 'blob',
                    content: bodyContent,
                });

                if (node.children && node.children.length > 0) {
                    traverseAndCreateTree(node.children, nodePath);
                }
            }
        };
        traverseAndCreateTree(treeFile.tree, "");

        const { data: newTree } = await octokit.rest.git.createTree({
            owner: repoOwner,
            repo: repoName,
            tree: treePayload,
            base_tree: branchData.commit.commit.tree.sha,
        });

        const { data: newCommit } = await octokit.rest.git.createCommit({
            owner: repoOwner,
            repo: repoName,
            message,
            tree: newTree.sha,
            parents: [latestCommitSha],
        });

        await octokit.rest.git.updateRef({
            owner: repoOwner,
            repo: repoName,
            ref: `heads/${branch}`,
            sha: newCommit.sha,
        });

        return { success: true, commitSha: newCommit.sha };
    } catch (error: any) {
        console.error("Failed to commit to GitHub:", error);
        return { success: false, error: error.message || "An unknown error occurred while committing to GitHub." };
    }
}


export async function getRepoCommits(token: string, owner: string, repo: string, branch: string): Promise<{ success: true; commits: GitCommit[] } | { success: false; error: string }> {
    const octokit = new Octokit({ auth: token });
    try {
        const { data: commits } = await octokit.rest.repos.listCommits({
            owner,
            repo,
            sha: branch,
            per_page: 30,
        });
        const mappedCommits = commits.map(c => ({
            sha: c.sha,
            message: c.commit.message,
            author: c.commit.author?.name || 'Unknown',
            date: c.commit.author?.date || new Date().toISOString(),
        }));
        return { success: true, commits: mappedCommits };
    } catch (error: any) {
        console.error("Failed to fetch repository commits:", error);
        return { success: false, error: error.message || "Failed to fetch repository commits." };
    }
}

export async function getLatestCommitSha(token: string, owner: string, repo: string, branch: string): Promise<{ success: true; sha: string } | { success: false; error: string }> {
    const octokit = new Octokit({ auth: token });
    try {
        const { data: branchData } = await octokit.rest.repos.getBranch({ owner, repo, branch });
        return { success: true, sha: branchData.commit.sha };
    } catch (error: any) {
        console.error("Failed to fetch latest commit SHA:", error);
        return { success: false, error: error.message || "Failed to fetch latest commit SHA." };
    }
}

export async function getTreeFromGit(token: string, owner: string, repo: string, sha: string): Promise<{ success: true; treeData: Partial<TreeFile> } | { success: false; error: string }> {
    const octokit = new Octokit({ auth: token });

    try {
        const { data: content } = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: 'tree.json',
            ref: sha,
        });

        if ('content' in content && typeof content.content === 'string') {
            const fileContent = Buffer.from(content.content, 'base64').toString('utf-8');
            return { success: true, treeData: JSON.parse(fileContent) };
        } else {
            return { success: false, error: "'tree.json' is not a file in the repository." };
        }
    } catch (error: any) {
        if (error.status === 404) {
            console.warn(`WARN: 'tree.json' not found in commit ${sha}. Returning empty tree.`);
            return {
                success: true,
                treeData: {
                    title: "Synced Tree",
                    tree: [],
                    templates: [],
                    expandedNodeIds: [],
                }
            };
        }
        console.error("Failed to get tree from git:", error);
        return { success: false, error: error.message || "Failed to get tree from repository." };
    }
}

export async function shareTreeWithUser(treeId: string, userId: string, permissions?: Partial<TreePermissions>): Promise<void> {
    assertId(treeId, 'treeId');
    assertId(userId, 'userId');
    const { tree } = await authorizeTreeAccess(treeId, 'admin');
    const canonicalTreeId = String(tree._id);

    const resolvedPermissions: TreePermissions = {
        editNodes: permissions?.editNodes ?? false,
        editTemplates: permissions?.editTemplates ?? false,
        admin: permissions?.admin ?? false,
    };

    // Remove from legacy sharedWith if present
    await TreeModel.findByIdAndUpdate(canonicalTreeId, { $pull: { sharedWith: userId } }).exec();

    // Remove existing share entry for this user (if any) before adding
    await TreeModel.findByIdAndUpdate(canonicalTreeId, { $pull: { shares: { userId } } }).exec();

    // Add the new share entry
    await TreeModel.findByIdAndUpdate(canonicalTreeId, {
        $addToSet: { shares: { userId, permissions: resolvedPermissions } }
    }).exec();
}

export async function revokeShareFromUser(treeId: string, userId: string): Promise<void> {
    assertId(treeId, 'treeId');
    assertId(userId, 'userId');
    const { tree } = await authorizeTreeAccess(treeId, 'admin');
    const canonicalTreeId = String(tree._id);

    // Remove from both legacy sharedWith and new shares
    await TreeModel.findByIdAndUpdate(canonicalTreeId, {
        $pull: { sharedWith: userId, shares: { userId } }
    }).exec();
}

export async function setTreePublicStatus(treeId: string, isPublic: boolean): Promise<string | undefined> {
    assertId(treeId, 'treeId');
    const { tree } = await authorizeTreeAccess(treeId, 'admin');
    const canonicalTreeId = String(tree._id);

    // Generate a publicId if the tree doesn't have one yet (Mongoose defaults don't run on findByIdAndUpdate)
    const updatePayload: Record<string, any> = { isPublic: !!isPublic };
    if (!tree.publicId) {
        updatePayload.publicId = crypto.randomUUID();
    }

    const updated = await TreeModel.findByIdAndUpdate(canonicalTreeId, updatePayload, { new: true }).lean<Omit<TreeFile, 'tree'>>();
    return updated?.publicId;
}

// --- Team Management Functions ---

export async function createTeam(name: string, leaderIds: string[]): Promise<Team> {
    if (Array.isArray(leaderIds)) {
        leaderIds.forEach(id => assertId(id, 'leaderId'));
    }
    const session = await getSession();
    const user = await UserModel.findById(session?.userId).lean<User>();
    if (!user?.isAdmin) throw new Error("Authorization denied: Only admins can create teams.");

    await connectToDatabase();
    const newTeam = new TeamModel({
        name,
        leaderIds,
        memberIds: leaderIds, // Leaders are implicitly members
        createdBy: session!.userId,
    });
    await newTeam.save();
    return JSON.parse(JSON.stringify(newTeam.toObject()));
}

export async function loadUserTeams(): Promise<Team[]> {
    const session = await getSession();
    if (!session?.userId) return [];

    await connectToDatabase();
    const user = await UserModel.findById(session.userId).lean<User>();

    let query = {};
    if (!user?.isAdmin) {
        query = mongoose.trusted({
            $or: [
                { memberIds: session.userId },
                { leaderIds: session.userId }
            ]
        });
    }

    const teams = await TeamModel.find(query).lean<Team[]>().exec();
    return teams.map((t: any) => ({ ...t, id: t._id.toString() }));
}

export async function updateTeamMembers(teamId: string, memberIds: string[]): Promise<void> {
    assertId(teamId, 'teamId');
    if (Array.isArray(memberIds)) {
        memberIds.forEach(id => assertId(id, 'memberId'));
    }

    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    await connectToDatabase();
    const team = await TeamModel.findById(teamId).lean<Team>();
    if (!team) throw new Error("Team not found.");

    const canonicalTeamId = String((team as any)._id || teamId);
    const user = await UserModel.findById(session.userId).lean<User>();
    const isLeader = team.leaderIds.includes(session.userId);
    if (!user?.isAdmin && !isLeader) throw new Error("Authorization denied: Only admins or team leaders can manage members.");

    await TeamModel.findByIdAndUpdate(canonicalTeamId, { memberIds: Array.from(new Set([...memberIds, ...team.leaderIds])) }).exec();
}

export async function assignTeamLeaders(teamId: string, leaderIds: string[]): Promise<void> {
    assertId(teamId, 'teamId');
    if (Array.isArray(leaderIds)) {
        leaderIds.forEach(id => assertId(id, 'leaderId'));
    }

    const session = await getSession();
    const user = await UserModel.findById(session?.userId).lean<User>();
    if (!user?.isAdmin) throw new Error("Authorization denied: Only admins can assign team leaders.");

    await connectToDatabase();
    const team = await TeamModel.findById(teamId).lean<Team>();
    if (!team) throw new Error("Team not found.");

    const canonicalTeamId = String((team as any)._id || teamId);
    // Leaders are also members
    await TeamModel.findByIdAndUpdate(canonicalTeamId, {
        leaderIds,
        $addToSet: { memberIds: { $each: leaderIds } }
    }).exec();
}

export async function deleteTeam(teamId: string): Promise<void> {
    assertId(teamId, 'teamId');
    const session = await getSession();
    const user = await UserModel.findById(session?.userId).lean<User>();
    if (!user?.isAdmin) throw new Error("Authorization denied: Only admins can delete teams.");

    await connectToDatabase();
    const teamToDelete = await TeamModel.findById(teamId);
    if (!teamToDelete) return;

    const canonicalTeamId = String(teamToDelete._id);
    await TeamModel.findByIdAndDelete(canonicalTeamId).exec();
    // Also cleanup teamShares in trees
    await TreeModel.updateMany({}, { $pull: { teamShares: { teamId: canonicalTeamId } } }).exec();
}

export async function renameTeam(teamId: string, newName: string): Promise<void> {
    assertId(teamId, 'teamId');
    const session = await getSession();
    if (!session?.userId) throw new Error("Authentication required.");

    await connectToDatabase();
    const team = await TeamModel.findById(teamId);
    if (!team) throw new Error("Team not found.");

    const user = await UserModel.findById(session.userId).lean<User>();
    const isLeader = team.leaderIds.includes(session.userId);
    if (!user?.isAdmin && !isLeader) {
        throw new Error("Authorization denied: Only admins or team leaders can rename the team.");
    }

    team.name = newName;
    await team.save();
}

export async function shareTreeWithTeam(treeId: string, teamId: string, permissions?: Partial<TreePermissions>): Promise<void> {
    assertId(treeId, 'treeId');
    assertId(teamId, 'teamId');
    const { session, perms, tree } = await authorizeTreeAccess(treeId, 'admin');
    const canonicalTreeId = String(tree._id);

    // Check if the user belongs to the team they are sharing with
    const team = await TeamModel.findById(teamId).lean<Team>();
    if (!team) throw new Error("Team not found.");

    const canonicalTeamId = String((team as any)._id || teamId);
    const isMember = team.memberIds.includes(session.userId) || team.leaderIds.includes(session.userId);
    if (!isMember && !perms.isOwner) throw new Error("Authorization denied: You can only share trees with teams you belong to.");

    const resolvedPermissions: TreePermissions = {
        editNodes: permissions?.editNodes ?? false,
        editTemplates: permissions?.editTemplates ?? false,
        admin: permissions?.admin ?? false,
    };

    await TreeModel.findByIdAndUpdate(canonicalTreeId, { $pull: { teamShares: { teamId: canonicalTeamId } } }).exec();
    await TreeModel.findByIdAndUpdate(canonicalTreeId, {
        $addToSet: { teamShares: { teamId: canonicalTeamId, permissions: resolvedPermissions } }
    }).exec();
}

export async function revokeShareFromTeam(treeId: string, teamId: string): Promise<void> {
    assertId(treeId, 'treeId');
    assertId(teamId, 'teamId');
    const { tree } = await authorizeTreeAccess(treeId, 'admin');
    const canonicalTreeId = String(tree._id);

    await TreeModel.findByIdAndUpdate(canonicalTreeId, {
        $pull: { teamShares: { teamId } }
    }).exec();
}
