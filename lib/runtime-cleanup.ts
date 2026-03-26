import { rm } from "node:fs/promises";
import path from "node:path";
import { getRuntimeRootDir } from "@/lib/runtime-paths";

function normalizeResolved(filePath: string) {
  return path.resolve(filePath).toLowerCase();
}

export function isWithinRuntimeRoot(filePath: string) {
  const runtimeRoot = normalizeResolved(getRuntimeRootDir());
  const target = normalizeResolved(filePath);
  return target === runtimeRoot || target.startsWith(`${runtimeRoot}${path.sep}`);
}

export async function deleteRuntimeEntry(filePath: string) {
  if (!filePath) return false;
  if (!isWithinRuntimeRoot(filePath)) return false;
  await rm(filePath, { recursive: true, force: true }).catch(() => {});
  return true;
}

export function getRuntimeDeletionTargets(filePath: string | null | undefined) {
  if (!filePath) return [];

  const resolved = path.resolve(filePath);
  const targets = new Set<string>();
  if (isWithinRuntimeRoot(resolved)) {
    targets.add(resolved);
  }

  if (path.basename(resolved).toLowerCase() === "manifest.json") {
    const manifestDir = path.dirname(resolved);
    if (isWithinRuntimeRoot(manifestDir)) {
      targets.add(manifestDir);
    }
  }

  const chunkDir = `${resolved}.chunks`;
  if (isWithinRuntimeRoot(chunkDir)) {
    targets.add(chunkDir);
  }

  return Array.from(targets);
}

export async function deleteRuntimeEntries(filePaths: Array<string | null | undefined>) {
  const targets = Array.from(
    new Set(
      filePaths.flatMap((filePath) => getRuntimeDeletionTargets(filePath)).sort((left, right) => right.length - left.length)
    )
  );

  let deletedCount = 0;
  for (const target of targets) {
    const deleted = await deleteRuntimeEntry(target);
    if (deleted) deletedCount += 1;
  }
  return {
    deletedCount,
    targets,
  };
}
