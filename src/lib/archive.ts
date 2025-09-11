

/**
 * @fileoverview
 * This utility file provides functions for creating and reading ZIP archives
 * for the import/export functionality. It uses the `jszip` library to handle
 * ZIP file operations on the client-side.
 */
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { TreeFile, TreeNode, ArchiveData, AttachmentInfo, Template } from './types';
import path from 'path';
import { generateJsonForExport } from './utils';

/**
 * Builds a hierarchical path string for a given node instance.
 * @param node The node for which to generate the path.
 * @param allNodesMap A map of all nodes in the tree for efficient parent lookup.
 * @returns The hierarchical path string (e.g., "Root/Child/Grandchild").
 */
function getNodePathString(
  node: TreeNode,
  allNodesMap: Map<string, TreeNode>
): string {
  const pathParts: string[] = [node.name.replace(/[\\?%*:|"<>]/g, '_')];
  let currentParentId = node.parentIds?.[0]; // Use first parent for path calculation

  while (currentParentId) {
    const parentNode = allNodesMap.get(currentParentId);
    if (parentNode) {
      pathParts.unshift(parentNode.name.replace(/[\\?%*:|"<>]/g, '_'));
      currentParentId = parentNode.parentIds?.[0];
    } else {
      break;
    }
  }

  return pathParts.join(path.sep);
}


/**
 * Recursively finds all file paths (pictures and attachments) in a tree or sub-tree.
 * @param nodes The array of TreeNodes to search through.
 * @param allNodesMap A map of all nodes in the tree for efficient parent lookup.
 * @param templates The array of templates to reference for field types.
 * @returns An array of objects, each with the source path and the desired archive path.
 */
function findFilePathsInTree(
    nodes: TreeNode[], 
    allNodesMap: Map<string, TreeNode>,
    templates: Template[]
): { sourcePath: string; archivePath: string }[] {
    let paths: { sourcePath: string; archivePath: string }[] = [];

    const traverse = (nodesToTraverse: TreeNode[]) => {
        for (const node of nodesToTraverse) {
            const template = templates.find(t => t.id === node.templateId);
            if (template) {
                const nodePath = getNodePathString(node, allNodesMap);

                for (const field of template.fields) {
                    const value = (node.data || {})[field.id];
                    if (!value) continue;

                    if (field.type === 'picture' || field.type === 'attachment') {
                        const files = (Array.isArray(value) ? value : [value]) as (string | AttachmentInfo)[];

                        files.forEach(fileOrPath => {
                            const serverPath = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
                            if (typeof serverPath === 'string' && serverPath.startsWith('/attachments/')) {
                                // IMPORTANT FIX: Use the unique filename from the server path, not the original name.
                                const uniqueFileName = path.basename(serverPath);
                                const archivePath = path.join(nodePath, uniqueFileName);
                                paths.push({ sourcePath: serverPath, archivePath });
                            }
                        });
                    }
                }
            }
            if (node.children && node.children.length > 0) {
                traverse(node.children);
            }
        }
    };
    
    traverse(nodes);
    return paths;
}

/**
 * Creates a ZIP archive containing the tree data for a specific set of nodes and their referenced files.
 * @param nodesToExport The specific nodes to include in the archive.
 * @param allTreeNodes All nodes of the tree, for path reconstruction.
 * @param templates All templates of the tree.
 * @param archiveName The base name for the downloaded ZIP file.
 * @param fetcher A function that can fetch a file's buffer based on its relative path.
 */
export async function createNodesArchive(
    nodesToExport: TreeNode[],
    allTreeNodes: TreeNode[],
    templates: Template[],
    archiveName: string,
    fetcher: (relativePath: string) => Promise<Buffer>
): Promise<void> {
    const zip = new JSZip();
    
    const treeJsonData = generateJsonForExport(archiveName, nodesToExport, templates);
    zip.file('tree.json', JSON.stringify(treeJsonData, null, 2));
    
    const nodeMap = new Map<string, TreeNode>();
    const buildNodeMap = (nodes: TreeNode[]) => {
        for(const node of nodes) {
            nodeMap.set(node.id, node);
            if (node.children) buildNodeMap(node.children);
        }
    };
    buildNodeMap(allTreeNodes);
    
    const fileEntries = findFilePathsInTree(nodesToExport, nodeMap, templates);

    for (const { sourcePath, archivePath } of fileEntries) {
        try {
            const fileBuffer = await fetcher(sourcePath);
            zip.file(archivePath, fileBuffer);
        } catch (error) {
            console.error(`Could not fetch file ${sourcePath} for archive, skipping.`, error);
        }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const filename = `${archiveName.replace(/\s/g, '_')}.zip`;
    saveAs(zipBlob, filename);
}


/**
 * Reads a ZIP archive and extracts the tree data and all its files.
 * @param file The ZIP file from a file input.
 * @returns An ArchiveData object containing the treeFile and a map of file blobs.
 */
export async function readArchive(file: File): Promise<ArchiveData> {
    const zip = await JSZip.loadAsync(file);

    // 1. Extract tree.json
    const treeJsonFile = zip.file('tree.json');
    if (!treeJsonFile) {
        throw new Error(`Archive is missing 'tree.json'.`);
    }
    const treeJsonContent = await treeJsonFile.async('string');
    const treeFile = JSON.parse(treeJsonContent) as TreeFile;

    // 2. Extract all other files, preserving their original paths.
    const files: Record<string, Blob> = {};
    const filePromises: Promise<void>[] = [];

    zip.forEach((relativePath, zipEntry) => {
        if (relativePath !== 'tree.json' && !zipEntry.dir) {
            const promise = zipEntry.async('blob').then(blob => {
                // Keep the original relative path from the archive
                files[relativePath] = blob;
            });
            filePromises.push(promise);
        }
    });

    await Promise.all(filePromises);

    return { treeFile, files };
}
