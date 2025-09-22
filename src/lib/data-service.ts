

/**
 * @fileoverview
 * This service handles all data persistence for the application by interacting
 * with the server's filesystem. It provides functions to read, write, and delete
 * JSON data for trees and users, as well as handle binary files for images.
 */
'use server';

import fs from 'fs/promises';
import path from 'path';
import { TreeFile, User, ExampleInfo, GlobalSettings, AttachmentInfo, TreeNode, StorageInfo, PurgeResult, GitProvider, GitBlob, GitCommit, Template } from './types';
import { lookup } from 'mime-types';
import { Octokit } from 'octokit';
import { connectToDatabase } from './mongodb';
import { UserModel, TreeModel, TreeNodeModel } from './models';
import { encrypt, decrypt } from './encryption';
import mongoose from 'mongoose';
import { generateJsonForExport, generateNodeName } from './utils';


export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

export async function findNodeById(nodeId: string): Promise<TreeNode | null> {
    await connectToDatabase();
    const node = await TreeNodeModel.findById(nodeId).lean<TreeNode>().exec();
    if (!node) return null;

    // Decrypt sensitive fields after loading
    node.name = await decrypt(node.name);
    node.data = await decrypt(node.data);

    return toPlainObject(node);
}

// Helper to convert a Mongoose doc to a plain object, ensuring it's serializable.
const toPlainObject = (doc: any): any => {
    if (!doc) return null;
    const obj = doc.toObject ? doc.toObject({getters: true, virtuals: true}) : doc;
    
    const plain: any = { id: obj._id ? obj._id.toString() : obj.id };
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key) && key !== '_id' && key !== '__v') {
            plain[key] = obj[key];
        }
    }
    return plain;
};

// --- TreeFile Functions (MongoDB) ---

export async function createTreeFile(treeFile: Omit<TreeFile, 'tree' | 'id'>, initialNodes: Omit<TreeNode, 'id' | 'children' | '_id'>[]): Promise<TreeFile> {
  await connectToDatabase();
  try {
    const { id, _id, nodes, rootNodeIds, ...rest } = treeFile as any;
    const dataWithCleanedExpandedIds = { ...rest, expandedNodeIds: [] };
    const newTreeFile = new TreeModel(dataWithCleanedExpandedIds);
    const savedTreeFile = await newTreeFile.save();
    
    if (initialNodes && initialNodes.length > 0) {
      const nodesToCreate = await Promise.all(initialNodes.map(async (node: Omit<TreeNode, 'id' | 'children' | '_id'>) => ({
        ...node,
        name: await encrypt(node.name), // Encrypt name
        data: await encrypt(node.data), // Encrypt data
        treeId: savedTreeFile.id,
      })));
      await TreeNodeModel.insertMany(nodesToCreate);
    }
    
    console.log(`INFO: Created tree '${savedTreeFile.title}' (ID: ${savedTreeFile.id}) and initial nodes in DB`);
    
    const treeNodes = await loadTreeNodes(savedTreeFile.id);
    
    const plainTreeFile = toPlainObject(savedTreeFile);
    return { ...plainTreeFile, tree: treeNodes };

  } catch (error) {
    console.error("Error creating tree file:", error);
    throw error;
  }
}

export async function saveTreeFile(treeFile: Partial<Omit<TreeFile, 'tree'>> & {id: string}): Promise<void> {
  await connectToDatabase();
  const { id, ...treeData } = treeFile;
  const updatePayload: any = { 
    $set: { ...treeData, updatedAt: new Date().toISOString() } 
  };

  // If gitSync is explicitly not present in the update data, it means we are unlinking.
  if (!('gitSync' in treeData)) {
    updatePayload.$unset = { gitSync: 1 };
  }
  
  await TreeModel.findByIdAndUpdate(id, updatePayload).exec();
  console.log(`INFO: Saved tree meta '${treeFile.title}' (ID: ${treeFile.id}) to DB`);
}

export async function updateTreeOrder(updates: { id: string; order: number }[]) {
    if (!Array.isArray(updates) || updates.length === 0) {
      console.warn('updateTreeOrder called with no updates');
      return { success: false, modifiedCount: 0 };
    }
    
    console.log(`INFO: Updating order for ${updates.length} trees in DB.`);
    await connectToDatabase();
  
    try {
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
  await connectToDatabase();
  const treeFileDoc = await TreeModel.findById(treeId).lean<Omit<TreeFile, 'tree'>>().exec();
  if (!treeFileDoc) return null;

  const nodes = await loadTreeNodes(treeId);
  const plainDoc: TreeFile = { 
      ...(treeFileDoc as any), 
      id: treeFileDoc._id.toString(),
      tree: nodes 
  };
  delete (plainDoc as any)._id;
  delete (plainDoc as any).__v;
  
  return plainDoc;
}

export async function loadPublicTreeFile(treeId: string): Promise<TreeFile | null> {
  await connectToDatabase();
  const treeFileDoc = await TreeModel.findOne({ _id: treeId, isPublic: true }).lean<Omit<TreeFile, 'tree'>>().exec();
  if (!treeFileDoc) return null;

  const nodes = await loadTreeNodes(treeId);
  const plainDoc: TreeFile = { 
      ...(treeFileDoc as any), 
      id: treeFileDoc._id.toString(),
      tree: nodes 
  };
  delete (plainDoc as any)._id;
  delete (plainDoc as any).__v;
  
  return plainDoc;
}


export async function loadAllTreeFiles(userId: string): Promise<TreeFile[]> {
  await connectToDatabase();
  const treeFileDocs = await TreeModel.find({ 
    $or: [
      { userId: userId },
      { sharedWith: { $in: [userId] } }
    ]
  }).lean<Omit<TreeFile, 'tree' & { _id: any }>[]>().exec();
  
  const treeIds = treeFileDocs.map((t: any) => t._id.toString());
  // Fetch all nodes for the user in one go
  const allNodesForUser = await TreeNodeModel.find({ treeId: { $in: treeIds } }).lean<TreeNode[]>().exec();

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
  
  const fullTreeFiles = treeFileDocs.map((doc: any) => {
    const treeId = doc._id.toString();
    const nodesForTree = nodesByTreeId.get(treeId) || [];
    const hierarchicalNodes = buildTreeHierarchy(nodesForTree);
    
    const plainDoc: TreeFile = { 
      id: treeId,
      userId: doc.userId,
      sharedWith: doc.sharedWith,
      title: doc.title,
      isPublic: doc.isPublic,
      templates: doc.templates,
      expandedNodeIds: doc.expandedNodeIds,
      gitSync: doc.gitSync,
      order: doc.order,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      tree: hierarchicalNodes 
    };
    return plainDoc;
  });
  
  return fullTreeFiles;
}

export async function deleteTreeFile(treeId: string): Promise<void> {
    await connectToDatabase();
    try {
        // Perform deletions sequentially
        await TreeNodeModel.deleteMany({ treeId });
        await TreeModel.findByIdAndDelete(treeId);
        
        console.log(`INFO: Deleted tree (ID: ${treeId}) and all associated nodes from DB`);
    } catch (error) {
        console.error("Error deleting tree file:", error);
        throw error;
    }
}


export async function deleteTreeFilesByUserId(userId: string): Promise<void> {
    await connectToDatabase();
    try {
        const treesToDelete = await TreeModel.find({ userId: userId }).select('_id').lean();
        const treeIds = treesToDelete.map((t: any) => t._id.toString());
        
        if (treeIds.length > 0) {
            await TreeNodeModel.deleteMany({ treeId: { $in: treeIds } });
            await TreeModel.deleteMany({ _id: { $in: treeIds } });
        }
        
        console.log(`INFO: Deleted all trees and nodes for user ${userId} from DB`);
    } catch (error) {
        console.error("Error deleting tree files by user ID:", error);
        throw error;
    }
}


// --- TreeNode Functions ---

const buildTreeHierarchy = (nodes: TreeNode[]): TreeNode[] => {
    if (!nodes || nodes.length === 0) return [];

    const nodeMap = new Map<string, TreeNode>();
    nodes.forEach((node: any) => {
        const plainNode = toPlainObject(node);
        nodeMap.set(plainNode.id, { ...plainNode, children: [] });
    });

    const rootNodes: TreeNode[] = [];
    
    nodeMap.forEach(node => {
        // Treat an empty parentIds array as equivalent to ['root'] for backward compatibility
        const parentIds = node.parentIds && node.parentIds.length > 0 ? node.parentIds : ['root'];

        parentIds.forEach((parentId, index) => {
            const isRootInstance = parentId === 'root';
            const instanceNode = { ...node }; // Create a distinct object for each instance

            if (isRootInstance) {
                rootNodes.push(instanceNode);
            } else {
                const parentNode = nodeMap.get(parentId);
                if (parentNode) {
                    parentNode.children.push(instanceNode);
                }
            }
        });
    });

    const sortChildrenRecursive = (nodesToSort: TreeNode[]) => {
        nodesToSort.forEach(node => {
            if (node.children && node.children.length > 1) {
                node.children.sort((a, b) => {
                    const parentId = node.id;
                    const aIndex = (a.parentIds || ['root']).indexOf(parentId);
                    const bIndex = (b.parentIds || ['root']).indexOf(parentId);
                    const orderA = aIndex !== -1 && a.order && a.order.length > aIndex ? a.order[aIndex] : 0;
                    const orderB = bIndex !== -1 && b.order && b.order.length > bIndex ? b.order[bIndex] : 0;
                    return orderA - orderB;
                });
                sortChildrenRecursive(node.children);
            }
        });
    };
    
    sortChildrenRecursive(Array.from(nodeMap.values()));
    
    rootNodes.sort((a, b) => {
        const aIndex = (a.parentIds || ['root']).indexOf('root');
        const bIndex = (b.parentIds || ['root']).indexOf('root');
        const orderA = aIndex !== -1 && a.order && a.order.length > aIndex ? a.order[aIndex] : 0;
        const orderB = bIndex !== -1 && b.order && b.order.length > bIndex ? b.order[bIndex] : 0;
        return orderA - orderB;
    });

    // Remove duplicates from rootNodes based on a unique instance identifier (id + parentId)
    const uniqueRootNodes = Array.from(new Map(rootNodes.map(n => [`${n.id}_root`, n])).values());
    
    return uniqueRootNodes;
};

export async function loadTreeNodes(treeId: string): Promise<TreeNode[]> {
    await connectToDatabase();
    const nodes = await TreeNodeModel.find({ treeId }).lean<TreeNode[]>().exec();

    // Decrypt data after fetching
    for (const node of nodes) {
        node.name = await decrypt(node.name);
        node.data = await decrypt(node.data);
    }

    return buildTreeHierarchy(nodes);
}

export async function createNode(nodeData: Omit<TreeNode, 'id' | 'children'> & { _id?: string, id?: string }): Promise<TreeNode> {
    await connectToDatabase();
    const { id, name, data, ...rest } = nodeData as any;
    
    const dataToSave = {
        ...rest,
        name: await encrypt(name),
        data: await encrypt(data || {}),
    };

    const documentToSave = id ? { ...dataToSave, _id: id } : dataToSave;
    
    const newNode = new TreeNodeModel(documentToSave);
    await newNode.save();
    
    await TreeModel.findByIdAndUpdate(newNode.treeId, { updatedAt: new Date().toISOString() });
    
    const plainNode = toPlainObject(newNode);
    
    // Decrypt for returning to the client
    plainNode.name = await decrypt(plainNode.name);
    plainNode.data = await decrypt(plainNode.data);

    return { ...plainNode, children: [] };
}

export async function updateNode(nodeId: string, updates: Partial<Omit<TreeNode, 'id' | 'children'>>): Promise<void> {
    await connectToDatabase();
    
    const node = await TreeNodeModel.findById(nodeId).select('treeId').lean<TreeNode>();
    if (!node) return;

    const { name, data, ...restOfUpdates } = updates;
    const encryptedUpdates: { [key: string]: any } = { ...restOfUpdates, updatedAt: new Date().toISOString() };
    
    if (name) {
        encryptedUpdates.name = await encrypt(name);
    }
    if (data !== undefined) {
        encryptedUpdates.data = await encrypt(data as any);
      }

    await TreeNodeModel.findByIdAndUpdate(nodeId, encryptedUpdates).exec();
    await TreeModel.findByIdAndUpdate(node.treeId, { updatedAt: new Date().toISOString() });
}

const resequenceSiblings = async (parentId: string | null, treeId: string): Promise<void> => {
    const parentQuery = parentId ? { parentIds: parentId } : { $or: [{ parentIds: { $size: 0 } }, { parentIds: ['root'] }] };
    const siblings = await TreeNodeModel.find({ treeId, ...parentQuery }).exec();

    if (siblings.length === 0) return;

    // Get contextual order for sorting
    const getContextualOrder = (node: TreeNode) => {
        const pIndex = parentId ? (node.parentIds || []).indexOf(parentId) : (node.parentIds || []).indexOf('root');
        const fallbackOrder = siblings.findIndex(s => s.id === node.id);
        const finalPIndex = pIndex === -1 ? 0 : pIndex;
        return (finalPIndex !== -1 && node.order && node.order.length > finalPIndex) ? node.order[finalPIndex] : fallbackOrder;
    };

    siblings.sort((a, b) => getContextualOrder(a) - getContextualOrder(b));

    const bulkOps = siblings.map((sibling, index) => {
        const parentIdToUpdate = parentId || 'root';
        const parentIndex = (sibling.parentIds || []).indexOf(parentIdToUpdate);
        if (parentIndex !== -1) {
            const newOrder = [...sibling.order];
            newOrder[parentIndex] = index;
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

export async function deleteNodeWithChildren(nodeId: string, parentIdToUnlink: string | null): Promise<string[]> {
    await connectToDatabase();
    
    const node = await TreeNodeModel.findById(nodeId).exec();
    if (!node) return [];

    const treeId = node.treeId.toString();
    const effectiveParentIds = node.parentIds.length === 0 ? ['root'] : node.parentIds;
    const parentId = parentIdToUnlink ?? 'root';


    // This block handles unlinking one instance of a cloned node.
    if (effectiveParentIds.length > 1) {
        const parentIndex = node.parentIds.indexOf(parentId);
        if (parentIndex > -1) {
            node.parentIds.splice(parentIndex, 1);
            node.order.splice(parentIndex, 1);
            await node.save();
            await TreeModel.findByIdAndUpdate(treeId, { updatedAt: new Date().toISOString() });
            // After unlinking, re-sequence the remaining siblings.
            await resequenceSiblings(parentId === 'root' ? null : parentId, treeId);
        }
        return [];
    }

    // This block handles deleting a node for good (last instance).
    const deletedIds: string[] = [];
    const nodesToResequenceParents: (string | null)[] = node.parentIds.length > 0 ? [...node.parentIds] : [null];

    const findChildrenRecursive = async (id: string) => {
        const children = await TreeNodeModel.find({ parentIds: id }).lean<TreeNode[]>().exec();
        for (const child of children) {
            const childId = child._id.toString();
            const childDoc = await TreeNodeModel.findById(childId).exec();
            if (childDoc) {
                if (childDoc.parentIds.length === 1 && childDoc.parentIds[0] === id) {
                    deletedIds.push(childId);
                    await findChildrenRecursive(childId);
                } else {
                    const parentIndex = childDoc.parentIds.indexOf(id);
                    if (parentIndex !== -1) {
                        childDoc.parentIds.splice(parentIndex, 1);
                        childDoc.order.splice(parentIndex, 1);
                    }
                    await childDoc.save();
                }
            }
        }
    };

    deletedIds.push(nodeId);
    await findChildrenRecursive(nodeId);

    await TreeNodeModel.deleteMany({ _id: { $in: deletedIds } }).exec();
    await TreeModel.findByIdAndUpdate(treeId, { updatedAt: new Date().toISOString() });
    
    // Resequence siblings in all original parent contexts
    const resequencePromises = Array.from(new Set(nodesToResequenceParents)).map(pid => resequenceSiblings(pid === 'root' ? null : pid, treeId));
    await Promise.all(resequencePromises);
    
    return deletedIds;
}

export async function reorderSiblings(nodes: { id: string; order: number[] }[]): Promise<void> {
    await connectToDatabase();
    if (nodes.length === 0) return;
    const bulkOps = nodes.map(node => ({
        updateOne: {
            filter: { _id: node.id },
            update: { $set: { order: node.order } },
        }
    }));
    await TreeNodeModel.bulkWrite(bulkOps);
}

export async function batchCreateNodes(nodes: Partial<Omit<TreeNode, 'id' | 'children' | '_id'>>[]): Promise<TreeNode[]> {
    await connectToDatabase();
    console.log("DB DEBUG: batchCreateNodes called with", nodes.length, "nodes");
  
    if (nodes.length === 0) return [];
  
    const treeId = nodes[0]?.treeId; // Assume all nodes are for the same tree
    if (!treeId) throw new Error("Batch create requires nodes to have a treeId.");

    const nodesToInsert = await Promise.all(nodes.map(async (n) => {
      const { id, _id, name, data, ...rest } = n as any;
      console.log("DB DEBUG: Preparing node for insert", { _id: _id || id, name, data });
      return {
        ...rest,
        name: await encrypt(name),
        data: await encrypt(data),
        _id: _id || id,
      };
    }));
  
    console.log("DB DEBUG: Inserting nodes into Mongo", nodesToInsert);
  
    const createdDocs = await TreeNodeModel.insertMany(nodesToInsert);
    console.log("DB DEBUG: Mongo insert success, created", createdDocs.length, "docs");
    
    await TreeModel.findByIdAndUpdate(treeId, { updatedAt: new Date().toISOString() });
  
    const decryptedDocs = await Promise.all(createdDocs.map(async (doc) => {
      const plainDoc = toPlainObject(doc);
      plainDoc.name = await decrypt(plainDoc.name);
      plainDoc.data = await decrypt(plainDoc.data);
      return plainDoc;
    }));
    return decryptedDocs;
  }
  

export async function batchUpdateNodes(updates: { id: string; updates: Partial<TreeNode> }[]): Promise<void> {
    if (updates.length === 0) return;
    await connectToDatabase();

    const firstNodeId = updates[0].id;
    if (!firstNodeId) return;

    const firstNode = await TreeNodeModel.findById(firstNodeId).select('treeId').lean<TreeNode>();
    if (!firstNode) {
        console.warn(`batchUpdateNodes: Could not find node with ID ${firstNodeId} to determine treeId.`);
        return;
    };
    const treeId = firstNode.treeId;

    const bulkOps = await Promise.all(updates.map(async ({ id, updates }) => {
        const { name, data, ...restOfUpdates } = updates;
        const encryptedUpdates: { [key: string]: any } = { ...restOfUpdates, updatedAt: new Date().toISOString() };
        if (name) encryptedUpdates.name = await encrypt(name);
        if (data !== undefined) encryptedUpdates.data = await encrypt(data);
        
        return {
            updateOne: {
                filter: { _id: id },
                update: { $set: encryptedUpdates },
            },
        };
    }));
    await TreeNodeModel.bulkWrite(bulkOps);
    await TreeModel.findByIdAndUpdate(treeId, { updatedAt: new Date().toISOString() });
    console.log(`INFO: Batch updated ${updates.length} nodes in DB.`);
}

export async function addParentToNode(nodeId: string, newParentId: string | null, newOrder: number): Promise<void> {
    await connectToDatabase();
    const node = await TreeNodeModel.findById(nodeId).exec();
    if (!node) {
        throw new Error("Node to clone not found");
    }

    const parentIdToAdd = newParentId || 'root';

    if (!node.parentIds.includes(parentIdToAdd)) {
        node.parentIds.push(parentIdToAdd);
        node.order.push(newOrder);
        await node.save();
        await TreeModel.findByIdAndUpdate(node.treeId, { updatedAt: new Date().toISOString() });
        console.log(`INFO: Cloned node ${nodeId} under new parent ${parentIdToAdd}`);
    } else {
        const parentIndex = node.parentIds.indexOf(parentIdToAdd);
        if (parentIndex !== -1) {
            node.order[parentIndex] = newOrder;
            await node.save();
            await TreeModel.findByIdAndUpdate(node.treeId, { updatedAt: new Date().toISOString() });
            console.log(`INFO: Updated order for existing clone ${nodeId} under parent ${parentIdToAdd}`);
        }
    }
}


// --- Attachment Function (Filesystem-based) ---

export async function saveAttachment(userId: string, relativePath: string, dataUri: string, originalFileName: string): Promise<AttachmentInfo> {
    const DATA_DIR = path.join(process.cwd(), process.env.DATA_DIR || 'data');
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
    await connectToDatabase();
    const EXAMPLES_DIR = path.join(process.cwd(), 'public', 'examples');
    const filePath = path.join(EXAMPLES_DIR, fileName);
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
    const DATA_DIR = path.join(process.cwd(), process.env.DATA_DIR || 'data');
    
    // serverPath is like /attachments/userId/fileName.ext
    // We need to resolve it to the filesystem path which is data/users/userId/attachments/fileName.ext
    
    // Remove the leading '/attachments/' part and the userId, which should match the passed userId for security
    const pathParts = serverPath.split('/').filter(Boolean); // e.g., ['attachments', 'userId', 'fileName.ext']
    if (pathParts.length < 3 || pathParts[0] !== 'attachments' || pathParts[1] !== userId) {
        throw new Error("Invalid or forbidden file path for fetcher.");
    }
    
    const cleanRelativePath = path.join(...pathParts.slice(2)); // e.g., 'fileName.ext'
    const fullPath = path.join(DATA_DIR, 'users', userId, 'attachments', cleanRelativePath);

    // Final security check to prevent any directory traversal shenanigans
    if (!fullPath.startsWith(path.join(DATA_DIR, 'users', userId, 'attachments'))) {
        throw new Error("Access denied: path is outside of the user's attachments directory.");
    }

    try {
        return await fs.readFile(fullPath);
    } catch (error) {
        console.error(`Failed to fetch file for archive: ${fullPath}`, error);
        throw new Error(`Could not read file: ${serverPath}`);
    }
}

// --- Git Provider Functions ---

export async function createRepo(
  token: string,
  repoName: string,
  isPrivate: boolean
): Promise<{ success: boolean; repo?: GitProvider; error?: string }> {
    const fetch = (await import('node-fetch')).default;
    try {
        const octokit = new Octokit({ auth: token, request: { fetch } });
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
  while(current) {
    pathParts.unshift(sanitizeName(current.name));
    // For clones, we just pick the first parent for path generation.
    // The true structure is preserved in the parentIds array.
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
  const fetch = (await import('node-fetch')).default;
  const treeFile = treeFileToCommit || await loadTreeFile(treeId);

  if (!treeFile || !treeFile.gitSync) {
    return { success: false, error: "Tree is not linked to a repository." };
  }

  const octokit = new Octokit({ auth: token, request: { fetch } });
  const { repoOwner, repoName, branch } = treeFile.gitSync;

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

  // This part generates the markdown file hierarchy
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
}


export async function getRepoCommits(token: string, owner: string, repo: string, branch: string): Promise<GitCommit[]> {
    const fetch = (await import('node-fetch')).default;
    const octokit = new Octokit({ auth: token, request: { fetch } });
    const { data: commits } = await octokit.rest.repos.listCommits({
        owner,
        repo,
        sha: branch,
        per_page: 30,
    });
    return commits.map(c => ({
        sha: c.sha,
        message: c.commit.message,
        author: c.commit.author?.name || 'Unknown',
        date: c.commit.author?.date || new Date().toISOString(),
    }));
}

export async function getLatestCommitSha(token: string, owner: string, repo: string, branch: string): Promise<string> {
    const fetch = (await import('node-fetch')).default;
    const octokit = new Octokit({ auth: token, request: { fetch } });
    const { data: branchData } = await octokit.rest.repos.getBranch({ owner, repo, branch });
    return branchData.commit.sha;
}

export async function getTreeFromGit(token: string, owner: string, repo: string, sha: string): Promise<Partial<TreeFile>> {
    const fetch = (await import('node-fetch')).default;
    const octokit = new Octokit({ auth: token, request: { fetch } });

    try {
        const { data: content } = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: 'tree.json',
            ref: sha,
        });

        if ('content' in content && typeof content.content === 'string') {
            const fileContent = Buffer.from(content.content, 'base64').toString('utf-8');
            return JSON.parse(fileContent);
        } else {
            throw new Error("'tree.json' is not a file in the repository.");
        }
    } catch (error) {
        if ((error as any).status === 404) {
            console.warn(`WARN: 'tree.json' not found in commit ${sha}. Returning empty tree.`);
            return {
                title: "Synced Tree",
                tree: [],
                templates: [],
                expandedNodeIds: [],
            };
        }
        throw error;
    }
}
