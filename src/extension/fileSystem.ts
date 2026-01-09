import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const MIN_FILE_SIZE = 5 * 1024; // 5KB minimum
export const MAX_FILE_SIZE_FOR_FULL_READ = 50 * 1024 * 1024; // 50MB limit for full file reads
export const SUMMARY_CHUNK_SIZE = 50 * 1024; // 50KB for summary extraction

export interface ConversationFile {
  name: string;
  path: string;
  folder: string;
  size: number;
  summary: string | null; // null means summary not yet loaded
  lastModified: Date;
}

export interface FolderNode {
  name: string;
  path: string;
  files: ConversationFile[];
}

/**
 * Get the home directory
 */
export function getHomeDirectory(): string {
  return os.homedir();
}

/**
 * Get the Claude projects directory path
 */
export function getClaudeProjectsPath(): string {
  return path.join(getHomeDirectory(), '.claude', 'projects');
}

/**
 * Check if the Claude projects directory exists
 */
export function claudeProjectsExist(): boolean {
  const projectsPath = getClaudeProjectsPath();
  return fs.existsSync(projectsPath);
}

/**
 * Extract a summary from the first user message in a JSONL file
 */
export function extractSummary(content: string): string {
  const lines = content.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line);

      if (entry.type !== 'user' || !entry.message?.content) continue;

      let text = '';
      const msgContent = entry.message.content;

      if (typeof msgContent === 'string') {
        text = msgContent;
      } else if (Array.isArray(msgContent)) {
        const textBlock = msgContent.find(
          (b: { type: string; text?: string }) => b.type === 'text' && b.text
        );
        if (textBlock?.text) {
          text = textBlock.text;
        }
      }

      if (!text) continue;
      if (text.startsWith('<command')) continue;
      if (text.startsWith('<ide_opened_file>')) continue;
      if (text.startsWith('<local-')) continue;
      if (text.startsWith('[Tool Result]')) continue;
      if (text.startsWith('Caveat:')) continue;
      if (text.includes('tool_use_id')) continue;

      const cleaned = text
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (cleaned.length > 0) {
        return cleaned.slice(0, 100);
      }
    } catch {
      continue;
    }
  }

  return '';
}

/**
 * Read the content of a JSONL file
 * Returns null if file is too large
 */
export function readJsonlFile(filePath: string): string | null {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size > MAX_FILE_SIZE_FOR_FULL_READ) {
      console.warn(`File too large to read: ${filePath} (${formatFileSize(stats.size)})`);
      return null;
    }
    return fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    console.error(`Error reading file: ${filePath}`, error);
    return null;
  }
}

/**
 * Read the content of a JSONL file asynchronously
 * Returns null if file is too large
 */
export async function readJsonlFileAsync(filePath: string): Promise<string | null> {
  try {
    const stats = await fs.promises.stat(filePath);
    if (stats.size > MAX_FILE_SIZE_FOR_FULL_READ) {
      console.warn(`File too large to read: ${filePath} (${formatFileSize(stats.size)})`);
      return null;
    }
    return await fs.promises.readFile(filePath, 'utf-8');
  } catch (error) {
    console.error(`Error reading file: ${filePath}`, error);
    return null;
  }
}

/**
 * Read just the first chunk of a file for summary extraction (sync)
 */
export function readFileChunk(filePath: string, maxBytes: number = SUMMARY_CHUNK_SIZE): string {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(maxBytes);
  const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
  fs.closeSync(fd);
  return buffer.slice(0, bytesRead).toString('utf-8');
}

/**
 * Read just the first chunk of a file for summary extraction (async)
 */
export async function readFileChunkAsync(filePath: string, maxBytes: number = SUMMARY_CHUNK_SIZE): Promise<string> {
  const fd = await fs.promises.open(filePath, 'r');
  const buffer = Buffer.alloc(maxBytes);
  const { bytesRead } = await fd.read(buffer, 0, maxBytes, 0);
  await fd.close();
  return buffer.slice(0, bytesRead).toString('utf-8');
}

/**
 * Load summary for a single file (async, for lazy loading)
 */
export async function loadFileSummary(file: ConversationFile): Promise<string> {
  if (file.summary !== null) {
    return file.summary;
  }
  try {
    const chunk = await readFileChunkAsync(file.path);
    const summary = extractSummary(chunk);
    file.summary = summary;
    return summary;
  } catch (error) {
    console.error(`Error loading summary for ${file.path}:`, error);
    file.summary = '';
    return '';
  }
}

/**
 * Scan the Claude projects directory for JSONL files
 * Returns a map of folder names to their conversation files
 * Note: summaries are NOT loaded here - they are lazy loaded when folders are expanded
 */
export function scanForConversations(): Map<string, FolderNode> {
  const projectsPath = getClaudeProjectsPath();
  const folders = new Map<string, FolderNode>();

  if (!fs.existsSync(projectsPath)) {
    return folders;
  }

  const entries = fs.readdirSync(projectsPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const folderPath = path.join(projectsPath, entry.name);
    const folderNode: FolderNode = {
      name: entry.name,
      path: folderPath,
      files: []
    };

    try {
      const files = fs.readdirSync(folderPath, { withFileTypes: true });

      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;

        const filePath = path.join(folderPath, file.name);
        const stats = fs.statSync(filePath);

        if (stats.size < MIN_FILE_SIZE) continue;

        // Don't load summary here - lazy load when folder is expanded
        folderNode.files.push({
          name: file.name,
          path: filePath,
          folder: entry.name,
          size: stats.size,
          summary: null, // Will be lazy loaded
          lastModified: stats.mtime
        });
      }

      // Sort files by last modified (newest first)
      folderNode.files.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

      if (folderNode.files.length > 0) {
        folders.set(entry.name, folderNode);
      }
    } catch (err) {
      // Skip folders we can't read
      console.error(`Error reading folder ${folderPath}:`, err);
    }
  }

  return folders;
}

/**
 * Scan for conversations asynchronously (better for large directories)
 */
export async function scanForConversationsAsync(): Promise<Map<string, FolderNode>> {
  const projectsPath = getClaudeProjectsPath();
  const folders = new Map<string, FolderNode>();

  try {
    await fs.promises.access(projectsPath);
  } catch {
    return folders;
  }

  const entries = await fs.promises.readdir(projectsPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const folderPath = path.join(projectsPath, entry.name);
    const folderNode: FolderNode = {
      name: entry.name,
      path: folderPath,
      files: []
    };

    try {
      const files = await fs.promises.readdir(folderPath, { withFileTypes: true });

      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;

        const filePath = path.join(folderPath, file.name);
        const stats = await fs.promises.stat(filePath);

        if (stats.size < MIN_FILE_SIZE) continue;

        // Don't load summary here - lazy load when folder is expanded
        folderNode.files.push({
          name: file.name,
          path: filePath,
          folder: entry.name,
          size: stats.size,
          summary: null, // Will be lazy loaded
          lastModified: stats.mtime
        });
      }

      // Sort files by last modified (newest first)
      folderNode.files.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

      if (folderNode.files.length > 0) {
        folders.set(entry.name, folderNode);
      }
    } catch (err) {
      // Skip folders we can't read
      console.error(`Error reading folder ${folderPath}:`, err);
    }
  }

  return folders;
}

/**
 * Load summaries for all files in a folder (async, for lazy loading)
 */
export async function loadFolderSummaries(folderNode: FolderNode): Promise<void> {
  const promises = folderNode.files.map(file => loadFileSummary(file));
  await Promise.all(promises);
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format date for display
 */
export function formatDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return 'Today';
  } else if (days === 1) {
    return 'Yesterday';
  } else if (days < 7) {
    return `${days} days ago`;
  } else {
    return date.toLocaleDateString();
  }
}

/**
 * Encode a workspace path to match Claude's folder naming convention
 * Claude replaces / with - in the path
 */
export function encodeWorkspacePath(workspacePath: string): string {
  return workspacePath.replace(/\//g, '-');
}

/**
 * Get the Claude project folder path for a given workspace path
 */
export function getClaudeFolderForWorkspace(workspacePath: string): string | null {
  const encodedPath = encodeWorkspacePath(workspacePath);
  const claudeFolder = path.join(getClaudeProjectsPath(), encodedPath);

  if (fs.existsSync(claudeFolder)) {
    return claudeFolder;
  }
  return null;
}

/**
 * Scan only the current project's conversations
 * Note: summaries are NOT loaded here - they are lazy loaded when needed
 */
export function scanCurrentProjectConversations(workspacePath: string): FolderNode | null {
  const claudeFolder = getClaudeFolderForWorkspace(workspacePath);
  if (!claudeFolder) return null;

  const encodedPath = encodeWorkspacePath(workspacePath);

  const folderNode: FolderNode = {
    name: encodedPath,
    path: claudeFolder,
    files: []
  };

  try {
    const files = fs.readdirSync(claudeFolder, { withFileTypes: true });

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;

      const filePath = path.join(claudeFolder, file.name);
      const stats = fs.statSync(filePath);

      if (stats.size < MIN_FILE_SIZE) continue;

      // Don't load summary here - lazy load when needed
      folderNode.files.push({
        name: file.name,
        path: filePath,
        folder: encodedPath,
        size: stats.size,
        summary: null, // Will be lazy loaded
        lastModified: stats.mtime
      });
    }

    // Sort files by last modified (newest first)
    folderNode.files.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

    return folderNode.files.length > 0 ? folderNode : null;
  } catch (err) {
    console.error(`Error reading folder ${claudeFolder}:`, err);
    return null;
  }
}
