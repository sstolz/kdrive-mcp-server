// F-024 v4 AC-43: digest-keyed package versions and an executable guide block.
// Only this double's private copy endpoint mutates tags; no real Docker runs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  executable,
  indexBody,
  run,
  sha256,
  type Reply,
  type Seen,
} from "./release.js";

export const RECOVERY_IMAGE = "ghcr.io/sstolz/kdrive-mcp-server";
export const PREVIOUS_INDEX = `${indexBody(["linux/amd64", "linux/arm64"])}\n`;
export const PREVIOUS_DIGEST = `sha256:${sha256(PREVIOUS_INDEX)}`;
export const RECOVERY_ACCEPT =
  "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json";

export class RecoveryRegistry {
  readonly bodies = new Map<string, string>();
  readonly tags = new Map<string, string>();
  readonly journal: string[] = [];
  copy: "exact" | "reserialize" | "fail" = "exact";
  latestReply: Reply | undefined;

  put(body: string, tags: string[]): string {
    const digest = `sha256:${sha256(body)}`;
    this.bodies.set(digest, body);
    for (const tag of tags) this.tags.set(tag, digest);
    return digest;
  }

  // GHCR package-version deletion removes every tag on the digest.
  deletePackage(digest: string): void {
    this.journal.push(`delete ${digest}`);
    this.bodies.delete(digest);
    for (const [tag, value] of this.tags)
      if (value === digest) this.tags.delete(tag);
  }

  route(request: Seen): Reply | undefined {
    if (request.url.startsWith("/copy/")) {
      this.journal.push("copy");
      if (this.copy === "fail") return { status: 500 };
      const digest = decodeURIComponent(request.url.slice("/copy/".length));
      const bytes = this.bodies.get(digest);
      if (!bytes) return { status: 404 };
      this.put(this.copy === "exact" ? bytes : bytes.trim(), ["latest"]);
      return { status: 200 };
    }
    const reference = /\/manifests\/(.+)$/u.exec(request.url)?.[1];
    if (!reference) return undefined;
    this.journal.push(`${request.method} ${reference}`);
    if (reference === "latest" && this.latestReply) return this.latestReply;
    const digest = this.tags.get(reference) ?? reference;
    const body = this.bodies.get(digest);
    return body === undefined
      ? { status: 404 }
      : {
          status: 200,
          body,
          headers: {
            "content-type": "application/vnd.oci.image.index.v1+json",
            // A matching HEAD header cannot prove matching GET bytes.
            "docker-content-digest": PREVIOUS_DIGEST,
          },
        };
  }
}

export function recoveryBlock(): string {
  const guide = readFileSync("docs/publishing.md", "utf8");
  const blocks = [...guide.matchAll(/^```sh\n([\s\S]*?)^```/gmu)]
    .map((match) => match[1]!)
    .filter((block) => block.includes("imagetools create"));
  if (blocks.length !== 1)
    throw new Error(
      "AC-43 requires one executable recovery block in the guide",
    );
  return blocks[0]!;
}

export async function runRecoveryBlock(
  root: string,
  url: string,
  digest: string,
  log: string,
) {
  const bin = join(root, "bin");
  // curl is replaced only to route the fixed public origin to the loopback double.
  // Record argv before routing; retain stdin, headers and raw response bytes.
  executable(
    join(bin, "curl"),
    `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.RECOVERY_LOG + ".curl", JSON.stringify(args) + "\\n");
const routed = args.map(arg => arg.replace(/^https:\\/\\/ghcr\\.io/, process.env.RECOVERY_REGISTRY));
const result = spawnSync("/usr/bin/curl", routed, { stdio: "inherit" });
process.exit(result.status === null ? 1 : result.status);
`,
  );
  executable(
    join(bin, "docker"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.RECOVERY_LOG, JSON.stringify(args) + "\\n");
const expected = ["buildx", "imagetools", "create", "--prefer-index=false", "--tag", "${RECOVERY_IMAGE}:latest", "${RECOVERY_IMAGE}@" + process.env.previous_digest];
if (JSON.stringify(args) !== JSON.stringify(expected)) process.exit(1);
fetch(process.env.RECOVERY_REGISTRY + "/copy/" + encodeURIComponent(process.env.previous_digest)).then(r => { process.exitCode = r.ok ? 0 : 1; }).catch(() => { process.exitCode = 1; });
`,
  );
  return run("/bin/sh", ["-c", recoveryBlock()], {
    cwd: root,
    env: {
      PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      RECOVERY_REGISTRY: url,
      RECOVERY_LOG: log,
      previous_digest: digest,
      previous_version: "1.0.0",
      S: "1.0.0",
      GITHUB_TOKEN: "SYNTHETIC-RECOVERY-TOKEN",
    },
  });
}
