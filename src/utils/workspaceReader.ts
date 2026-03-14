/**
 * Client-side workspace reader using the File System Access API.
 * Opens a native folder picker and builds a file tree + detects frameworks.
 * 
 * This replaces the server-side /api/workspace endpoint when the browser
 * supports showDirectoryPicker() (Chromium 86+).
 */

// ── Security: same filters as server-side route.ts ──

const BLOCKED_PATTERNS = [
  /\.env/i, /\.pem$/i, /\.key$/i, /\.cert$/i,
  /credentials/i, /secrets/i, /\.sqlite$/i, /\.db$/i,
  /\.password/i, /\.secret/i, /id_rsa/i, /id_ed25519/i,
];

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".cache",
  ".turbo", "coverage", "__pycache__", ".venv", "venv",
  ".idea", ".vscode", ".gradle", "Pods",
]);

const MAX_DEPTH = 4;

// ── Types ──

export interface WorkspaceResult {
  tree: string;
  projectName: string;
  frameworks: string[];
}

// ── Feature detection ──

export function isDirectoryPickerSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

// ── Internal helpers ──

function isBlockedFile(name: string): boolean {
  return BLOCKED_PATTERNS.some((p) => p.test(name));
}

function shouldSkipEntry(name: string, isDir: boolean): boolean {
  if (isDir && SKIP_DIRS.has(name)) return true;
  if (name.startsWith(".") && name !== ".gitignore") return true;
  if (isBlockedFile(name)) return true;
  return false;
}

async function loadGitignorePatterns(
  dirHandle: FileSystemDirectoryHandle
): Promise<string[]> {
  try {
    const fileHandle = await dirHandle.getFileHandle(".gitignore");
    const file = await fileHandle.getFile();
    const content = await file.text();
    return content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

function matchesGitignore(relativePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const clean = pattern.replace(/^\//, "").replace(/\/$/, "");
    return (
      relativePath.startsWith(clean) ||
      relativePath.includes(`/${clean}/`) ||
      relativePath.endsWith(`/${clean}`) ||
      relativePath === clean
    );
  });
}

// ── Framework detection ──

interface PackageDeps {
  [key: string]: string;
}

const FRAMEWORK_MAP: [string, string][] = [
  ["next", "Next.js"],
  ["react-native", "React Native"],
  ["react", "React"],
  ["express", "Express"],
  ["vue", "Vue"],
  ["angular", "Angular"],
  ["svelte", "Svelte"],
  ["tailwindcss", "Tailwind"],
  ["prisma", "Prisma"],
  ["mongoose", "MongoDB/Mongoose"],
  ["firebase", "Firebase"],
  ["typescript", "TypeScript"],
];

async function detectFrameworks(
  dirHandle: FileSystemDirectoryHandle
): Promise<string[]> {
  const frameworks: string[] = [];

  try {
    const pkgHandle = await dirHandle.getFileHandle("package.json");
    const pkgFile = await pkgHandle.getFile();
    const pkg = JSON.parse(await pkgFile.text());
    const allDeps: PackageDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    for (const [dep, label] of FRAMEWORK_MAP) {
      if (allDeps[dep]) frameworks.push(label);
    }
  } catch {
    // No package.json — not a JS project
  }

  // Check for Python/Rust markers
  try {
    await dirHandle.getFileHandle("requirements.txt");
    frameworks.push("Python");
  } catch { /* not python */ }

  try {
    await dirHandle.getFileHandle("Cargo.toml");
    frameworks.push("Rust");
  } catch { /* not rust */ }

  return frameworks;
}

// ── Tree builder ──

async function buildTree(
  dirHandle: FileSystemDirectoryHandle,
  gitignorePatterns: string[],
  depth: number = 0,
  prefix: string = "",
  parentPath: string = ""
): Promise<string> {
  if (depth >= MAX_DEPTH) return "";

  // Collect and sort entries (dirs first, then alphabetically)
  const entries: { name: string; kind: "directory" | "file"; handle: FileSystemHandle }[] = [];

  // TS DOM lib doesn't include async iteration for FileSystemDirectoryHandle,
  // so we use values() with a type assertion
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const iter = (dirHandle as any).values() as AsyncIterable<FileSystemHandle>;
  for await (const handle of iter) {
    entries.push({ name: handle.name, kind: handle.kind, handle });
  }

  entries.sort((a, b) => {
    if (a.kind === "directory" && b.kind !== "directory") return -1;
    if (a.kind !== "directory" && b.kind === "directory") return 1;
    return a.name.localeCompare(b.name);
  });

  // Filter entries
  const filtered = entries.filter((entry) => {
    const isDir = entry.kind === "directory";
    if (shouldSkipEntry(entry.name, isDir)) return false;
    const relPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (matchesGitignore(relPath, gitignorePatterns)) return false;
    return true;
  });

  let tree = "";

  for (let i = 0; i < filtered.length; i++) {
    const entry = filtered[i];
    const isLast = i === filtered.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";
    const relPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

    if (entry.kind === "directory") {
      tree += `${prefix}${connector}${entry.name}/\n`;
      const subTree = await buildTree(
        entry.handle as FileSystemDirectoryHandle,
        gitignorePatterns,
        depth + 1,
        prefix + childPrefix,
        relPath
      );
      tree += subTree;
    } else {
      tree += `${prefix}${connector}${entry.name}\n`;
    }
  }

  return tree;
}

// ── Public API ──

/**
 * Opens the native folder picker and reads the selected workspace.
 * Returns the file tree, project name, and detected frameworks.
 * 
 * @throws if the user cancels or the browser doesn't support the API.
 */
export async function pickAndReadWorkspace(): Promise<WorkspaceResult> {
  if (!isDirectoryPickerSupported()) {
    throw new Error("showDirectoryPicker is not supported in this browser");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dirHandle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({
    mode: "read",
  });

  const projectName = dirHandle.name;

  const [gitignorePatterns, frameworks] = await Promise.all([
    loadGitignorePatterns(dirHandle),
    detectFrameworks(dirHandle),
  ]);

  const tree = await buildTree(dirHandle, gitignorePatterns);

  return {
    tree: `${projectName}/\n${tree}`,
    projectName,
    frameworks,
  };
}
