import { NextRequest, NextResponse } from "next/server";
import { readdir, readFile, stat } from "fs/promises";
import { join, relative } from "path";

// Security: files/dirs that should NEVER be read
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

// Load .gitignore patterns
async function loadGitignore(rootPath: string): Promise<string[]> {
  try {
    const content = await readFile(join(rootPath, ".gitignore"), "utf-8");
    return content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

function isBlockedFile(name: string): boolean {
  return BLOCKED_PATTERNS.some((p) => p.test(name));
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

// Detect frameworks from project files
async function detectFrameworks(rootPath: string): Promise<string[]> {
  const frameworks: string[] = [];
  try {
    const pkg = JSON.parse(
      await readFile(join(rootPath, "package.json"), "utf-8")
    );
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    if (allDeps["next"]) frameworks.push("Next.js");
    if (allDeps["react"]) frameworks.push("React");
    if (allDeps["react-native"]) frameworks.push("React Native");
    if (allDeps["express"]) frameworks.push("Express");
    if (allDeps["vue"]) frameworks.push("Vue");
    if (allDeps["angular"]) frameworks.push("Angular");
    if (allDeps["svelte"]) frameworks.push("Svelte");
    if (allDeps["tailwindcss"]) frameworks.push("Tailwind");
    if (allDeps["prisma"]) frameworks.push("Prisma");
    if (allDeps["mongoose"]) frameworks.push("MongoDB/Mongoose");
    if (allDeps["firebase"]) frameworks.push("Firebase");
    if (allDeps["typescript"]) frameworks.push("TypeScript");
  } catch {
    /* no package.json */
  }

  try {
    await stat(join(rootPath, "requirements.txt"));
    frameworks.push("Python");
  } catch {
    /* not python */
  }

  try {
    await stat(join(rootPath, "Cargo.toml"));
    frameworks.push("Rust");
  } catch {
    /* not rust */
  }

  return frameworks;
}

// Build file tree string
async function buildTree(
  dirPath: string,
  rootPath: string,
  gitignorePatterns: string[],
  depth: number = 0,
  prefix: string = ""
): Promise<{ tree: string; fileCount: number }> {
  if (depth >= MAX_DEPTH) return { tree: "", fileCount: 0 };

  let tree = "";
  let fileCount = 0;

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const sorted = entries.sort((a, b) => {
      // Dirs first, then files
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i];
      const relPath = relative(rootPath, join(dirPath, entry.name));
      const isLast = i === sorted.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const childPrefix = isLast ? "    " : "│   ";

      // Skip blocked dirs
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      // Skip hidden dirs/files (except .gitignore itself)
      if (entry.name.startsWith(".") && entry.name !== ".gitignore") continue;
      // Skip blocked files
      if (isBlockedFile(entry.name)) continue;
      // Skip gitignored
      if (matchesGitignore(relPath, gitignorePatterns)) continue;

      if (entry.isDirectory()) {
        tree += `${prefix}${connector}${entry.name}/\n`;
        const sub = await buildTree(
          join(dirPath, entry.name),
          rootPath,
          gitignorePatterns,
          depth + 1,
          prefix + childPrefix
        );
        tree += sub.tree;
        fileCount += sub.fileCount;
      } else {
        tree += `${prefix}${connector}${entry.name}\n`;
        fileCount++;
      }
    }
  } catch (err) {
    console.error(`[Workspace] Error reading ${dirPath}:`, err);
  }

  return { tree, fileCount };
}

export async function POST(request: NextRequest) {
  try {
    const { path: workspacePath } = await request.json();

    if (!workspacePath || typeof workspacePath !== "string") {
      return NextResponse.json(
        { error: "Workspace path is required" },
        { status: 400 }
      );
    }

    // Validate path exists
    try {
      const s = await stat(workspacePath);
      if (!s.isDirectory()) {
        return NextResponse.json(
          { error: "Path is not a directory" },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Path does not exist" },
        { status: 404 }
      );
    }

    const gitignorePatterns = await loadGitignore(workspacePath);
    const frameworks = await detectFrameworks(workspacePath);
    const { tree, fileCount } = await buildTree(
      workspacePath,
      workspacePath,
      gitignorePatterns
    );

    const projectName = workspacePath.split("/").filter(Boolean).pop() || "project";

    return NextResponse.json({
      projectName,
      tree: `${projectName}/\n${tree}`,
      fileCount,
      frameworks,
    });
  } catch (error) {
    console.error("[Workspace] Error:", error);
    return NextResponse.json(
      { error: "Failed to read workspace" },
      { status: 500 }
    );
  }
}
