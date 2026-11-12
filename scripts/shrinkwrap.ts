// F-024 BR-376: writes the production npm-shrinkwrap.json from
// package-lock.json for make pack. Node built-ins only. The shrinkwrap carries
// the audited lockfile resolution, overrides included, into installs of the
// packed tarball; make pack removes it after npm pack.
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

type Entry = Record<string, unknown>;

function isEntry(value: unknown): value is Entry {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The shrinkwrap text: production entries only, in lockfile order. */
export function shrinkwrap(lockText: string): string {
  const lock: unknown = JSON.parse(lockText);
  if (!isEntry(lock) || !isEntry(lock.packages))
    throw new Error("package-lock.json has no packages");
  const packages: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!isEntry(entry)) throw new Error("package-lock.json entry");
    if (key === "") {
      const root: Entry = {};
      for (const [field, value] of Object.entries(entry))
        if (field !== "devDependencies") root[field] = value;
      packages[key] = root;
    } else if (entry.dev !== true) packages[key] = entry;
  }
  const result = {
    name: lock.name,
    version: lock.version,
    lockfileVersion: lock.lockfileVersion,
    packages,
  };
  return `${JSON.stringify(result, null, 2)}\n`;
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain())
  writeFileSync(
    "npm-shrinkwrap.json",
    shrinkwrap(readFileSync("package-lock.json", "utf8")),
  );
