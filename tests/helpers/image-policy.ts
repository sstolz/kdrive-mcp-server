import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// F-013 static policy over the production Dockerfile, the image Make targets,
// .dockerignore and the publish/login markers (BR-172–BR-179, BR-188).

export interface Instruction {
  keyword: string;
  args: string;
}
export interface Stage {
  from: string;
  name: string;
  instructions: Instruction[];
}

const DIGEST = /@sha256:[0-9a-f]{64}$/u;
const NODE_CHECK = 'test "$(node --version)" = v26.13.0';
/** F-021 BR-327: the exact runtime health check. */
const HEALTHCHECK =
  '--interval=10s --timeout=10s --start-period=30s --retries=3 CMD ["node", "/app/dist/healthcheck.js"]';

function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

/** Joins continuation lines, drops comments and blank lines. */
export function instructions(text: string): Instruction[] {
  const result: Instruction[] = [];
  let pending = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!pending && (line === "" || line.startsWith("#"))) continue;
    if (line.endsWith("\\")) {
      pending += `${line.slice(0, -1).trim()} `;
      continue;
    }
    const full = `${pending}${line}`.trim();
    pending = "";
    if (!full) continue;
    const space = full.search(/\s/u);
    result.push({
      keyword: (space < 0 ? full : full.slice(0, space)).toUpperCase(),
      args: space < 0 ? "" : full.slice(space + 1).trim(),
    });
  }
  return result;
}

export function stages(text: string): Stage[] {
  const result: Stage[] = [];
  for (const instruction of instructions(text)) {
    if (instruction.keyword === "FROM") {
      const words = instruction.args.split(/\s+/u);
      const named = words.length >= 3 && words.at(-2)?.toUpperCase() === "AS";
      result.push({
        from: (named ? words.slice(0, -2) : words).join(" "),
        name: named ? (words.at(-1) ?? "") : "",
        instructions: [],
      });
      continue;
    }
    const current = result.at(-1);
    check(current, "instruction before FROM");
    current?.instructions.push(instruction);
  }
  return result;
}

function runs(stage: Stage): string[] {
  return stage.instructions
    .filter((entry) => entry.keyword === "RUN")
    .map((entry) => entry.args);
}

function only(stage: Stage, keyword: string): Instruction[] {
  return stage.instructions.filter((entry) => entry.keyword === keyword);
}

function copyParts(args: string) {
  const words = args.split(/\s+/u).filter(Boolean);
  const flags = words.filter((word) => word.startsWith("--"));
  const paths = words.filter((word) => !word.startsWith("--"));
  return {
    flags,
    sources: paths.slice(0, -1),
    destination: paths.at(-1) ?? "",
  };
}

function notWritableByOthers(flags: string[]): boolean {
  const chmod = flags.find((flag) => flag.startsWith("--chmod="));
  if (chmod === undefined) return true;
  const mode = Number.parseInt(chmod.slice("--chmod=".length), 8);
  return !Number.isNaN(mode) && (mode & 0o022) === 0;
}

const CONTEXT_FILES = new Set([
  "package.json",
  "package-lock.json",
  "LICENSE",
  "NOTICE",
  "README.md",
]);

function validateRuntimeCopy(args: string): void {
  const { flags, sources, destination } = copyParts(args);
  check(
    !flags.some((flag) => flag.startsWith("--chown")),
    "runtime COPY keeps root ownership",
  );
  check(notWritableByOthers(flags), "runtime COPY is not group/other-writable");
  const from = flags.find((flag) => flag.startsWith("--from="));
  if (from === "--from=build")
    check(
      sources.length === 1 &&
        /(?:^|\/)dist\/?$/u.test(sources[0] ?? "") &&
        destination === "/app/dist/",
      "runtime copies only dist/ from build",
    );
  else if (from === "--from=deps")
    check(
      sources.length === 1 &&
        /(?:^|\/)node_modules\/?$/u.test(sources[0] ?? "") &&
        destination === "/app/node_modules/",
      "runtime copies only node_modules/ from deps",
    );
  else
    check(
      from === undefined &&
        sources.length > 0 &&
        sources.every((source) => CONTEXT_FILES.has(source)) &&
        destination === "/app/",
      "runtime copies only the allowlisted context files",
    );
}

function entrypoint(stage: Stage): unknown {
  const found = only(stage, "ENTRYPOINT");
  check(found.length === 1, `${stage.name} has one ENTRYPOINT`);
  return JSON.parse(found[0]?.args ?? "null");
}

function validateBuildStages(build: Stage, deps: Stage): void {
  for (const stage of [build, deps])
    check(
      /^--platform=\$BUILDPLATFORM node:26\.13\.0-bookworm@sha256:[0-9a-f]{64}$/u.test(
        stage.from,
      ),
      `${stage.name} runs natively on the pinned bookworm image`,
    );
  check(
    runs(build).some((run) => run.includes(NODE_CHECK)),
    "build checks the Node version",
  );
  const install = runs(deps).find((run) =>
    run.includes("npm ci --omit=dev --omit=optional --ignore-scripts"),
  );
  check(install, "deps installs production dependencies from the lockfile");
  const cache = /--cache\s+(\S+)/u.exec(install ?? "")?.[1];
  check(
    cache && (install ?? "").includes(`rm -rf ${cache}`),
    "deps removes its npm cache in the same RUN",
  );
}

function validateRuntime(runtime: Stage): void {
  check(
    /^node:26\.13\.0-bookworm-slim@sha256:[0-9a-f]{64}$/u.test(runtime.from),
    "runtime uses the pinned slim image without --platform",
  );
  check(
    runs(runtime).some((run) => run.includes(NODE_CHECK)),
    "runtime checks the Node version",
  );
  check(
    runs(runtime).every((run) => !/\bnpm\b/u.test(run)),
    "runtime never runs npm",
  );
  check(only(runtime, "ADD").length === 0, "runtime has no ADD");
  for (const copy of only(runtime, "COPY")) validateRuntimeCopy(copy.args);
  check(
    runtime.instructions.at(-1)?.keyword === "USER" &&
      runtime.instructions.at(-1)?.args === "1000:1000",
    "runtime ends with USER 1000:1000",
  );
  const env = only(runtime, "ENV").map((entry) => entry.args);
  check(env.includes("NODE_ENV=production"), "runtime sets NODE_ENV");
  check(
    only(runtime, "STOPSIGNAL")
      .map((entry) => entry.args)
      .join() === "SIGTERM",
    "runtime STOPSIGNAL SIGTERM",
  );
  check(
    only(runtime, "EXPOSE")
      .map((entry) => entry.args)
      .join() === "3000",
    "runtime EXPOSE 3000",
  );
  check(
    JSON.stringify(entrypoint(runtime)) ===
      JSON.stringify(["node", "/app/dist/cli.js"]),
    "runtime ENTRYPOINT is the packaged CLI",
  );
  check(only(runtime, "CMD").length === 0, "runtime has no CMD");
  check(
    runs(runtime).join("\n") === NODE_CHECK,
    "runtime keeps the Node version test as its only RUN",
  );
  check(
    only(runtime, "HEALTHCHECK")
      .map((entry) => entry.args)
      .join("\n") === HEALTHCHECK,
    "runtime has exactly the exec-form node health check",
  );
}

function validateSmoke(smoke: Stage): void {
  check(smoke.from === "runtime", "smoke is FROM runtime");
  check(
    smoke.instructions.every((entry) =>
      ["COPY", "ENTRYPOINT", "USER"].includes(entry.keyword),
    ),
    "smoke only copies the composition, sets its entrypoint and keeps USER",
  );
  const copies = only(smoke, "COPY").map((entry) => copyParts(entry.args));
  check(
    copies.length === 1 &&
      copies[0]?.sources.join() === "scripts/http-acceptance.ts" &&
      copies[0].destination === "/app/scripts/http-acceptance.ts" &&
      !copies[0].flags.some((flag) => /^--(?:from|chown)/u.test(flag)) &&
      notWritableByOthers(copies[0].flags),
    "smoke adds only scripts/http-acceptance.ts, root-owned and read-only",
  );
  check(
    only(smoke, "USER").every((entry) => entry.args === "1000:1000"),
    "smoke keeps USER 1000:1000",
  );
  check(
    JSON.stringify(entrypoint(smoke)) ===
      JSON.stringify(["node", "/app/scripts/http-acceptance.ts"]),
    "smoke ENTRYPOINT is the composition",
  );
}

/** BR-172–BR-176, BR-179 (ARG/ENV names). */
export function validateDockerfile(text: string): void {
  const all = stages(text);
  check(
    all.map((stage) => stage.name).join() === "build,deps,runtime,smoke",
    "stages build, deps, runtime, smoke in order",
  );
  const [build, deps, runtime, smoke] = all as [Stage, Stage, Stage, Stage];
  validateBuildStages(build, deps);
  validateRuntime(runtime);
  validateSmoke(smoke);
  for (const stage of [build, deps])
    check(DIGEST.test(stage.from), `${stage.name} is digest-pinned`);
  for (const entry of instructions(text))
    if (entry.keyword === "ARG" || entry.keyword === "ENV")
      check(
        !/TOKEN|SECRET|PASSWORD|KEY/iu.test(
          entry.args.split(/[=\s]/u)[0] ?? "",
        ),
        "no secret-named ARG or ENV",
      );
}

export interface Rule {
  target: string;
  prerequisites: string[];
  recipe: string[];
}

/** Rules of a Makefile with their tab-indented recipe lines. */
export function rules(text: string): Rule[] {
  const result: Rule[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("\t")) {
      result.at(-1)?.recipe.push(line.slice(1));
      continue;
    }
    const match = /^([A-Za-z0-9_.-]+)\s*:(?!=)(.*)$/u.exec(line);
    if (match)
      result.push({
        target: match[1] ?? "",
        prerequisites: (match[2] ?? "").split(/\s+/u).filter(Boolean),
        recipe: [],
      });
  }
  return result;
}

function recipe(all: Rule[], target: string): string {
  const rule = all.find((entry) => entry.target === target);
  check(rule, `Makefile defines ${target}`);
  return rule?.recipe.join("\n") ?? "";
}

/** BR-177, BR-180 (Make side), BR-188. */
export function validateMakefile(text: string): void {
  const all = rules(text);
  check(
    /^IMAGE_PLATFORMS \?= linux\/amd64 linux\/arm64$/mu.test(text),
    "IMAGE_PLATFORMS defaults to both platforms",
  );
  for (const match of text.matchAll(/tonistiigi\/binfmt\S*/gu))
    check(
      /^tonistiigi\/binfmt@sha256:[0-9a-f]{64}$/u.test(match[0]),
      "binfmt image is digest-pinned",
    );
  const binfmt = recipe(all, "image-binfmt");
  check(
    binfmt.includes("--privileged") &&
      binfmt.includes("--install arm64") &&
      /\$\(BINFMT_IMAGE\)|tonistiigi\/binfmt@/u.test(binfmt) &&
      binfmt.includes("linux/arm64") &&
      binfmt.includes("uname -m") &&
      binfmt.includes("aarch64") &&
      binfmt.includes("arm64"),
    "image-binfmt registers arm64 only on a non-arm64 host when requested",
  );
  for (const rule of all) {
    check(
      !rule.prerequisites.includes("image-binfmt"),
      "image-binfmt is never a prerequisite",
    );
    const body = rule.recipe.join("\n");
    if (rule.target !== "image-binfmt")
      check(!body.includes("--privileged"), "only image-binfmt is privileged");
    if (!["image-binfmt", "help", ".PHONY"].includes(rule.target))
      check(!body.includes("image-binfmt"), "no recipe calls image-binfmt");
  }
  const image = recipe(all, "image");
  check(
    image.includes("buildx version") && image.includes("Buildx"),
    "image checks Buildx first",
  );
  check(
    image.indexOf("buildx version") < image.indexOf("buildx build"),
    "Buildx check precedes the build",
  );
  check(
    image.includes(
      'buildx build --platform "$$platform" --target "$$target" --load',
    ) &&
      image.includes("for target in runtime smoke") &&
      image.includes("kdrive-mcp-server:$$target-$$arch") &&
      image.includes("image inspect --format '{{.Os}}/{{.Architecture}}'") &&
      image.includes("for platform in $(IMAGE_PLATFORMS)"),
    "image builds runtime and smoke per platform and checks Os/Architecture",
  );
  check(
    !/--build-arg|--secret|--ssh/u.test(image),
    "image passes no build argument or secret",
  );
  const smoke = recipe(all, "image-smoke");
  check(
    smoke.includes("for platform in $(IMAGE_PLATFORMS)") &&
      smoke.includes("scripts/image-smoke.sh"),
    "image-smoke runs the smoke script per platform",
  );
}

export const DOCKERIGNORE_REQUIRED = [
  ".git",
  "node_modules",
  "secrets/",
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "coverage/",
  "runs/",
];

/** BR-179: required .dockerignore entries. */
export function validateDockerignore(text: string): void {
  const lines = new Set(text.split("\n").map((line) => line.trim()));
  for (const entry of DOCKERIGNORE_REQUIRED)
    check(
      lines.has(entry) || (entry === "node_modules" && lines.has(`${entry}/`)),
      `.dockerignore lists ${entry}`,
    );
}

export const PUBLISH_MARKERS = [
  "--push",
  "docker push",
  "docker login",
  "type=registry",
  "push=true",
  "ghcr.io",
];

// BR-178 v2: the only admitted ghcr.io references.
export const RUNNER_BASE =
  /^FROM ghcr\.io\/actions\/actions-runner:\d[\d.]*@sha256:[0-9a-f]{64}$/u;
// The exact probe URL, not followed by any further path character.
const GHCR_PROBE = /https:\/\/ghcr\.io\/v2\/(?![\w./-])/u;

function admittedRegistryText(path: string, text: string): string {
  if (path === "ops/runner/Dockerfile") {
    const base = text.split("\n").filter((line) => RUNNER_BASE.test(line));
    check(base.length <= 1, `${path} has one digest-pinned runner base`);
    return base[0] === undefined ? text : text.replace(base[0], "");
  }
  // A second or different ghcr.io string stays in the text and is rejected.
  if (path === "ops/runner/probe.sh") return text.replace(GHCR_PROBE, "");
  return text;
}

/** BR-178 v2: no push, publish or registry login marker. */
export function validateNoPublish(files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    const scanned = admittedRegistryText(path, text);
    for (const marker of PUBLISH_MARKERS)
      check(!scanned.includes(marker), `${path} contains ${marker}`);
  }
}

function walk(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}

/** Dockerfiles, Makefile, scripts, workflows and runner operations files. */
export function publishScope(): Record<string, string> {
  const paths = [
    "Dockerfile",
    "Dockerfile.dev",
    "Makefile",
    ...walk("scripts"),
    ...walk(".github/workflows"),
    ...walk("ops/runner"),
  ];
  return Object.fromEntries(
    paths.map((path) => [path, readFileSync(path, "utf8")]),
  );
}
