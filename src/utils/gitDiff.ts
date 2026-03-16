/**
 * Git diff utility for browser-side git status detection.
 * Parses the .git/index binary file directly and compares against
 * the working tree via the File System Access API.
 * 
 * This runs entirely in the browser — no backend needed for diff detection.
 * No isomorphic-git dependency — direct index parsing is 100x faster.
 */

import ignore from 'ignore';

// ── Types ──

export interface GitChangedFile {
  filePath: string;
  status: 'modified' | 'added' | 'deleted';
  content: string | null; // current file content (null for deleted files)
  originalContent?: string | null; // committed version (null if not available — e.g. packed git object)
}

// ── File System Access API → isomorphic-git fs adapter ──

/**
 * Creates a minimal `fs` object that isomorphic-git can use,
 * backed by a FileSystemDirectoryHandle (the browser's File System Access API).
 * 
 * isomorphic-git needs: readFile, readdir, stat, lstat
 */
function createFsFromDirHandle(dirHandle: FileSystemDirectoryHandle) {
  // Clean path from isomorphic-git format to browser FS format.
  // isomorphic-git sends paths like:
  //   '.'              → '' (root)
  //   './'             → '' (root)
  //   './src/app.ts'   → 'src/app.ts'
  //   '.dockerignore'  → '.dockerignore' (dotfile, NOT a path prefix)
  //   'makeit-be/.'    → 'makeit-be' (dir + root entry from GitWalkerFs)
  //   'makeit-be/./src' → 'makeit-be/src'
  function cleanGitPath(filepath: string): string {
    // Split, remove '.' segments (they mean "current dir"), rejoin
    const parts = filepath.split('/').filter(p => p !== '' && p !== '.');
    return parts.join('/');
  }

  async function getHandleAtPath(path: string): Promise<FileSystemHandle> {
    const parts = path.split('/').filter(Boolean);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let current: any = dirHandle;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;

      try {
        // Try as directory first
        current = await current.getDirectoryHandle(name);
      } catch {
        if (isLast) {
          // Try as file
          current = await current.getFileHandle(name);
        } else {
          throw new Error(`Path not found: ${path}`);
        }
      }
    }

    return current;
  }

  // isomorphic-git's normalizeStats requires a full Node.js-like stat object:
  // ctimeMs, mtimeMs, dev, ino, mode, uid, gid, size, isFile(), isDirectory(), isSymbolicLink()
  // Missing any of these causes SecondsNanoseconds to call undefined.valueOf() → crash.
  const statFile = async (filepath: string) => {
    const cleanPath = cleanGitPath(filepath);
    
    try {
      let handle: FileSystemHandle;
      if (!cleanPath) {
        handle = dirHandle;
      } else {
        handle = await getHandleAtPath(cleanPath);
      }

      if (handle.kind === 'file') {
        const file = await (handle as FileSystemFileHandle).getFile();
        const mtime = file.lastModified;
        return {
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
          size: file.size,
          mtimeMs: mtime,
          ctimeMs: mtime,
          dev: 0,
          ino: 0,
          mode: 0o100644,  // regular file
          uid: 0,
          gid: 0,
        };
      }
      const now = Date.now();
      return {
        isFile: () => false,
        isDirectory: () => true,
        isSymbolicLink: () => false,
        size: 0,
        mtimeMs: now,
        ctimeMs: now,
        dev: 0,
        ino: 0,
        mode: 0o040000,  // directory
        uid: 0,
        gid: 0,
      };
    } catch {
      const error = new Error(`ENOENT: ${filepath}`) as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    }
  };

  const readFile = async (filepath: string, opts?: { encoding?: string }): Promise<Uint8Array | string> => {
    const cleanPath = cleanGitPath(filepath);
    
    try {
      const handle = await getHandleAtPath(cleanPath);
      if (handle.kind !== 'file') throw new Error('Not a file');
      const file = await (handle as FileSystemFileHandle).getFile();
      
      if (opts?.encoding === 'utf8') {
        return await file.text();
      }
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    } catch {
      const error = new Error(`ENOENT: no such file or directory, open '${filepath}'`) as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    }
  };

  const readdir = async (filepath: string): Promise<string[]> => {
    const cleanPath = cleanGitPath(filepath);
    
    try {
      let handle: FileSystemDirectoryHandle;
      if (!cleanPath) {
        handle = dirHandle;
      } else {
        handle = await getHandleAtPath(cleanPath) as FileSystemDirectoryHandle;
      }

      const entries: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const iter = (handle as any).values() as AsyncIterable<FileSystemHandle>;
      for await (const entry of iter) {
        entries.push(entry.name);
      }
      return entries;
    } catch {
      const error = new Error(`ENOENT: no such file or directory, scandir '${filepath}'`) as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    }
  };

  const readlink = async (filepath: string): Promise<string> => {
    const error = new Error(`ENOENT: no such file or directory, readlink '${filepath}'`) as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  };

  const symlink = async (): Promise<void> => { /* no-op: read-only browser FS */ };
  const writeFile = async (): Promise<void> => { /* no-op: isomorphic-git tries to update .git/index */ };
  const unlink = async (): Promise<void> => { /* no-op */ };
  const mkdir = async (): Promise<void> => { /* no-op */ };
  const rmdir = async (): Promise<void> => { /* no-op */ };

  // All methods as a single object — isomorphic-git looks for methods on BOTH
  // `fs` and `fs.promises`. Its internal `GitWalkerFs` may use a different path
  // than `bindFs`. Exposing on both levels ensures full coverage.
  const methods = {
    readFile, readdir, stat: statFile, lstat: statFile,
    readlink, symlink, writeFile, unlink, mkdir, rmdir,
  };

  return { promises: methods, ...methods };
}

// ── Public API ──

/**
 * Detects whether the given directory is a git repository.
 */
export async function isGitRepo(dirHandle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    await dirHandle.getDirectoryHandle('.git');
    return true;
  } catch {
    const subrepos = await findSubrepoNames(dirHandle);
    return subrepos.length > 0;
  }
}

/**
 * Finds child directory NAMES that contain a .git folder (subrepos/submodules).
 */
async function findSubrepoNames(dirHandle: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const iter = (dirHandle as any).values() as AsyncIterable<FileSystemHandle>;
    for await (const entry of iter) {
      if (entry.kind !== 'directory' || entry.name.startsWith('.')) continue;
      try {
        const childDir = await dirHandle.getDirectoryHandle(entry.name);
        await childDir.getDirectoryHandle('.git');
        names.push(entry.name);
      } catch { /* no .git */ }
    }
  } catch { /* skip */ }
  return names;
}

// Only skip node_modules during directory walk (performance — can have 100K+ files)
// All other filtering uses .gitignore via the `ignore` package
const WALK_SKIP_DIRS = new Set(['node_modules', '.git']);

// ── Git Index Parser ──

interface GitIndexEntry {
  filepath: string;
  sha: string;
  mtimeSeconds: number;
  size: number;
  mode: number;
}

/**
 * Parses the .git/index binary file to extract tracked file entries.
 * Format: 12-byte header (DIRC + version + count) + entries.
 * Each entry: ctime(8) + mtime(8) + dev(4) + ino(4) + mode(4) + uid(4) + gid(4) + size(4) + sha(20) + flags(2) + filepath + padding
 */
function parseGitIndex(buffer: Uint8Array): GitIndexEntry[] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // Header: 4 bytes "DIRC", 4 bytes version, 4 bytes entry count
  const sig = String.fromCharCode(buffer[0], buffer[1], buffer[2], buffer[3]);
  if (sig !== 'DIRC') throw new Error('Not a git index file');

  const version = view.getUint32(4);
  const entryCount = view.getUint32(8);
  console.log(`[GitDiff] Index: version=${version}, entries=${entryCount}`);

  const entries: GitIndexEntry[] = [];
  let offset = 12; // after header

  for (let i = 0; i < entryCount; i++) {
    if (offset + 62 > buffer.length) break; // safety

    // Skip ctime (8 bytes)
    offset += 8;
    // mtime: seconds (4) + nanoseconds (4)
    const mtimeSeconds = view.getUint32(offset);
    offset += 8; // skip mtime seconds + nanoseconds
    // Skip dev(4) + ino(4)
    offset += 8;
    // mode (4 bytes)
    const mode = view.getUint32(offset);
    offset += 4;
    // Skip uid(4) + gid(4)
    offset += 8;
    // size (4 bytes)
    const size = view.getUint32(offset);
    offset += 4;
    // SHA-1 (20 bytes) — store as hex string
    const shaBytes = buffer.slice(offset, offset + 20);
    const sha = Array.from(shaBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    offset += 20;
    // Flags (2 bytes) — low 12 bits = name length (if < 0xFFF)
    const flags = view.getUint16(offset);
    offset += 2;

    // Extended flags for version 3+
    if (version >= 3 && (flags & 0x4000) !== 0) {
      offset += 2;
    }

    // Read filepath — null-terminated string
    let nameEnd = offset;
    while (nameEnd < buffer.length && buffer[nameEnd] !== 0) {
      nameEnd++;
    }
    const filepath = new TextDecoder().decode(buffer.slice(offset, nameEnd));
    offset = nameEnd + 1; // skip null terminator

    // Entries are padded to 8-byte boundaries (from header start, which is entry start)
    // Entry length = 62 bytes fixed + filepath_length + 1 (null) + padding
    // In v4 there's no padding, in v2/v3 padding to multiple of 8
    if (version < 4) {
      const entryLen = ((62 + filepath.length + 8) & ~7);
      const consumed = 62 + (offset - (offset - filepath.length - 1));
      // Simpler: align offset to next 8-byte boundary relative to entry start
      // Actually, the easiest: offset after null byte, then skip to next 8-byte boundary
      // from the start of the entry
      const entryStart = offset - filepath.length - 1 - 62;
      const paddedEnd = entryStart + entryLen;
      if (paddedEnd > offset) {
        offset = paddedEnd;
      }
    }

    entries.push({ filepath, sha, mtimeSeconds, size, mode });
  }

  return entries;
}

// ── HEAD Tree Reader ──

/**
 * Decompresses a zlib-compressed buffer using the browser's DecompressionStream.
 * Handles trailing data gracefully (expected when reading objects from pack files,
 * where the zlib stream is followed by the next object's binary data).
 */
async function zlibDecompress(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  // Write data and close. The close() may throw "Junk found after end of
  // compressed data" when pack data has trailing bytes — this is expected.
  const writePromise = writer.write(
    new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) as unknown as BufferSource
  );
  const closePromise = writer.close();

  // Suppress both write and close errors — they fire when trailing bytes exist
  writePromise.catch(() => {});
  closePromise.catch(() => {});

  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }
  } catch {
    // Stream may error after yielding all valid decompressed data — safe to ignore.
    // Cancel the reader to prevent further internal rejections from leaking.
    reader.cancel().catch(() => {});
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// ── Git Pack File Reader ──
// Reads objects from .git/objects/pack/*.{idx,pack}
// Supports pack v2 index format and OFS_DELTA/REF_DELTA reconstruction.

const OBJ_COMMIT = 1;
const OBJ_TREE = 2;
const OBJ_BLOB = 3;
const OBJ_TAG = 4;
const OBJ_OFS_DELTA = 6;
const OBJ_REF_DELTA = 7;

/**
 * Searches all pack files in the repo for the given SHA.
 * Returns the decompressed object data (header + body) or null.
 */
async function readPackedObject(
  repoHandle: FileSystemDirectoryHandle,
  sha: string,
): Promise<Uint8Array | null> {
  try {
    const gitDir = await repoHandle.getDirectoryHandle('.git');
    const objDir = await gitDir.getDirectoryHandle('objects');
    const packDir = await objDir.getDirectoryHandle('pack');

    // Find all .idx files
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entries = (packDir as any).values() as AsyncIterable<FileSystemHandle>;
    for await (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.idx')) continue;

      const idxHandle = entry as FileSystemFileHandle;
      const idxFile = await idxHandle.getFile();
      const idxData = new Uint8Array(await idxFile.arrayBuffer());

      const offset = findShaInIdx(idxData, sha);
      if (offset === null) continue;

      // Found! Read from the corresponding .pack file
      const packName = entry.name.replace('.idx', '.pack');
      const packHandle = await packDir.getFileHandle(packName) as FileSystemFileHandle;
      const packFile = await packHandle.getFile();
      const packData = new Uint8Array(await packFile.arrayBuffer());

      return await readObjectFromPack(packData, offset, repoHandle);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parses a v2 .idx file and finds the offset for a given SHA.
 * Returns the offset in the .pack file, or null if not found.
 * 
 * idx v2 format:
 *   [0..3]   magic: \377tOc
 *   [4..7]   version: 2
 *   [8..1031] fanout table: 256 × 4-byte big-endian counts
 *   [1032..]  SHA list (N × 20 bytes, sorted)
 *   [...]     CRC32 list (N × 4 bytes)
 *   [...]     offset list (N × 4 bytes)
 *   [...]     optional 8-byte offset list for large packs
 */
function findShaInIdx(idx: Uint8Array, sha: string): number | null {
  const view = new DataView(idx.buffer, idx.byteOffset, idx.byteLength);

  // Check magic + version
  const magic = view.getUint32(0);
  const isV2 = magic === 0xff744f63; // \377tOc
  if (!isV2) return null; // Only support v2

  const version = view.getUint32(4);
  if (version !== 2) return null;

  // Parse the SHA into bytes for comparison
  const shaBytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    shaBytes[i] = parseInt(sha.slice(i * 2, i * 2 + 2), 16);
  }

  // Fanout table: 256 entries starting at offset 8
  const fanoutBase = 8;
  const firstByte = shaBytes[0];

  const lo = firstByte === 0 ? 0 : view.getUint32(fanoutBase + (firstByte - 1) * 4);
  const hi = view.getUint32(fanoutBase + firstByte * 4);
  const totalObjects = view.getUint32(fanoutBase + 255 * 4);

  // SHA list starts after fanout table
  const shaListBase = fanoutBase + 256 * 4; // 1032

  // Binary search in SHA list [lo, hi)
  let left = lo;
  let right = hi;
  while (left < right) {
    const mid = (left + right) >>> 1;
    const cmp = compareSha(idx, shaListBase + mid * 20, shaBytes);
    if (cmp === 0) {
      // Found! Get offset from offset table
      const crcListBase = shaListBase + totalObjects * 20;
      const offsetListBase = crcListBase + totalObjects * 4;
      const offset = view.getUint32(offsetListBase + mid * 4);

      // Check MSB for large offset
      if (offset & 0x80000000) {
        // Large offset — read from 8-byte table
        const largeOffsetBase = offsetListBase + totalObjects * 4;
        const largeIdx = offset & 0x7fffffff;
        // Read as two 32-bit values (JavaScript doesn't handle 64-bit well)
        const highBits = view.getUint32(largeOffsetBase + largeIdx * 8);
        const lowBits = view.getUint32(largeOffsetBase + largeIdx * 8 + 4);
        return highBits * 0x100000000 + lowBits;
      }
      return offset;
    }
    if (cmp < 0) left = mid + 1;
    else right = mid;
  }

  return null; // SHA not in this pack
}

/** Compare SHA at offset in buffer with target SHA bytes. */
function compareSha(buf: Uint8Array, offset: number, target: Uint8Array): number {
  for (let i = 0; i < 20; i++) {
    const a = buf[offset + i];
    const b = target[i];
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

/**
 * Reads and decompresses an object from a .pack file at the given offset.
 * Handles regular objects and delta objects (OFS_DELTA, REF_DELTA).
 * Returns the full decompressed data with git object header.
 */
async function readObjectFromPack(
  pack: Uint8Array,
  offset: number,
  repoHandle: FileSystemDirectoryHandle,
): Promise<Uint8Array | null> {
  let pos = offset;

  // Read variable-length header
  let byte = pack[pos++];
  const type = (byte >> 4) & 0x07;
  let size = byte & 0x0f;
  let shift = 4;
  while (byte & 0x80) {
    byte = pack[pos++];
    size |= (byte & 0x7f) << shift;
    shift += 7;
  }

  if (type === OBJ_OFS_DELTA) {
    // OFS_DELTA: base object is at a negative offset
    let baseOffset = pack[pos] & 0x7f;
    while (pack[pos] & 0x80) {
      pos++;
      baseOffset = ((baseOffset + 1) << 7) | (pack[pos] & 0x7f);
    }
    pos++;

    const deltaData = await zlibDecompress(pack.subarray(pos));
    const baseResult = await readObjectFromPack(pack, offset - baseOffset, repoHandle);
    if (!baseResult) return null;

    const { type: baseType, body: baseBody } = parseGitObject(baseResult);
    const patchedBody = applyDelta(baseBody, deltaData);
    if (!patchedBody) return null;

    // Re-wrap with header
    const header = new TextEncoder().encode(`${baseType} ${patchedBody.length}\0`);
    const result = new Uint8Array(header.length + patchedBody.length);
    result.set(header);
    result.set(patchedBody, header.length);
    return result;
  }

  if (type === OBJ_REF_DELTA) {
    // REF_DELTA: base object is identified by SHA
    const baseSha = Array.from(pack.slice(pos, pos + 20)).map(b => b.toString(16).padStart(2, '0')).join('');
    pos += 20;

    const deltaData = await zlibDecompress(pack.subarray(pos));
    // Read the base object (could be loose or in another pack)
    const baseResult = await readGitObject(repoHandle, baseSha);
    if (!baseResult) return null;

    const { type: baseType, body: baseBody } = parseGitObject(baseResult);
    const patchedBody = applyDelta(baseBody, deltaData);
    if (!patchedBody) return null;

    const header = new TextEncoder().encode(`${baseType} ${patchedBody.length}\0`);
    const result = new Uint8Array(header.length + patchedBody.length);
    result.set(header);
    result.set(patchedBody, header.length);
    return result;
  }

  // Regular object (commit, tree, blob, tag)
  const typeNames: Record<number, string> = {
    [OBJ_COMMIT]: 'commit', [OBJ_TREE]: 'tree',
    [OBJ_BLOB]: 'blob', [OBJ_TAG]: 'tag',
  };
  const typeName = typeNames[type];
  if (!typeName) return null;

  // Decompress — pass remaining pack data; DecompressionStream stops at zlib boundary
  const decompressed = await zlibDecompress(pack.subarray(pos));
  const body = decompressed.slice(0, size);

  // Re-wrap with git object header
  const header = new TextEncoder().encode(`${typeName} ${size}\0`);
  const result = new Uint8Array(header.length + body.length);
  result.set(header);
  result.set(body, header.length);
  return result;
}

/**
 * Apply a git delta to a base object.
 * Delta format: base_size (varint) + result_size (varint) + instructions
 * Instructions are either COPY (from base) or INSERT (literal bytes).
 */
function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array | null {
  let pos = 0;

  // Read base size (varint)
  let baseSize = 0, shift = 0;
  do {
    baseSize |= (delta[pos] & 0x7f) << shift;
    shift += 7;
  } while (delta[pos++] & 0x80);

  if (base.length !== baseSize) return null;

  // Read result size (varint)
  let resultSize = 0;
  shift = 0;
  do {
    resultSize |= (delta[pos] & 0x7f) << shift;
    shift += 7;
  } while (delta[pos++] & 0x80);

  const result = new Uint8Array(resultSize);
  let resultPos = 0;

  while (pos < delta.length) {
    const cmd = delta[pos++];
    if (cmd & 0x80) {
      // COPY from base
      let copyOffset = 0, copySize = 0;
      if (cmd & 0x01) copyOffset = delta[pos++];
      if (cmd & 0x02) copyOffset |= delta[pos++] << 8;
      if (cmd & 0x04) copyOffset |= delta[pos++] << 16;
      if (cmd & 0x08) copyOffset |= delta[pos++] << 24;
      if (cmd & 0x10) copySize = delta[pos++];
      if (cmd & 0x20) copySize |= delta[pos++] << 8;
      if (cmd & 0x40) copySize |= delta[pos++] << 16;
      if (copySize === 0) copySize = 0x10000;

      result.set(base.slice(copyOffset, copyOffset + copySize), resultPos);
      resultPos += copySize;
    } else if (cmd > 0) {
      // INSERT literal bytes
      result.set(delta.slice(pos, pos + cmd), resultPos);
      resultPos += cmd;
      pos += cmd;
    } else {
      return null; // Reserved
    }
  }

  return resultPos === resultSize ? result : null;
}

/**
 * Reads a git object by SHA — tries loose first, then pack files.
 * This is the unified entry point for all object reads.
 */
async function readGitObject(
  repoHandle: FileSystemDirectoryHandle,
  sha: string,
): Promise<Uint8Array | null> {
  // Try loose object first (fast path)
  try {
    const gitDir = await repoHandle.getDirectoryHandle('.git');
    const objDir = await gitDir.getDirectoryHandle('objects');
    const prefix = await objDir.getDirectoryHandle(sha.slice(0, 2));
    const fileHandle = await prefix.getFileHandle(sha.slice(2));
    const file = await (fileHandle as FileSystemFileHandle).getFile();
    const compressed = new Uint8Array(await file.arrayBuffer());
    return await zlibDecompress(compressed);
  } catch {
    // Not a loose object — try pack files
  }

  // Try pack files (slow path)
  return readPackedObject(repoHandle, sha);
}

/**
 * Parses a git object (decompressed) into type and body.
 */
function parseGitObject(data: Uint8Array): { type: string; body: Uint8Array } {
  const nullIdx = data.indexOf(0);
  const header = new TextDecoder().decode(data.slice(0, nullIdx));
  const [type] = header.split(' ');
  return { type, body: data.slice(nullIdx + 1) };
}

/**
 * Parses a git tree object body into entries: { name, mode, sha }.
 */
function parseTreeObject(body: Uint8Array): Array<{ name: string; mode: string; sha: string }> {
  const entries: Array<{ name: string; mode: string; sha: string }> = [];
  let offset = 0;

  while (offset < body.length) {
    // Mode + space
    let spaceIdx = offset;
    while (spaceIdx < body.length && body[spaceIdx] !== 0x20) spaceIdx++;
    const mode = new TextDecoder().decode(body.slice(offset, spaceIdx));
    offset = spaceIdx + 1;

    // Name + null byte
    let nullIdx = offset;
    while (nullIdx < body.length && body[nullIdx] !== 0) nullIdx++;
    const name = new TextDecoder().decode(body.slice(offset, nullIdx));
    offset = nullIdx + 1;

    // SHA-1 (20 bytes raw)
    const shaBytes = body.slice(offset, offset + 20);
    const sha = Array.from(shaBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    offset += 20;

    entries.push({ name, mode, sha });
  }

  return entries;
}

/**
 * Reads the text content of a git blob object.
 * Used to get the committed (original) version of a file for diff comparison.
 * Returns null if the object is in a pack file or is binary.
 */
async function readBlobContent(
  repoHandle: FileSystemDirectoryHandle,
  sha: string,
): Promise<string | null> {
  try {
    const data = await readGitObject(repoHandle, sha);
    if (!data) return null;

    const { type, body } = parseGitObject(data);
    if (type !== 'blob') return null;

    // Skip binary files (check for null bytes in first 8KB)
    const sampleLength = Math.min(body.length, 8192);
    for (let i = 0; i < sampleLength; i++) {
      if (body[i] === 0) return null; // Binary file
    }

    // Skip very large files (>1MB) to avoid memory issues
    if (body.length > 1_000_000) return null;

    return new TextDecoder().decode(body);
  } catch {
    return null;
  }
}

/**
 * Reads the HEAD tree and builds a filepath → SHA map.
 * Reads from both loose objects and pack files.
 */
async function readHeadTree(
  repoHandle: FileSystemDirectoryHandle
): Promise<Map<string, string> | null> {
  try {
    const gitDir = await repoHandle.getDirectoryHandle('.git');

    // 1. Read HEAD → "ref: refs/heads/main\n"
    const headHandle = await gitDir.getFileHandle('HEAD');
    const headContent = await (await (headHandle as FileSystemFileHandle).getFile()).text();
    let commitSha: string;

    if (headContent.startsWith('ref: ')) {
      // Symbolic ref → read the actual ref file
      const refPath = headContent.slice(5).trim();
      const parts = refPath.split('/');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let current: any = gitDir;
      for (const part of parts) {
        try {
          current = await current.getDirectoryHandle(part);
        } catch {
          current = await current.getFileHandle(part);
        }
      }
      commitSha = (await (await (current as FileSystemFileHandle).getFile()).text()).trim();
    } else {
      // Detached HEAD
      commitSha = headContent.trim();
    }

    console.log(`[GitDiff] HEAD commit: ${commitSha}`);

    // 2. Read commit object → get tree SHA
    const commitData = await readGitObject(repoHandle, commitSha);
    if (!commitData) {
      console.log('[GitDiff] Cannot read commit object — skipping HEAD tree comparison');
      return null;
    }
    const commitObj = parseGitObject(commitData);
    const commitText = new TextDecoder().decode(commitObj.body);
    const treeMatch = commitText.match(/^tree ([0-9a-f]{40})/m);
    if (!treeMatch) return null;
    const rootTreeSha = treeMatch[1];
    console.log(`[GitDiff] Root tree: ${rootTreeSha}`);

    // 3. Recursively walk tree objects to build filepath → SHA map
    const fileMap = new Map<string, string>();

    async function walkTree(treeSha: string, prefix: string): Promise<void> {
      const treeData = await readGitObject(repoHandle, treeSha);
      if (!treeData) return; // Can't read object
      const { body } = parseGitObject(treeData);
      const entries = parseTreeObject(body);

      for (const entry of entries) {
        const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.mode === '40000' || entry.mode === '040000') {
          // Directory → recurse
          await walkTree(entry.sha, fullPath);
        } else {
          // File → store SHA
          fileMap.set(fullPath, entry.sha);
        }
      }
    }

    await walkTree(rootTreeSha, '');
    console.log(`[GitDiff] HEAD tree: ${fileMap.size} files resolved`);
    return fileMap;
  } catch (err) {
    console.warn('[GitDiff] Failed to read HEAD tree:', err);
    return null;
  }
}

/**
 * Recursively walks a directory via the File System Access API.
 * Returns all file paths relative to the root, skipping heavy directories.
 */
async function walkWorkingTree(
  dirHandle: FileSystemDirectoryHandle,
  prefix: string,
  onProgress?: (msg: string) => void
): Promise<Map<string, FileSystemFileHandle>> {
  const files = new Map<string, FileSystemFileHandle>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const iter = (dirHandle as any).values() as AsyncIterable<FileSystemHandle>;
  for await (const entry of iter) {
    const name = entry.name;
    if (WALK_SKIP_DIRS.has(name)) continue;

    const fullPath = prefix ? `${prefix}/${name}` : name;

    if (entry.kind === 'file') {
      files.set(fullPath, entry as FileSystemFileHandle);
    } else if (entry.kind === 'directory' && !name.startsWith('.')) {
      // Recurse into subdirectories (skip hidden dirs like .git)
      const subDir = await dirHandle.getDirectoryHandle(name);
      const subFiles = await walkWorkingTree(subDir, fullPath, onProgress);
      for (const [k, v] of subFiles) {
        files.set(k, v);
      }
    }
  }

  return files;
}

/**
 * Fast git change scanner — reads .git/index directly and compares against working tree.
 * 
 * Strategy:
 * 1. Read .git/index (single binary file read) → get list of tracked files + sizes
 * 2. Walk working tree directories → get list of current files
 * 3. Compare: different size = modified, missing = deleted, new = added
 * 4. Read content only for changed files
 */
async function scanRepoChanges(
  rootHandle: FileSystemDirectoryHandle,
  repoPath: string,
  onProgress?: (msg: string) => void
): Promise<GitChangedFile[]> {
  const label = repoPath || 'root';
  const t0 = Date.now();

  // Get the repo directory handle
  let repoHandle: FileSystemDirectoryHandle;
  if (!repoPath) {
    repoHandle = rootHandle;
  } else {
    repoHandle = await rootHandle.getDirectoryHandle(repoPath);
  }

  // Step 1: Read and parse .git/index
  onProgress?.(`Reading git index for ${label}...`);
  console.log(`[GitDiff] Reading .git/index for '${label}'...`);
  const gitDir = await repoHandle.getDirectoryHandle('.git');
  const indexHandle = await gitDir.getFileHandle('index');
  const indexFile = await (indexHandle as FileSystemFileHandle).getFile();
  const indexBuffer = new Uint8Array(await indexFile.arrayBuffer());
  
  const t1 = Date.now();
  console.log(`[GitDiff] Index file read: ${indexBuffer.length} bytes in ${t1 - t0}ms`);

  const indexEntries = parseGitIndex(indexBuffer);
  const t2 = Date.now();
  console.log(`[GitDiff] Index parsed: ${indexEntries.length} entries in ${t2 - t1}ms`);

  // Build lookup map from index — include ALL tracked files, no static filtering.
  // The index is the source of truth for what git tracks.
  const indexMap = new Map<string, GitIndexEntry>();
  for (const entry of indexEntries) {
    // Only track regular files (mode 100644 or 100755), skip submodules (160000)
    if ((entry.mode & 0xF000) === 0x8000) {
      indexMap.set(entry.filepath, entry);
    }
  }
  console.log(`[GitDiff] Trackable files in index: ${indexMap.size}`);

  // Step 2: Try to read HEAD tree for staged change detection
  onProgress?.(`Reading HEAD tree for ${label}...`);
  const headTree = await readHeadTree(repoHandle);
  const t2b = Date.now();
  if (headTree) {
    console.log(`[GitDiff] HEAD tree read in ${t2b - t2}ms`);
  }

  // Step 3: Check each tracked file against working tree + HEAD
  onProgress?.(`Checking ${indexMap.size} tracked files in ${label}...`);
  const changedFiles: GitChangedFile[] = [];
  let checked = 0;

  for (const [filepath, indexEntry] of indexMap) {
    checked++;
    if (checked % 100 === 0) {
      onProgress?.(`Checking ${label}: ${checked}/${indexMap.size}...`);
    }

    // Check if file is staged (index SHA ≠ HEAD SHA).
    // If headTree exists but has no entry for this file, it's a NEWLY ADDED file.
    const headSha = headTree?.get(filepath);
    const isNewlyAdded = !!headTree && !headSha; // in index but not in HEAD = new file
    const isStaged = !!headSha && headSha !== indexEntry.sha;

    if (isNewlyAdded) {
      // This file was git add'd but doesn't exist in the last commit — it's new
      let content: string | null = null;
      try {
        const parts = filepath.split('/');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let current: any = repoHandle;
        for (let i = 0; i < parts.length - 1; i++) {
          current = await current.getDirectoryHandle(parts[i]);
        }
        const fileHandle = await current.getFileHandle(parts[parts.length - 1]) as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        if (file.size < 1_000_000) content = await file.text();
      } catch { /* file may not exist on disk */ }
      changedFiles.push({ filePath: filepath, status: 'added', content });
      continue;
    }

    try {
      // Resolve file handle by walking path segments
      const parts = filepath.split('/');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let current: any = repoHandle;
      for (let i = 0; i < parts.length - 1; i++) {
        current = await current.getDirectoryHandle(parts[i]);
      }
      const fileHandle = await current.getFileHandle(parts[parts.length - 1]) as FileSystemFileHandle;
      const file = await fileHandle.getFile();

      // Compare size AND mtime — if either differs, file is modified in working tree
      const workMtimeSeconds = Math.floor(file.lastModified / 1000);
      const sizeChanged = file.size !== indexEntry.size;
      const mtimeChanged = workMtimeSeconds !== indexEntry.mtimeSeconds;

      if (sizeChanged || mtimeChanged || isStaged) {
        let content: string | null = null;
        try { content = await file.text(); } catch { /* skip */ }

        // Read the committed (HEAD) version for diff comparison.
        let originalContent: string | null = null;
        if (headSha) {
          originalContent = await readBlobContent(repoHandle, headSha);
        }

        changedFiles.push({ filePath: filepath, status: 'modified', content, originalContent });
      }
    } catch {
      // File doesn't exist in working tree → deleted
      changedFiles.push({ filePath: filepath, status: 'deleted', content: null });
    }
  }

  // Step 4: Detect untracked files in tracked directories
  // Uses the `ignore` package for proper .gitignore pattern matching
  onProgress?.(`Checking for new files in ${label}...`);
  const trackedDirs = new Set<string>();
  for (const fp of indexMap.keys()) {
    const lastSlash = fp.lastIndexOf('/');
    if (lastSlash > 0) trackedDirs.add(fp.slice(0, lastSlash));
    else trackedDirs.add('');
  }

  // Read .gitignore for filtering
  const ig = ignore();
  try {
    const gitignoreHandle = await repoHandle.getFileHandle('.gitignore');
    const gitignoreContent = await (await (gitignoreHandle as FileSystemFileHandle).getFile()).text();
    ig.add(gitignoreContent);
  } catch { /* no .gitignore — skip */ }
  // Always ignore .git directory entries
  ig.add('.git');

  for (const dir of trackedDirs) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let dirHandle: any = repoHandle;
      if (dir) {
        for (const part of dir.split('/')) {
          dirHandle = await dirHandle.getDirectoryHandle(part);
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const iter = (dirHandle as any).values() as AsyncIterable<FileSystemHandle>;
      for await (const entry of iter) {
        if (entry.kind !== 'file') continue;
        const fullPath = dir ? `${dir}/${entry.name}` : entry.name;
        if (indexMap.has(fullPath)) continue;
        if (ig.ignores(fullPath)) continue;

        let content: string | null = null;
        try {
          const file = await (entry as FileSystemFileHandle).getFile();
          if (file.size < 1_000_000) content = await file.text();
        } catch { /* skip */ }
        changedFiles.push({ filePath: fullPath, status: 'added', content });
      }
    } catch { /* dir not accessible */ }
  }

  const t3 = Date.now();
  console.log(`[GitDiff] '${label}' complete: ${changedFiles.length} changed out of ${indexMap.size} tracked, ${t3 - t0}ms total`);
  onProgress?.(`Found ${changedFiles.length} changes in ${label}`);

  return changedFiles;
}


/**
 * Gets all uncommitted files (staged + unstaged + untracked).
 * 
 * If the root folder has .git → scans it directly.
 * If not → finds child directories with .git (subrepos) and aggregates their changes,
 * prefixing paths with the subrepo name (e.g. "frontend/src/auth.ts").
 */
export async function getChangedFiles(
  dirHandle: FileSystemDirectoryHandle,
  onProgress?: (msg: string) => void
): Promise<GitChangedFile[]> {
  try {
    // Check if root is a git repo
    let hasRootGit = false;
    try {
      await dirHandle.getDirectoryHandle('.git');
      hasRootGit = true;
    } catch {
      // no root .git
    }

    if (hasRootGit) {
      onProgress?.('Scanning repository...');
      return await scanRepoChanges(dirHandle, '', onProgress);
    }

    // No root .git → scan subrepos
    onProgress?.('Looking for repositories...');
    const subrepoNames = await findSubrepoNames(dirHandle);
    if (subrepoNames.length === 0) return [];

    console.log(`[GitDiff] No root .git found, scanning ${subrepoNames.length} subrepo(s): ${subrepoNames.join(', ')}`);
    onProgress?.(`Found ${subrepoNames.length} repos: ${subrepoNames.join(', ')}`);

    const allChanges: GitChangedFile[] = [];
    for (let i = 0; i < subrepoNames.length; i++) {
      const name = subrepoNames[i];
      try {
        onProgress?.(`Scanning ${name} (${i + 1}/${subrepoNames.length})...`);
        const changes = await scanRepoChanges(dirHandle, name, onProgress);
        for (const file of changes) {
          allChanges.push({
            ...file,
            filePath: `${name}/${file.filePath}`,
          });
        }
      } catch (err) {
        console.warn(`[GitDiff] Failed to scan subrepo '${name}':`, err);
        onProgress?.(`⚠️ Failed to scan ${name}`);
      }
    }

    return allChanges;
  } catch (err) {
    console.error('[GitDiff] Failed to get changed files:', err);
    return [];
  }
}
