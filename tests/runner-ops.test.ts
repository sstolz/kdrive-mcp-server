import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// F-015: static and stub tests of the isolated self-hosted runner files.
const OPS = "ops/runner";
const OPS_FILES = [
  "install.sh",
  "host-setup.sh",
  "nftables.conf",
  "lima.yaml",
  "kdrive-ci-runner.service",
  "kdrive-runner-nft.service",
  "egress-selftest.sh",
  "supervise.sh",
  "provision.sh",
  "Dockerfile",
  "entrypoint.sh",
  "compose.yaml",
  "probe.sh",
];
const LABELS = ["self-hosted", "linux", "x64", "kdrive-ci"];
const CHECKOUT = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683";

function text(path: string): string {
  return readFileSync(path, "utf8");
}
function ops(name: string): string {
  return text(join(OPS, name));
}
function json(value: string): Record<string, unknown> {
  return JSON.parse(value) as Record<string, unknown>;
}
function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
function sameKeys(value: unknown, keys: string[]): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}
function stub(dir: string, name: string, body: string[]): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, ["#!/bin/sh", ...body, ""].join("\n"));
  chmodSync(path, 0o755);
  return path;
}
function logLines(path: string): string[] {
  return read(path)
    .split("\n")
    .filter((line) => line !== "");
}
function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

let roots: string[] = [];
function temp(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots) {
    spawnSync("chmod", ["-R", "u+w", root]);
    rmSync(root, { recursive: true, force: true });
  }
  roots = [];
});

it("F-015 ops/runner holds exactly the scoped files", () => {
  expect(readdirSync(OPS).sort()).toEqual([...OPS_FILES].sort());
});

// ---------------------------------------------------------------- BR-218
const LIMA_KEYS = [
  "vmType",
  "arch",
  "plain",
  "mounts",
  "portForwards",
  "hostResolver",
  "ssh",
  "containerd",
  "cpus",
  "memory",
  "disk",
  "images",
];
function validateLima(config: Record<string, unknown>): void {
  check(sameKeys(config, LIMA_KEYS), "exact top-level keys");
  const fixed: Record<string, unknown> = {
    vmType: "qemu",
    arch: "x86_64",
    plain: true,
    mounts: [],
    portForwards: [
      {
        guestIPMustBeZero: false,
        guestIP: "0.0.0.0",
        guestPortRange: [1, 65535],
        proto: "any",
        ignore: true,
      },
    ],
    hostResolver: { enabled: false },
    ssh: {
      localPort: 60022,
      loadDotSSHPubKeys: false,
      forwardAgent: false,
      forwardX11: false,
    },
    containerd: { system: false, user: false },
    cpus: 4,
    memory: "8GiB",
    disk: "60GiB",
  };
  for (const [key, value] of Object.entries(fixed))
    check(JSON.stringify(config[key]) === JSON.stringify(value), `lima ${key}`);
  check(
    sameKeys(config.hostResolver, ["enabled"]) &&
      sameKeys(config.ssh, [
        "localPort",
        "loadDotSSHPubKeys",
        "forwardAgent",
        "forwardX11",
      ]) &&
      sameKeys(config.containerd, ["system", "user"]),
    "exact sub-keys",
  );
  const images = config.images;
  check(Array.isArray(images) && images.length === 1, "one image");
  const image = (images as unknown[])[0] as Record<string, unknown>;
  check(sameKeys(image, ["location", "arch", "digest"]), "image keys");
  check(image.arch === "x86_64", "image arch");
  check(
    typeof image.location === "string" && image.location.startsWith("https://"),
    "https image",
  );
  check(
    typeof image.digest === "string" &&
      /^sha256:[0-9a-f]{64}$/u.test(image.digest),
    "image digest",
  );
}

describe("BR-218 lima.yaml", () => {
  const lima = () => json(ops("lima.yaml"));
  it("BR-218 accepts the real VM definition", () => {
    expect(() => {
      validateLima(lima());
    }).not.toThrow();
  });
  const mutations: Record<string, (c: Record<string, unknown>) => void> = {
    "plain: false": (c) => {
      c.plain = false;
    },
    "one mount": (c) => {
      c.mounts = [{ location: "~", writable: false }];
    },
    "ignore: false": (c) => {
      (c.portForwards as Record<string, unknown>[])[0]!.ignore = false;
    },
    "image without digest": (c) => {
      delete (c.images as Record<string, unknown>[])[0]!.digest;
    },
    "image over http": (c) => {
      const image = (c.images as Record<string, unknown>[])[0]!;
      image.location = String(image.location).replace("https://", "http://");
    },
    "a second image": (c) => {
      (c.images as unknown[]).push((c.images as unknown[])[0]);
    },
    "hostResolver enabled": (c) => {
      c.hostResolver = { enabled: true };
    },
    "agent forwarding": (c) => {
      (c.ssh as Record<string, unknown>).forwardAgent = true;
    },
    "ssh port": (c) => {
      (c.ssh as Record<string, unknown>).localPort = 22;
    },
    "dot ssh keys": (c) => {
      (c.ssh as Record<string, unknown>).loadDotSSHPubKeys = true;
    },
    "containerd user": (c) => {
      (c.containerd as Record<string, unknown>).user = true;
    },
    "vz vmType": (c) => {
      c.vmType = "vz";
    },
    "8 cpus": (c) => {
      c.cpus = 8;
    },
    "ssh sub-key added": (c) => {
      (c.ssh as Record<string, unknown>).overVsock = true;
    },
    additionalDisks: (c) => {
      c.additionalDisks = ["data"];
    },
    vmOpts: (c) => {
      c.vmOpts = { qemu: {} };
    },
    firmware: (c) => {
      c.firmware = { legacyBIOS: true };
    },
    networks: (c) => {
      c.networks = [{ lima: "shared" }];
    },
  };
  it.each(Object.keys(mutations))("BR-218 rejects %s", (name) => {
    const config = lima();
    mutations[name]?.(config);
    expect(() => {
      validateLima(config);
    }).toThrow();
  });
});

// ---------------------------------------------------------------- BR-219
// Address literals come from the frozen spec, so the tests follow the contract.
const SPEC = text("features/F-015-self-hosted-runner.md").replaceAll(
  /\s+/gu,
  " ",
);
function specSlice(start: string, end: string): string {
  const from = SPEC.indexOf(start);
  const to = SPEC.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`spec text ${start}`);
  return SPEC.slice(from + start.length, to);
}
function backticked(fragment: string): string[] {
  return [...fragment.matchAll(/`([^`]+)`/gu)].map((match) => match[1] ?? "");
}
const PRIVATE4 = backticked(specSlice("`private4` (", ")"));
const BR230 = specSlice("**BR-230**", "**BR-231**");
const BR230_ADDRESSES = backticked(BR230).filter(
  (token) => /^\d+(\.\d+){3}$/u.test(token) || token.includes("::"),
);
const IPV6_LITERAL =
  BR230_ADDRESSES.find((token) => token.includes("::")) ?? "";
const SKUID = 'meta skuid "kdrive-runner"';
const NFT_RULES = [
  `${SKUID} meta nfproto ipv6 drop`,
  `${SKUID} ct state established,related accept`,
  `${SKUID} ip daddr 127.0.0.1 tcp dport 60022 accept`,
  `${SKUID} ip daddr @resolvers meta l4proto { tcp, udp } th dport 53 accept`,
  `${SKUID} ip daddr != @private4 ip daddr != @internal fib daddr type != local tcp dport 443 accept`,
  `${SKUID} drop`,
];
function block(source: string, header: RegExp): string {
  const match = header.exec(source);
  check(match, `block ${header.source}`);
  const start = (match?.index ?? 0) + (match?.[0].length ?? 0);
  let depth = 1;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, i);
  }
  throw new Error("unterminated block");
}
function statements(body: string): string[] {
  return body
    .split("\n")
    .map((line) => {
      const hash = line.indexOf("#");
      return (hash < 0 ? line : line.slice(0, hash)).trim();
    })
    .filter((line) => line !== "");
}
function validateNft(source: string): void {
  const code = statements(source).join("\n");
  check(!/flush ruleset/u.test(source), "no flush ruleset");
  const tables = code.split("\n").filter((line) => /\btable\b/u.test(line));
  check(
    JSON.stringify(tables) ===
      JSON.stringify([
        "table inet kdrive_runner",
        "delete table inet kdrive_runner",
        "table inet kdrive_runner {",
      ]),
    "one table inet kdrive_runner, recreated",
  );
  const table = block(code, /^table inet kdrive_runner \{$/mu);
  const chains = table.match(/^chain \S+ \{$/gmu) ?? [];
  check(chains.length === 1, "one chain");
  const chain = statements(block(table, /^chain \S+ \{$/mu));
  const hook =
    /^type filter hook output priority (-?\d+); policy accept;$/u.exec(
      chain[0] ?? "",
    );
  check(hook && Number(hook[1]) < -100, "output hook before dstnat");
  check(
    JSON.stringify(chain.slice(1)) === JSON.stringify(NFT_RULES),
    "the six rules in order",
  );
  const set = (name: string) =>
    statements(block(table, new RegExp(`^set ${name} \\{$`, "mu")));
  const header = ["type ipv4_addr", "flags interval", "auto-merge"];
  check(
    JSON.stringify(set("resolvers")) === JSON.stringify(header) &&
      JSON.stringify(set("internal")) === JSON.stringify(header),
    "resolvers and internal declared empty",
  );
  const private4 = set("private4");
  check(
    JSON.stringify(private4) ===
      JSON.stringify([...header, `elements = { ${PRIVATE4.join(", ")} }`]),
    "private4 elements",
  );
  check(
    (table.match(/^set /gmu) ?? []).length === 3,
    "exactly three named sets",
  );
  check(
    code.endsWith('include "/etc/kdrive-runner/nft-sets.conf"') &&
      (code.match(/include/gu) ?? []).length === 1,
    "sets filled only by the generated include",
  );
  check((code.match(/accept/gu) ?? []).length === 5, "no other accept");
}

describe("BR-219 nftables.conf", () => {
  const nft = () => ops("nftables.conf");
  it("BR-219 accepts the real egress table", () => {
    expect(() => {
      validateNft(nft());
    }).not.toThrow();
  });
  const mutations: Record<string, (source: string) => string> = {
    "port 80": (s) => s.replace("tcp dport 443", "tcp dport 80"),
    "a removed private4 element": (s) => s.replace("172.16.0.0/12, ", ""),
    "no fib condition": (s) => s.replace(" fib daddr type != local", ""),
    "no internal condition": (s) => s.replace(" ip daddr != @internal", ""),
    "no IPv6 drop": (s) => s.replace(`${SKUID} meta nfproto ipv6 drop\n`, ""),
    "priority 0": (s) => s.replace(/priority -\d+;/u, "priority 0;"),
    "no skuid": (s) => s.replace(`${SKUID} drop`, "drop"),
    "flush ruleset": (s) => `flush ruleset\n${s}`,
    "an extra accept": (s) =>
      s.replace(
        `${SKUID} drop`,
        `${SKUID} tcp dport 22 accept\n\t\t${SKUID} drop`,
      ),
    "another user": (s) => s.replace(`${SKUID} drop`, 'meta skuid "root" drop'),
    "resolvers element": (s) =>
      s.replace(
        /set resolvers \{\n(\s*)type ipv4_addr/u,
        "set resolvers {\n$1type ipv4_addr\n$1elements = { 9.9.9.9 }",
      ),
    "no include": (s) => s.replace(/include .*$/mu, ""),
  };
  it.each(Object.keys(mutations))("BR-219 rejects %s", (name) => {
    const source = nft();
    const mutated = mutations[name]?.(source) ?? source;
    expect(mutated).not.toBe(source);
    expect(() => {
      validateNft(mutated);
    }).toThrow();
  });
});

// ---------------------------------------------------------------- BR-220
const ROUTES = [
  "default via 198.51.100.254 dev eno1 proto static",
  "198.51.100.0/24 dev eno1 proto kernel scope link src 198.51.100.10",
  "10.10.1.0/24 dev br-1 proto kernel scope link src 10.10.1.1 linkdown",
  "0.0.0.0/1 via 10.10.1.254 dev tun0",
  "128.0.0.0/1 via 10.10.1.254 dev tun0",
  "100.100.100.100 dev tailscale0 table 52",
  "throw 127.0.0.0/8 table 52",
  "unreachable default table 99",
  "local 198.51.100.10 dev eno1 table local proto kernel scope host src 198.51.100.10",
  "broadcast 198.51.100.255 dev eno1 table local proto kernel scope link src 198.51.100.10",
  "",
].join("\n");
const ADDRESSES = [
  "1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever",
  "2: eno1    inet 198.51.100.10/24 brd 198.51.100.255 scope global eno1",
  "5: tailscale0    inet 100.80.1.2/32 scope global tailscale0",
  "",
].join("\n");
const RESOLV = [
  "# managed by systemd-resolved",
  "nameserver 2001:db8::1",
  "nameserver 192.0.2.53",
  "search example.invalid",
  "",
].join("\n");
const EXPECTED_SETS = [
  "add element inet kdrive_runner resolvers { 192.0.2.53 }",
  "add element inet kdrive_runner internal { 10.10.1.0/24, 100.100.100.100/32, 100.80.1.2/32, 127.0.0.0/8, 198.51.100.0/24, 203.0.113.0/24 }",
];

function hostSetupFixture() {
  const root = temp("kdrive-host-setup-");
  const bin = join(root, "bin");
  const log = join(root, "calls");
  const state = join(root, "state");
  mkdirSync(state);
  mkdirSync(join(root, "etc/kdrive-runner"), { recursive: true });
  mkdirSync(join(root, "etc/systemd/system"), { recursive: true });
  writeFileSync(join(root, "etc/resolv.conf"), RESOLV);
  writeFileSync(join(root, "routes"), ROUTES);
  writeFileSync(join(root, "addresses"), ADDRESSES);
  writeFileSync(
    join(root, "etc/kdrive-runner/extra-internal.conf"),
    "# site public prefix\n203.0.113.0/24\n",
  );
  const record = 'printf "%s\\n" "$(basename "$0") $*" >> "$FAKE_LOG"';
  stub(bin, "ip", [
    record,
    'case "$*" in',
    '  "-4 route show table all") cat "$FAKE_ROOT/routes" ;;',
    '  "-4 -o addr show") cat "$FAKE_ROOT/addresses" ;;',
    "  *) exit 2 ;;",
    "esac",
  ]);
  stub(bin, "id", [
    'case "$*" in',
    '  "-u") echo 0 ;;',
    '  "-nG kdrive-runner") test -f "$FAKE_ROOT/state/user" || exit 1; cat "$FAKE_ROOT/state/user" ;;',
    '  "-u kdrive-runner"|"kdrive-runner") test -f "$FAKE_ROOT/state/user" || exit 1; echo 1001 ;;',
    "  *) exit 1 ;;",
    "esac",
  ]);
  stub(bin, "getent", [
    'case "$*" in "group kvm") echo "kvm:x:993:" ;; *) exit 2 ;; esac',
  ]);
  stub(bin, "useradd", [
    record,
    'echo "kdrive-runner" > "$FAKE_ROOT/state/user"',
  ]);
  stub(bin, "usermod", [
    record,
    'echo "kdrive-runner kvm" > "$FAKE_ROOT/state/user"',
  ]);
  stub(bin, "systemctl", [record, 'exit "${FAKE_SYSTEMCTL_STATUS:-0}"']);
  const run = (args: string[], env: Record<string, string> = {}) =>
    // The Sonar snapshot drops the executable bit, so run through bash.
    spawnSync("/bin/bash", [join(OPS, "host-setup.sh"), ...args], {
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        FAKE_LOG: log,
        FAKE_ROOT: root,
        KDRIVE_RUNNER_TEST_ROOT: root,
        ...env,
      },
      encoding: "utf8",
    });
  const sets = () => read(join(root, "etc/kdrive-runner/nft-sets.conf"));
  return { root, run, sets, calls: () => read(log) };
}
function setLines(source: string): string[] {
  return source.split("\n").filter((line) => line.startsWith("add element"));
}

describe("BR-220 host-setup.sh", () => {
  it("BR-220 generates both sets from resolv.conf, every routing table, addresses and the owner file", () => {
    const f = hostSetupFixture();
    const result = f.run([]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(setLines(f.sets())).toEqual(EXPECTED_SETS);
    expect(f.calls()).toContain("ip -4 route show table all");
    const nftConf = join(f.root, "etc/kdrive-runner/nftables.conf");
    expect(read(nftConf)).toBe(ops("nftables.conf"));
    expect(statSync(nftConf).mode & 0o777).toBe(0o644);
    for (const unit of [
      "kdrive-ci-runner.service",
      "kdrive-runner-nft.service",
    ])
      expect(read(join(f.root, "etc/systemd/system", unit))).toBe(ops(unit));
    expect(existsSync(join(f.root, "etc/nftables.conf"))).toBe(false);
  });

  it("BR-220 creates the user with kvm only and ends by restarting the egress unit", () => {
    const f = hostSetupFixture();
    expect(f.run([]).status).toBe(0);
    const calls = f.calls().trim().split("\n");
    const useradd = calls.find((line) => line.startsWith("useradd")) ?? "";
    expect(useradd).toMatch(/--create-home/u);
    expect(useradd).toMatch(/--groups kvm\b/u);
    for (const group of ["sudo", "wheel", "adm", "docker"])
      expect(calls.join("\n")).not.toMatch(new RegExp(`\\b${group}\\b`, "u"));
    expect(calls.at(-1)).toBe("systemctl restart kdrive-runner-nft.service");
  });

  it("BR-220 --check changes nothing and reports the installed state", () => {
    const f = hostSetupFixture();
    expect(f.run(["--check"]).status).not.toBe(0);
    expect(f.calls()).not.toMatch(/useradd|usermod|systemctl/u);
    expect(f.sets()).toBe("");
    expect(f.run([]).status).toBe(0);
    const before = f.calls();
    const check = f.run(["--check"]);
    expect(check.status).toBe(0);
    const added = f.calls().slice(before.length);
    expect(added).not.toMatch(
      /useradd|usermod|systemctl (restart|start|daemon-reload)/u,
    );
  });

  it("BR-220 fails without loading when the restart fails", () => {
    const f = hostSetupFixture();
    const result = f.run([], { FAKE_SYSTEMCTL_STATUS: "1" });
    expect(result.status).not.toBe(0);
  });

  const failures: Record<string, (root: string) => void> = {
    "no IPv4 resolver": (root) => {
      writeFileSync(join(root, "etc/resolv.conf"), "nameserver 2001:db8::1\n");
    },
    "9.9.9.9 as resolver": (root) => {
      writeFileSync(
        join(root, "etc/resolv.conf"),
        "nameserver 192.0.2.53\nnameserver 9.9.9.9\n",
      );
    },
    "an empty internal set": (root) => {
      writeFileSync(
        join(root, "routes"),
        "default via 198.51.100.254 dev eno1\n",
      );
      writeFileSync(join(root, "addresses"), "");
      rmSync(join(root, "etc/kdrive-runner/extra-internal.conf"));
    },
  };
  it.each(Object.keys(failures))(
    "BR-220 exits nonzero and loads nothing with %s",
    (name) => {
      const f = hostSetupFixture();
      failures[name]?.(f.root);
      const result = f.run([]);
      expect(result.status).not.toBe(0);
      expect(f.sets()).toBe("");
      expect(f.calls()).not.toContain("systemctl restart");
    },
  );

  it("BR-220 the units: system unit as kdrive-runner bound to the egress oneshot", () => {
    const unit = ops("kdrive-ci-runner.service");
    expect(unit).toMatch(/^User=kdrive-runner$/mu);
    expect(unit).toMatch(/^Requires=kdrive-runner-nft\.service$/mu);
    expect(unit).toMatch(/^After=kdrive-runner-nft\.service( .*)?$/mu);
    expect(unit.match(/^ExecStart=.*$/gmu)).toEqual([
      "ExecStart=/opt/kdrive-runner/ops/supervise.sh run",
    ]);
    expect(unit).not.toMatch(/linger|WantedBy=default\.target/iu);
    const nft = ops("kdrive-runner-nft.service");
    expect(nft).toMatch(/^Type=oneshot$/mu);
    expect(nft).not.toMatch(/^User=/mu);
    expect(nft).toMatch(
      /^ExecStart=\/usr\/sbin\/nft -f \/etc\/kdrive-runner\/nftables\.conf$/mu,
    );
    expect(nft).toMatch(
      /^ExecStop=-\/usr\/sbin\/nft delete table inet kdrive_runner$/mu,
    );
    expect(nft).not.toMatch(/flush|\/etc\/nftables\.conf/u);
    const setup = ops("host-setup.sh");
    expect(setup).not.toMatch(
      /usermod[^\n]*docker|sudoers|\/etc\/nftables\.conf|loginctl|enable-linger/u,
    );
  });

  it("BR-220 no ops file references a host Docker socket except compose.yaml", () => {
    for (const name of OPS_FILES.filter((file) => file !== "compose.yaml"))
      expect(ops(name), name).not.toMatch(/\/(var\/)?run\/docker\.sock/u);
    expect(ops("compose.yaml")).toContain("/var/run/docker.sock");
  });
});

// ---------------------------------------------------------------- BR-221
describe("BR-221 provision.sh", () => {
  const provision = () => ops("provision.sh");
  function validateProvision(source: string): void {
    const lines = source.split("\n");
    const firstApt = lines.findIndex((line) => /apt-get /u.test(line));
    const rewrite = lines.findIndex((line) =>
      line.includes("s#http://#https://#g"),
    );
    check(rewrite >= 0 && rewrite < firstApt, "HTTPS rewrite before apt-get");
    for (const name of [
      "DOCKER_CE_VERSION",
      "CONTAINERD_VERSION",
      "BUILDX_VERSION",
      "COMPOSE_VERSION",
    ])
      check(
        new RegExp(`^${name}='[0-9][^'*]*'$`, "mu").test(source),
        `exact ${name}`,
      );
    check(
      source.includes("https://download.docker.com/linux/debian"),
      "Docker repository over HTTPS",
    );
    for (const pkg of [
      'docker-ce="$DOCKER_CE_VERSION"',
      'docker-ce-cli="$DOCKER_CE_VERSION"',
      'containerd.io="$CONTAINERD_VERSION"',
      'docker-buildx-plugin="$BUILDX_VERSION"',
      'docker-compose-plugin="$COMPOSE_VERSION"',
    ])
      check(source.includes(pkg), `pinned ${pkg}`);
    check(
      source.includes("ExecStart=/usr/bin/dockerd -H fd:// ") &&
        !/tcp:\/\/|-H tcp|2375|2376/u.test(source),
      "socket-only dockerd",
    );
    check(
      source.includes(
        'docker build --tag kdrive-ci-runner:local --file "$src/Dockerfile" "$src"',
      ),
      "builds the runner image",
    );
    check(
      source.includes("install -d -o 1001 -g 1001 -m 0755 /home/runner/_work"),
      "workspace owned by uid 1001",
    );
    check(
      source.includes("/etc/kdrive-runner/docker-gid"),
      "records the docker gid",
    );
    check(
      !/(curl|wget)[^\n|]*\|\s*(ba)?sh/u.test(source) &&
        !/\blatest\b/u.test(source),
      "no pipe to shell, no latest",
    );
  }
  it("BR-221 accepts the real provisioning script", () => {
    expect(() => {
      validateProvision(provision());
    }).not.toThrow();
  });
  const mutations: Record<string, (s: string) => string> = {
    "apt-get before the rewrite": (s) =>
      s.replace(/^(for source in )/mu, "apt-get update\n$1"),
    "curl piped to sh": (s) => `${s}\ncurl -fsSL https://get.docker.com | sh\n`,
    "unpinned latest": (s) => `${s}\n# install latest\n`,
    "TCP listener": (s) =>
      s.replace("dockerd -H fd:// ", "dockerd -H fd:// -H tcp://0.0.0.0:2375 "),
    "unpinned docker-ce": (s) =>
      s.replace('docker-ce="$DOCKER_CE_VERSION"', "docker-ce"),
  };
  it.each(Object.keys(mutations))("BR-221 rejects %s", (name) => {
    const source = provision();
    const mutated = mutations[name]?.(source) ?? source;
    expect(mutated).not.toBe(source);
    expect(() => {
      validateProvision(mutated);
    }).toThrow();
  });
});

// ---------------------------------------------------------------- BR-222
function validateRunnerDockerfile(source: string): void {
  const instructions = source
    .split("\n")
    .filter((line) => /^[A-Z]+ /u.test(line));
  const from = instructions.filter((line) => line.startsWith("FROM "));
  check(
    from.length === 1 &&
      /^FROM ghcr\.io\/actions\/actions-runner:\d[\d.]*@sha256:[0-9a-f]{64}$/u.test(
        from[0] ?? "",
      ),
    "one digest-pinned official runner base",
  );
  check(instructions.at(-1) === "USER runner", "ends with USER runner");
  const runs = source.split(/^RUN /mu).slice(1);
  const compose = runs.filter((run) => run.includes("docker-compose"));
  check(
    compose.length === 1 &&
      /releases\/download\/v\d[\d.]*\/docker-compose-linux-x86_64/u.test(
        compose[0] ?? "",
      ) &&
      /[0-9a-f]{64} {2}\/usr\/local\/lib\/docker\/cli-plugins\/docker-compose' \| sha256sum -c -/u.test(
        compose[0] ?? "",
      ),
    "compose plugin pinned and checked in the same RUN",
  );
  const installs = [...source.matchAll(/apt-get install[^\n\\]*/gu)].map(
    (match) => match[0],
  );
  check(
    installs.length === 1 &&
      installs[0] === "apt-get install -y --no-install-recommends make ",
    "only make is installed",
  );
  check(
    source.includes(
      "COPY --chmod=0755 entrypoint.sh /usr/local/bin/kdrive-runner-entrypoint",
    ) &&
      source.includes('ENTRYPOINT ["/usr/local/bin/kdrive-runner-entrypoint"]'),
    "entrypoint.sh as the image entrypoint",
  );
  check(!/docker login|--push/u.test(source), "no login or push");
}
function validateCompose(config: Record<string, unknown>): void {
  check(sameKeys(config, ["services"]), "services only");
  const services = config.services as Record<string, unknown>;
  check(sameKeys(services, ["runner"]), "one service runner");
  const runner = services.runner as Record<string, unknown>;
  check(
    sameKeys(runner, [
      "image",
      "pull_policy",
      "restart",
      "group_add",
      "volumes",
    ]),
    "runner keys: no privileged, ports, network_mode, cap_add, devices, pid, environment or command",
  );
  check(
    runner.image === "kdrive-ci-runner:local" &&
      runner.pull_policy === "never" &&
      runner.restart === "no",
    "local image, never pulled, never restarted",
  );
  check(
    JSON.stringify(runner.group_add) === JSON.stringify(["${DOCKER_GID:?}"]),
    "docker group only",
  );
  check(
    JSON.stringify(runner.volumes) ===
      JSON.stringify([
        "/var/run/docker.sock:/var/run/docker.sock",
        "/home/runner/_work:/home/runner/_work",
        "/run/kdrive-runner:/run/kdrive-runner",
      ]),
    "three identical-path volumes",
  );
}

describe("BR-222 runner image, compose and entrypoint", () => {
  it("BR-222 accepts the real Dockerfile", () => {
    expect(() => {
      validateRunnerDockerfile(ops("Dockerfile"));
    }).not.toThrow();
  });
  const dockerMutations: Record<string, (s: string) => string> = {
    "tag-only FROM": (s) => s.replace(/@sha256:[0-9a-f]{64}/u, ""),
    "second FROM": (s) => `FROM debian:bookworm\n${s}`,
    "docker login": (s) =>
      s.replace("USER runner", "RUN docker login\nUSER runner"),
    "unchecked compose": (s) => s.replace(" | sha256sum -c -", ""),
    "extra package": (s) =>
      s.replace(
        "no-install-recommends make ",
        "no-install-recommends make curl ",
      ),
    "not ending as runner": (s) => `${s}\nUSER root\n`,
  };
  it.each(Object.keys(dockerMutations))(
    "BR-222 rejects Dockerfile %s",
    (name) => {
      const source = ops("Dockerfile");
      const mutated = dockerMutations[name]?.(source) ?? source;
      expect(mutated).not.toBe(source);
      expect(() => {
        validateRunnerDockerfile(mutated);
      }).toThrow();
    },
  );

  it("BR-222 accepts the real compose file", () => {
    expect(() => {
      validateCompose(json(ops("compose.yaml")));
    }).not.toThrow();
  });
  const runnerOf = (c: Record<string, unknown>) =>
    (c.services as Record<string, Record<string, unknown>>).runner!;
  const composeMutations: Record<string, (c: Record<string, unknown>) => void> =
    {
      privileged: (c) => {
        runnerOf(c).privileged = true;
      },
      ports: (c) => {
        runnerOf(c).ports = ["8080:8080"];
      },
      "network_mode: host": (c) => {
        runnerOf(c).network_mode = "host";
      },
      "a fourth volume": (c) => {
        (runnerOf(c).volumes as string[]).push("/:/host");
      },
      "a different target path": (c) => {
        (runnerOf(c).volumes as string[])[1] = "/home/runner/_work:/work";
      },
      environment: (c) => {
        runnerOf(c).environment = { RUNNER_JITCONFIG: "x" };
      },
      command: (c) => {
        runnerOf(c).command = ["./run.sh"];
      },
      "a second service": (c) => {
        (c.services as Record<string, unknown>).other = { image: "x" };
      },
    };
  it.each(Object.keys(composeMutations))(
    "BR-222 rejects compose %s",
    (name) => {
      const config = json(ops("compose.yaml"));
      composeMutations[name]?.(config);
      expect(() => {
        validateCompose(config);
      }).toThrow();
    },
  );

  const JIT = "SYNTHETIC-JIT-CONFIGURATION-VALUE";
  function entrypointFixture() {
    const root = temp("kdrive-entrypoint-");
    const jitDir = join(root, "run/kdrive-runner");
    mkdirSync(jitDir, { recursive: true });
    const jit = join(jitDir, "jitconfig");
    const script = join(root, "entrypoint.sh");
    writeFileSync(
      script,
      ops("entrypoint.sh").replaceAll("/run/kdrive-runner/jitconfig", jit),
    );
    chmodSync(script, 0o755);
    const work = join(root, "work");
    stub(work, "run.sh", [
      'printf "%s\\n" "$@" > ../args',
      "env > ../env",
      'if test -e "$FAKE_JIT"; then echo present; else echo absent; fi > ../file-state',
    ]);
    const run = () =>
      spawnSync(script, [], {
        cwd: work,
        env: { PATH: "/usr/bin:/bin", FAKE_JIT: jit },
        encoding: "utf8",
      });
    return { root, jit, jitDir, run };
  }
  it("BR-222 entrypoint passes the JIT value as an argument, deletes the file, exports nothing", () => {
    const f = entrypointFixture();
    writeFileSync(f.jit, JIT, { mode: 0o400 });
    const result = f.run();
    expect(result.status).toBe(0);
    expect(read(join(f.root, "args"))).toBe(`--jitconfig\n${JIT}\n`);
    expect(read(join(f.root, "file-state"))).toBe("absent\n");
    expect(read(join(f.root, "env"))).not.toContain(JIT);
    expect(existsSync(f.jit)).toBe(false);
    expect(result.stdout + result.stderr).not.toContain(JIT);
  });
  it.each(["missing", "empty", "undeletable"])(
    "BR-222 entrypoint exits nonzero without running the runner when the file is %s",
    (variant) => {
      const f = entrypointFixture();
      if (variant === "empty") writeFileSync(f.jit, "");
      if (variant === "undeletable") {
        writeFileSync(f.jit, JIT);
        chmodSync(f.jitDir, 0o555);
      }
      const result = f.run();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/^kdrive-runner entrypoint: /u);
      expect(existsSync(join(f.root, "args"))).toBe(false);
      expect(result.stdout + result.stderr).not.toContain(JIT);
    },
  );
});

// ------------------------------------------------------ BR-223, BR-224
const TOKEN = "synthetic-token-value-not-a-secret-0123";
const JIT_VALUE = "U1lOVEhFVElDLUpJVC1WQUxVRQ==";
function supervisorFixture() {
  const root = temp("kdrive-supervise-");
  const home = join(root, "home");
  const opsDir = join(root, "opt/kdrive-runner/ops");
  mkdirSync(opsDir, { recursive: true });
  for (const name of OPS_FILES)
    if (name !== "egress-selftest.sh")
      copyFileSync(join(OPS, name), join(opsDir, name));
  chmodSync(join(opsDir, "supervise.sh"), 0o755);
  const log = join(root, "calls");
  const record = 'printf "%s\\n" "$(basename "$0") $*" >> "$FAKE_LOG"';
  stub(opsDir, "egress-selftest.sh", [record, 'exit "${FAKE_SELFTEST:-0}"']);
  stub(join(root, "opt/kdrive-runner/lima/bin"), "limactl", [
    record,
    'case "$1" in',
    '  start) exit "${FAKE_START:-0}" ;;',
    '  shell) case "$*" in *jitconfig*) cat > "$FAKE_ROOT/jit-stdin" ;; esac ;;',
    '  create) mkdir -p "$HOME/.lima/kdrive-ci" && : > "$HOME/.lima/kdrive-ci/disk" ;;',
    "esac",
  ]);
  const bin = join(root, "bin");
  stub(bin, "qemu-img", [
    record,
    'test "${FAKE_QEMU:-0}" = 0 || exit 1',
    'for last in "$@"; do :; done',
    ': > "$last"',
  ]);
  stub(bin, "curl", [
    record,
    'cat > "$FAKE_ROOT/curl-stdin"',
    'test "${FAKE_CURL:-0}" = 0 || exit 22',
    `printf '{\\n  "runner": {"id": 7},\\n  "encoded_jit_config": "${JIT_VALUE}"\\n}\\n'`,
  ]);
  stub(bin, "docker", [record]);
  stub(bin, "ps", [record, 'exit "${FAKE_PS:-1}"']);
  stub(bin, "sleep", [record]);
  const instance = join(home, ".lima/kdrive-ci");
  mkdirSync(instance, { recursive: true });
  writeFileSync(join(instance, "disk"), "old");
  writeFileSync(join(instance, "qemu.pid"), "4242\n");
  const state = join(home, ".local/share/kdrive-runner");
  mkdirSync(state, { recursive: true });
  const golden = join(state, "golden.qcow2");
  writeFileSync(golden, "golden");
  chmodSync(golden, 0o444);
  const tokenDir = join(home, ".config/kdrive-runner");
  mkdirSync(tokenDir, { recursive: true });
  const token = join(tokenDir, "github-token");
  writeFileSync(token, `${TOKEN}\n`, { mode: 0o600 });
  chmodSync(token, 0o600);
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(join(opsDir, "supervise.sh"), args, {
      cwd: root,
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: home,
        FAKE_LOG: log,
        FAKE_ROOT: root,
        KDRIVE_RUNNER_MAX_CYCLES: "1",
        ...env,
      },
      encoding: "utf8",
    });
  const calls = () => logLines(log);
  return { root, home, bin, opsDir, instance, golden, token, run, calls };
}
function kinds(calls: string[]): string[] {
  return calls.map((line) => {
    if (line.startsWith("egress-selftest.sh")) return "selftest";
    if (line.startsWith("limactl stop -f")) return "stop";
    if (line.startsWith("ps -p")) return "pid-check";
    if (line.startsWith("qemu-img create")) return "overlay";
    if (line.startsWith("limactl start")) return "start";
    if (line.startsWith("curl")) return "jit-request";
    if (line.startsWith("limactl shell") && line.includes("jitconfig"))
      return "jit-write";
    if (line.startsWith("limactl shell") && line.includes("compose"))
      return "runner";
    if (line.startsWith("sleep")) return line;
    return `other: ${line}`;
  });
}
function treeText(dir: string): string {
  if (!existsSync(dir)) return "";
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((entry) => join(dir, entry))
    .filter((path) => lstatSync(path).isFile())
    .map((path) => read(path))
    .join("\n");
}

describe("BR-224 supervise.sh run", () => {
  it("BR-224 one cycle: stop, pid check, overlay from golden, start, JIT request, runner", () => {
    const f = supervisorFixture();
    const result = f.run(["run"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(kinds(f.calls())).toEqual([
      "selftest",
      "stop",
      "pid-check",
      "overlay",
      "start",
      "jit-request",
      "jit-write",
      "runner",
    ]);
    const overlay = f.calls().find((line) => line.startsWith("qemu-img")) ?? "";
    expect(overlay).toBe(
      `qemu-img create -f qcow2 -F qcow2 -b ${f.golden} ${f.instance}/disk.new`,
    );
    expect(read(join(f.instance, "disk"))).toBe("");
    expect(f.calls().find((line) => line.startsWith("ps"))).toBe("ps -p 4242");
  });

  it("BR-224 a QEMU process that remains after the stop blocks the overlay", () => {
    const f = supervisorFixture();
    const result = f.run(["run"], { FAKE_PS: "0" });
    expect(kinds(f.calls())).toEqual([
      "selftest",
      "stop",
      "pid-check",
      "sleep 60",
    ]);
    expect(read(join(f.instance, "disk"))).toBe("old");
    expect(result.stdout + result.stderr).toMatch(/QEMU process/u);
  });

  it.each<[string, Record<string, string>, string[]]>([
    [
      "the overlay creation",
      { FAKE_QEMU: "1" },
      ["selftest", "stop", "pid-check", "overlay", "sleep 60"],
    ],
    [
      "the start",
      { FAKE_START: "1" },
      ["selftest", "stop", "pid-check", "overlay", "start", "sleep 60"],
    ],
    [
      "the JIT request",
      { FAKE_CURL: "1" },
      [
        "selftest",
        "stop",
        "pid-check",
        "overlay",
        "start",
        "jit-request",
        "sleep 60",
      ],
    ],
  ])(
    "BR-224 a failure of %s starts no runner and waits 60 seconds",
    (_name, env, expected) => {
      const f = supervisorFixture();
      f.run(["run"], env);
      expect(kinds(f.calls())).toEqual(expected);
    },
  );

  it("BR-224 a garbage pid file fails the pid check", () => {
    const f = supervisorFixture();
    writeFileSync(join(f.instance, "qemu.pid"), "not-a-pid\n");
    f.run(["run"]);
    expect(kinds(f.calls())).toEqual(["selftest", "stop", "sleep 60"]);
  });

  it("BR-224 an egress self-test that connects starts no VM and waits 60 seconds", () => {
    const f = supervisorFixture();
    const result = f.run(["run"], { FAKE_SELFTEST: "1" });
    expect(kinds(f.calls())).toEqual(["selftest", "sleep 60"]);
    expect(result.stdout + result.stderr).toMatch(/egress/u);
  });

  it("BR-224 golden self-tests, creates, provisions, stops and saves a 0444 overlay", () => {
    const f = supervisorFixture();
    rmSync(f.golden, { force: true });
    rmSync(f.instance, { recursive: true, force: true });
    const result = f.run(["golden"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const calls = f.calls();
    expect(calls[0]).toBe("egress-selftest.sh ");
    const create = calls.findIndex((line) => line.startsWith("limactl create"));
    const start = calls.findIndex((line) => line.startsWith("limactl start"));
    const copy = calls.findIndex((line) => line.startsWith("limactl copy"));
    const provision = calls.findIndex(
      (line) =>
        line.startsWith("limactl shell") && line.includes("provision.sh"),
    );
    const stop = calls.findIndex((line) => line.startsWith("limactl stop"));
    const save = calls.findIndex((line) => line.startsWith("qemu-img convert"));
    expect(
      [create, start, copy, provision, stop, save].every((i) => i > 0),
    ).toBe(true);
    expect(create < start && start < copy && copy < provision).toBe(true);
    expect(provision < stop && stop < save).toBe(true);
    expect(calls[create]).toContain(`${f.opsDir}/lima.yaml`);
    for (const name of [
      "provision.sh",
      "Dockerfile",
      "compose.yaml",
      "entrypoint.sh",
      "probe.sh",
    ])
      expect(calls[copy]).toContain(`${f.opsDir}/${name}`);
    expect(statSync(f.golden).mode & 0o777).toBe(0o444);
  });

  it("BR-224 golden exits nonzero without any limactl call when the self-test connects", () => {
    const f = supervisorFixture();
    const result = f.run(["golden"], { FAKE_SELFTEST: "1" });
    expect(result.status).not.toBe(0);
    expect(f.calls()).toEqual(["egress-selftest.sh "]);
  });

  it("BR-224 egress-selftest.sh sends one UDP datagram to 9.9.9.9:53 and requires EPERM", () => {
    const source = ops("egress-selftest.sh");
    expect(source).toContain("/dev/udp/9.9.9.9/53");
    expect(source).toContain("Operation not permitted");
    expect(source).toMatch(/timeout 5 /u);
  });
});

describe("BR-223 supervise.sh credential handling", () => {
  it.each(["missing", "symlink", "mode 0644", "another owner"])(
    "BR-223 refuses a credential file that is %s before any call",
    (variant) => {
      const f = supervisorFixture();
      const env: Record<string, string> = {};
      if (variant === "missing") rmSync(f.token);
      if (variant === "symlink") {
        const real = join(f.root, "real-token");
        writeFileSync(real, TOKEN, { mode: 0o600 });
        rmSync(f.token);
        symlinkSync(real, f.token);
      }
      if (variant === "mode 0644") chmodSync(f.token, 0o644);
      if (variant === "another owner") {
        stub(f.bin, "id", ['test "$1" = -u && echo 4242']);
      }
      const result = f.run(["run"], env);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toBe(
        "supervise: the runner token file must be a regular file owned by this user with mode 0600.\n",
      );
      expect(f.calls()).toEqual([]);
    },
  );

  it("BR-223 the credential and the JIT value never appear in arguments, instance files or output", () => {
    const f = supervisorFixture();
    const result = f.run(["run"]);
    expect(result.status).toBe(0);
    const calls = f.calls().join("\n");
    for (const secret of [TOKEN, JIT_VALUE]) {
      expect(calls).not.toContain(secret);
      expect(result.stdout + result.stderr).not.toContain(secret);
      expect(treeText(join(f.home, ".lima"))).not.toContain(secret);
    }
    expect(read(join(f.root, "jit-stdin"))).toBe(JIT_VALUE);
    expect(read(join(f.root, "curl-stdin"))).toBe(
      `Authorization: Bearer ${TOKEN}\n`,
    );
    const request = f.calls().find((line) => line.startsWith("curl")) ?? "";
    expect(request).toContain(
      "https://api.github.com/repos/sstolz/kdrive-mcp-server/actions/runners/generate-jitconfig",
    );
    const body = /--data (\{.*\})/u.exec(request)?.[1] ?? "{}";
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed.runner_group_id).toBe(1);
    expect(parsed.labels).toEqual(LABELS);
    expect(String(parsed.name)).toMatch(/^kdrive-ci-\d{8}T\d{6}Z$/u);
    expect(request).toContain("-H @-");
    const write =
      f
        .calls()
        .find(
          (line) =>
            line.startsWith("limactl shell") && line.includes("jitconfig"),
        ) ?? "";
    expect(write).toContain("chown 1001:1001 /run/kdrive-runner");
    expect(write).toContain("mkdir -m 0700 /run/kdrive-runner");
    expect(write).toContain("chmod 0400 /run/kdrive-runner/jitconfig");
  });
});

// ------------------------------------------------- BR-229, BR-230, BR-231
interface AcceptanceStep {
  uses?: string;
  with?: Record<string, unknown>;
  run?: string;
  env?: Record<string, string>;
}
interface AcceptanceJob {
  "runs-on": unknown;
  "timeout-minutes": number;
  needs?: string[];
  steps: AcceptanceStep[];
}
function validateAcceptance(workflow: Record<string, unknown>): void {
  check(
    sameKeys(workflow, ["name", "on", "permissions", "jobs"]),
    "no workflow env, concurrency or defaults",
  );
  check(!/secrets/iu.test(JSON.stringify(workflow)), "no secrets reference");
  check(
    JSON.stringify(workflow.on) ===
      JSON.stringify({
        workflow_dispatch: {
          inputs: {
            lan_target: {
              description:
                "LAN host:port that must stay unreachable (optional)",
              required: false,
              type: "string",
            },
            host_target: {
              description:
                "Host public address:443 that must stay unreachable (optional)",
              required: false,
              type: "string",
            },
          },
        },
      }),
    "workflow_dispatch only with two optional string inputs",
  );
  check(
    JSON.stringify(workflow.permissions) ===
      JSON.stringify({ contents: "read" }),
    "read-only",
  );
  const jobs = workflow.jobs as Record<string, AcceptanceJob>;
  check(sameKeys(jobs, ["probe", "reset-mark", "reset-check"]), "three jobs");
  const checkout = { uses: CHECKOUT, with: { "persist-credentials": false } };
  const expected: Record<string, AcceptanceJob> = {
    probe: {
      "runs-on": LABELS,
      "timeout-minutes": 10,
      steps: [
        checkout,
        {
          run: "make runner-probe",
          env: {
            LAN_TARGET: "${{ inputs.lan_target }}",
            HOST_TARGET: "${{ inputs.host_target }}",
          },
        },
      ],
    },
    "reset-mark": {
      "runs-on": LABELS,
      "timeout-minutes": 10,
      steps: [checkout, { run: "make runner-reset-mark" }],
    },
    "reset-check": {
      "runs-on": LABELS,
      "timeout-minutes": 10,
      needs: ["reset-mark"],
      steps: [checkout, { run: "make runner-reset-check" }],
    },
  };
  for (const [name, job] of Object.entries(expected))
    check(
      JSON.stringify(jobs[name]) === JSON.stringify(job),
      `${name} job exactly as BR-229`,
    );
}

describe("BR-229 runner-acceptance.yml", () => {
  const workflow = () => json(text(".github/workflows/runner-acceptance.yml"));
  it("BR-229 accepts the real acceptance workflow", () => {
    expect(() => {
      validateAcceptance(workflow());
    }).not.toThrow();
  });
  const mutations: Record<string, (w: Record<string, unknown>) => void> = {
    "a secrets reference": (w) => {
      const jobs = w.jobs as Record<string, AcceptanceJob>;
      jobs.probe!.steps[1]!.env!.TOKEN = "${{ secrets.GITHUB_TOKEN }}";
    },
    "a push trigger": (w) => {
      (w.on as Record<string, unknown>).push = { branches: ["main"] };
    },
    "workflow env": (w) => {
      w.env = { LAN_TARGET: "${{ inputs.lan_target }}" };
    },
    "write permission": (w) => {
      w.permissions = { contents: "write" };
    },
    "inputs in reset-mark": (w) => {
      const jobs = w.jobs as Record<string, AcceptanceJob>;
      jobs["reset-mark"]!.steps[1]!.env = {
        LAN_TARGET: "${{ inputs.lan_target }}",
      };
    },
    "reset-check without needs": (w) => {
      const jobs = w.jobs as Record<string, AcceptanceJob>;
      delete jobs["reset-check"]!.needs;
    },
    "hosted runner": (w) => {
      const jobs = w.jobs as Record<string, AcceptanceJob>;
      jobs.probe!["runs-on"] = "ubuntu-24.04";
    },
  };
  it.each(Object.keys(mutations))("BR-229 rejects %s", (name) => {
    const w = workflow();
    mutations[name]?.(w);
    expect(() => {
      validateAcceptance(w);
    }).toThrow();
  });

  it("BR-229 BR-230 BR-231 the Make targets call probe.sh", () => {
    const makefile = text("Makefile");
    for (const [target, mode] of [
      ["runner-probe", "run"],
      ["runner-reset-mark", "reset-mark"],
      ["runner-reset-check", "reset-check"],
    ])
      expect(makefile).toContain(
        `${target}:\n\t@/bin/bash ops/runner/probe.sh ${mode}\n`,
      );
  });
});

describe("BR-230 probe.sh", () => {
  const probe = () => ops("probe.sh");
  function validateProbe(source: string): void {
    for (const port of ["22", "80", "443", "2375", "2376", "47999"])
      check(
        new RegExp(`^GATEWAY_PORTS='.*\\b${port}\\b.*'$`, "mu").test(source),
        `gateway port ${port}`,
      );
    check(/^GATEWAY='192\.168\.5\.2'$/mu.test(source), "VM gateway");
    check(/^TIMEOUT=5$/mu.test(source), "5-second limit");
    check(
      /^PRIVATE_TARGETS='10\.0\.0\.1 172\.16\.0\.1 192\.168\.0\.1 192\.168\.1\.1'$/mu.test(
        source,
      ),
      "private targets",
    );
    check(
      BR230_ADDRESSES.length >= 8 &&
        BR230_ADDRESSES.every((address) => source.includes(address)),
      "every BR-230 address literal is probed",
    );
    check(source.includes("host.lima.internal"), "host.lima.internal");
    check(source.includes("/dev/udp/9.9.9.9/53"), "direct DNS probe");
    check(source.includes("getent ahostsv6 github.com"), "github IPv6 probe");
    check(source.includes("getent hosts github.com"), "positive DNS probe");
    for (const url of [
      "https://api.github.com",
      "https://github.com",
      "https://ghcr.io/v2/",
      "https://registry-1.docker.io/v2/",
      "https://registry.npmjs.org/",
      "https://download.docker.com/",
    ])
      check(source.includes(`'${url}'`), `positive ${url}`);
    check(
      source.includes("nsenter -t 1 -m cat /proc/self/mounts") &&
        /9p.*virtiofs.*fuse\.sshfs/u.test(source),
      "no-host-mount check",
    );
    check(
      source.includes("--network host --pid host --privileged --user 0:0") &&
        source.includes("kdrive-ci-runner:local"),
      "VM network view container",
    );
    const header = /^mask_inputs\(\) \{$/mu.exec(source);
    const body = header ? block(source, /^mask_inputs\(\) \{$/mu) : "";
    const first = source.search(/\b(LAN|HOST)_TARGET\b/u);
    check(
      header &&
        body.includes("printf '::add-mask::%s\\n'") &&
        first > header.index &&
        first < header.index + header[0].length + body.length,
      "inputs masked before any use",
    );
  }
  it("BR-230 accepts the real probe list and thresholds", () => {
    expect(() => {
      validateProbe(probe());
    }).not.toThrow();
  });
  const mutations: Record<string, (s: string) => string> = {
    "missing ::add-mask::": (s) => s.replaceAll("::add-mask::", "masked:"),
    "a gateway port dropped": (s) => s.replace(" 47999", ""),
    "a longer limit": (s) => s.replace(/^TIMEOUT=5$/mu, "TIMEOUT=30"),
    "no IPv6 probe": (s) => s.replaceAll(IPV6_LITERAL, "192.0.2.1"),
    "no direct DNS probe": (s) =>
      s.replaceAll("/dev/udp/9.9.9.9/53", "/dev/udp/192.0.2.1/53"),
    "no positive DNS probe": (s) =>
      s.replaceAll("getent hosts github.com", "true"),
    "no mount check": (s) => s.replaceAll("nsenter -t 1 -m", "true"),
  };
  it.each(Object.keys(mutations))("BR-230 rejects %s", (name) => {
    const source = probe();
    const mutated = mutations[name]?.(source) ?? source;
    expect(mutated).not.toBe(source);
    expect(() => {
      validateProbe(mutated);
    }).toThrow();
  });

  function probeFixture(tcp: string) {
    const root = temp("kdrive-probe-");
    const bin = join(root, "bin");
    stub(bin, "timeout", [
      'case "$2" in getent) shift; exec "$@" ;; esac',
      `exit ${tcp}`,
    ]);
    stub(bin, "getent", [
      'case "$1 $2" in',
      '  "hosts github.com") echo "192.0.2.10 github.com" ;;',
      '  "ahostsv6 github.com") echo "::ffff:192.0.2.10 STREAM github.com" ;;',
      "  *) exit 2 ;;",
      "esac",
    ]);
    stub(bin, "curl", ["printf 200"]);
    const run = (env: Record<string, string>) =>
      spawnSync("/bin/bash", [join(OPS, "probe.sh"), "network", "container"], {
        env: { PATH: `${bin}:/usr/bin:/bin`, ...env },
        encoding: "utf8",
      });
    return { run };
  }
  const LAN = "198.51.100.77:8443";
  const HOST = "203.0.113.9:443";
  it("BR-230 masks the inputs first and passes when every negative probe is refused", () => {
    const result = probeFixture("1").run({
      LAN_TARGET: LAN,
      HOST_TARGET: HOST,
    });
    const lines = result.stdout.trim().split("\n");
    expect(lines.slice(0, 4)).toEqual([
      `::add-mask::${LAN}`,
      "::add-mask::198.51.100.77",
      `::add-mask::${HOST}`,
      "::add-mask::203.0.113.9",
    ]);
    const results = lines.filter((line) => /^(PASS|FAIL) /u.test(line));
    expect(results.length).toBeGreaterThan(20);
    expect(results.every((line) => line.startsWith("PASS "))).toBe(true);
    for (const line of results) {
      expect(line).toMatch(/^PASS [a-z0-9-]+$/u);
      expect(line.includes(".") || line.includes(":")).toBe(false);
    }
    expect(results).toContain("PASS container-lan-target");
    expect(results).toContain("PASS container-host-target");
    expect(results).toContain("PASS container-dns-github");
    expect(result.status).toBe(0);
  });
  it("BR-230 fails when a negative probe connects", () => {
    const result = probeFixture("0").run({});
    expect(result.stdout).toMatch(/^FAIL container-gateway-tcp-47999$/mu);
    expect(result.status).not.toBe(0);
  });
});

describe("BR-231 reset sentinels", () => {
  it("BR-231 reset-mark leaves and reset-check looks for every sentinel", () => {
    const source = ops("probe.sh");
    const mark = block(source, /^reset_mark\(\) \{$/mu);
    const checkBody = block(source, /^reset_check\(\) \{$/mu);
    for (const body of [mark, checkBody]) {
      expect(body).toContain("/var/lib");
      expect(body).toContain('"$SENTINEL"');
    }
    expect(source).toMatch(/^SENTINEL=kdrive-reset-sentinel$/mu);
    expect(mark).toContain('docker volume create "$SENTINEL"');
    expect(mark).toContain(
      'docker tag kdrive-ci-runner:local "$SENTINEL:local"',
    );
    expect(mark).toContain('docker run --detach --name "$SENTINEL"');
    expect(mark).toContain('touch "$(dirname "$GITHUB_WORKSPACE")/$SENTINEL"');
    expect(mark).toContain('touch "$RUNNER_TEMP/$SENTINEL"');
    expect(checkBody).toContain('test -e "$RUNNER_TEMP/$SENTINEL"');
    expect(checkBody).not.toContain('ls -A "$RUNNER_TEMP"');
    expect(checkBody).toContain('docker volume inspect "$SENTINEL"');
    expect(checkBody).toContain('docker image inspect "$SENTINEL:local"');
    expect(checkBody).toContain('docker container inspect "$SENTINEL"');
    expect(checkBody.indexOf('test -e "$RUNNER_TEMP/$SENTINEL"')).toBeLessThan(
      checkBody.indexOf("docker"),
    );
  });

  function resetFixture(dockerFinds: string) {
    const root = temp("kdrive-reset-");
    const bin = join(root, "bin");
    stub(bin, "docker", [
      'printf "%s\\n" "$*" >> "$FAKE_ROOT/docker-calls"',
      'case "$*" in *inspect*) exit "$FAKE_FOUND" ;; *"test ! -e"*) test "$FAKE_FOUND" != 0 ;; esac',
    ]);
    const parent = join(root, "work/kdrive-mcp-server");
    const workspace = join(parent, "kdrive-mcp-server");
    mkdirSync(workspace, { recursive: true });
    const runnerTemp = join(root, "work/_temp");
    mkdirSync(runnerTemp, { recursive: true });
    const run = (mode: string) =>
      spawnSync("/bin/bash", [join(OPS, "probe.sh"), mode], {
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          FAKE_ROOT: root,
          FAKE_FOUND: dockerFinds,
          GITHUB_WORKSPACE: workspace,
          RUNNER_TEMP: runnerTemp,
        },
        encoding: "utf8",
      });
    return { root, parent, runnerTemp, run };
  }
  it("BR-231 reset-check passes on a clean runner", () => {
    const f = resetFixture("1");
    const result = f.run("reset-check");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
  it.each(["docker object", "workspace parent entry", "runner temp entry"])(
    "BR-231 reset-check fails on a leftover %s",
    (variant) => {
      const f = resetFixture(variant === "docker object" ? "0" : "1");
      if (variant === "workspace parent entry")
        writeFileSync(join(f.parent, "kdrive-reset-sentinel"), "");
      if (variant === "runner temp entry")
        writeFileSync(join(f.runnerTemp, "kdrive-reset-sentinel"), "");
      expect(f.run("reset-check").status).not.toBe(0);
    },
  );
  it("BR-231 reset-mark creates the workspace-parent sentinel", () => {
    const f = resetFixture("1");
    expect(f.run("reset-mark").status).toBe(0);
    expect(existsSync(join(f.parent, "kdrive-reset-sentinel"))).toBe(true);
  });
  it("BR-231 v2 reset-check ignores runner-owned RUNNER_TEMP entries", () => {
    const f = resetFixture("1");
    writeFileSync(join(f.runnerTemp, "step-script.sh"), "");
    mkdirSync(join(f.runnerTemp, "_runner_file_commands"));
    expect(f.run("reset-check").status).toBe(0);
  });
  it("BR-231 v2 reset-mark creates the RUNNER_TEMP sentinel", () => {
    const f = resetFixture("1");
    expect(f.run("reset-mark").status).toBe(0);
    expect(existsSync(join(f.runnerTemp, "kdrive-reset-sentinel"))).toBe(true);
  });
});

// ---------------------------------------------------------------- BR-232
describe("BR-232 docs/self-hosted-runner.md", () => {
  const guide = () => text("docs/self-hosted-runner.md");
  const SECTIONS = [
    "Prerequisites",
    "Installation",
    "Host user and egress rules",
    "Runner credential",
    "Golden disk",
    "Service",
    "Repository settings and merge criterion",
    "Acceptance",
    "Secrets exposure",
    "Updating",
    "Rollback",
  ];
  it("BR-232 has the eleven sections in order", () => {
    const headings = guide()
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3));
    expect(headings).toEqual(SECTIONS);
  });
  it("BR-232 names every ops/runner file", () => {
    for (const name of OPS_FILES)
      expect(guide()).toContain(`ops/runner/${name}`);
  });
  it("BR-232 states the merge criterion and never claims enforced checks", () => {
    const source = guide();
    const section = source.slice(
      source.indexOf("## Repository settings and merge criterion"),
      source.indexOf("## Acceptance"),
    );
    expect(section).toContain("`ci-result`");
    expect(section).toContain("`fork-refusal`");
    expect(section).toContain("Run workflows from fork pull requests");
    expect(source).not.toMatch(
      /(required checks|branch protection) (are|is) (now )?(enabled|enforced|active)/iu,
    );
  });
  it("BR-232 records the pinned Lima release and its SHA-256", () => {
    const source = guide();
    const install = ops("install.sh");
    const version = /^LIMA_VERSION=(\S+)$/mu.exec(install)?.[1] ?? "missing";
    const digest =
      /^LIMA_SHA256=([0-9a-f]{64})$/mu.exec(install)?.[1] ?? "missing";
    expect(source).toContain(version);
    expect(source).toContain(digest);
  });
});

// ---------------------------------------------------------------- BR-233
const INSTALL_TOKEN = "synthetic-install-token-value-not-a-secret";
const CHANGING_PREFIXES = [
  "useradd",
  "usermod",
  "userdel",
  "sudo",
  "curl",
  "qemu-img",
  "systemctl enable",
  "systemctl start",
  "systemctl restart",
  "systemctl stop",
  "systemctl disable",
  "systemctl daemon-reload",
  "nft -f",
  "nft delete",
  "nft add",
  "nft flush",
  "limactl create",
  "limactl start",
  "limactl stop",
  "limactl delete",
  "limactl copy",
  "limactl shell",
];
function isChanging(line: string): boolean {
  return (
    line === "host-setup.sh " ||
    line.includes("token-store") ||
    CHANGING_PREFIXES.some((prefix) => line.startsWith(prefix))
  );
}

function installFixture() {
  const root = temp("kdrive-install-");
  const src = join(root, "src/ops/runner");
  mkdirSync(src, { recursive: true });
  for (const name of OPS_FILES) copyFileSync(join(OPS, name), join(src, name));
  for (const name of ["install.sh", "supervise.sh"])
    chmodSync(join(src, name), 0o755);
  const log = join(root, "calls");
  const record = 'printf "%s\\n" "$(basename "$0") $*" >> "$FAKE_LOG"';
  const state = join(root, "state");
  mkdirSync(state);
  writeFileSync(join(root, "dev-kvm"), "");
  mkdirSync(join(root, "dev"));
  writeFileSync(join(root, "dev/kvm"), "");
  stub(src, "host-setup.sh", [
    'if test "${1:-}" = --check; then printf "%s\\n" "host-setup.sh --check" >> "$FAKE_LOG"; test -f "$FAKE_ROOT/state/host-setup"; exit; fi',
    record,
    'mkdir -p "$FAKE_ROOT/etc/kdrive-runner" "$FAKE_ROOT/etc/systemd/system"',
    'echo conf > "$FAKE_ROOT/etc/kdrive-runner/nftables.conf"',
    'echo sets > "$FAKE_ROOT/etc/kdrive-runner/nft-sets.conf"',
    'echo unit > "$FAKE_ROOT/etc/systemd/system/kdrive-ci-runner.service"',
    'echo unit > "$FAKE_ROOT/etc/systemd/system/kdrive-runner-nft.service"',
    ': > "$FAKE_ROOT/state/host-setup"',
    "systemctl daemon-reload",
    "systemctl restart kdrive-runner-nft.service",
  ]);
  stub(src, "egress-selftest.sh", [record, 'exit "${FAKE_SELFTEST:-0}"']);
  stub(join(root, "opt/kdrive-runner/lima/bin"), "limactl", [
    'if test -z "$FAKE_AS_USER"; then echo "limactl: must not run as the root user" >&2; exit 1; fi',
    'if test "$1" = --version; then echo "limactl version ${FAKE_LIMA_VERSION:-2.2.1}"; exit 0; fi',
    record,
    'case "$1" in',
    '  create) mkdir -p "$HOME/.lima/kdrive-ci" && : > "$HOME/.lima/kdrive-ci/disk" ;;',
    '  delete) rm -rf "$HOME/.lima/kdrive-ci" ;;',
    "esac",
  ]);
  const bin = join(root, "bin");
  stub(bin, "uname", ['echo "${FAKE_ARCH:-x86_64}"']);
  stub(bin, "nft", [
    record,
    'case "$*" in "list table inet kdrive_runner") test -f "$FAKE_ROOT/state/active-kdrive-runner-nft.service" ;; esac',
  ]);
  stub(bin, "id", [
    'if test -n "${FAKE_AS_USER:-}"; then exec /usr/bin/id "$@"; fi',
    'case "$*" in',
    '  "-u") echo "${FAKE_UID:-0}" ;;',
    '  "-u kdrive-runner"|"kdrive-runner") test -f "$FAKE_ROOT/state/host-setup" && echo 1001 ;;',
    '  "-nG kdrive-runner") test -f "$FAKE_ROOT/state/host-setup" && echo "kdrive-runner kvm" ;;',
    "  *) exit 1 ;;",
    "esac",
  ]);
  stub(bin, "useradd", [record]);
  stub(bin, "usermod", [record]);
  stub(bin, "userdel", [record]);
  stub(bin, "sudo", [record]);
  stub(bin, "curl", [
    record,
    'out=/dev/null; prev=; for a in "$@"; do test "$prev" = --output && out=$a; prev=$a; done',
    'printf "not a release" > "$out"',
  ]);
  stub(bin, "qemu-img", [
    record,
    'for last in "$@"; do :; done',
    ': > "$last"',
  ]);
  stub(bin, "systemctl", [
    record,
    's="$FAKE_ROOT/state"',
    'case "$1" in',
    '  is-enabled) test -f "$s/enabled-$2" ;;',
    '  is-active) test -f "$s/active-$2" ;;',
    '  enable) : > "$s/enabled-$2" ;;',
    '  start|restart) : > "$s/active-$2" ;;',
    '  stop) rm -f "$s/active-$2" ;;',
    '  disable) rm -f "$s/enabled-$2" ;;',
    "esac",
  ]);
  const home = join(root, "home/kdrive-runner");
  mkdirSync(home, { recursive: true });
  stub(bin, "runuser", [
    'printf "%s\\n" "runuser $*" >> "$FAKE_LOG"',
    'while test "$#" -gt 0 && test "$1" != --; do shift; done',
    "shift",
    'HOME="$FAKE_HOME" FAKE_AS_USER=1 exec "$@"',
  ]);
  const tokenPath = join(root, "token-source");
  writeFileSync(tokenPath, `${INSTALL_TOKEN}\n`, { mode: 0o600 });
  const storedToken = join(home, ".config/kdrive-runner/github-token");
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(join(src, "install.sh"), args, {
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        FAKE_LOG: log,
        FAKE_ROOT: root,
        FAKE_HOME: home,
        KDRIVE_RUNNER_TEST_ROOT: root,
        ...env,
      },
      encoding: "utf8",
    });
  const calls = () => logLines(log);
  const changing = (from = 0) =>
    calls()
      .slice(from)
      .filter((line) => isChanging(line));
  const snapshot = () =>
    readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter(
        (entry) => !entry.startsWith("calls") && !entry.startsWith("state"),
      )
      .sort()
      .map((entry) => {
        const path = join(root, entry);
        const info = lstatSync(path);
        return `${entry} ${info.mode.toString(8)} ${info.isFile() ? read(path) : ""}`;
      })
      .join("\n");
  return {
    root,
    src,
    bin,
    home,
    tokenPath,
    storedToken,
    run,
    calls,
    changing,
    snapshot,
  };
}
type InstallResult = SpawnSyncReturns<string>;
function noToken(result: InstallResult, calls: string[]): void {
  expect(result.stdout + result.stderr).not.toContain(INSTALL_TOKEN);
  expect(calls.join("\n")).not.toContain(INSTALL_TOKEN);
}

describe("BR-233 install.sh", () => {
  const refusals: [
    string,
    string[],
    Record<string, string>,
    (root: string) => void,
    RegExp,
  ][] = [
    [
      "aarch64",
      ["--check"],
      { FAKE_ARCH: "aarch64" },
      () => undefined,
      /not x86_64/u,
    ],
    [
      "no /dev/kvm",
      ["--check"],
      {},
      (root) => {
        rmSync(join(root, "dev/kvm"));
      },
      /\/dev\/kvm is missing/u,
    ],
    [
      "no nft",
      ["--check"],
      {},
      (root) => {
        rmSync(join(root, "bin/nft"));
      },
      /nft is missing/u,
    ],
    [
      "non-root",
      ["--check"],
      { FAKE_UID: "1000" },
      () => undefined,
      /run as root/u,
    ],
    ["no argument", [], {}, () => undefined, /usage/u],
    ["an unknown argument", ["--force"], {}, () => undefined, /usage/u],
    ["two modes", ["--check", "--uninstall"], {}, () => undefined, /usage/u],
    [
      "a token as an argument value",
      ["--token", INSTALL_TOKEN],
      {},
      () => undefined,
      /usage/u,
    ],
    [
      "a token as an extra value",
      ["--token-file", "TOKEN_PATH", INSTALL_TOKEN],
      {},
      () => undefined,
      /usage/u,
    ],
    [
      "a missing token file",
      ["--token-file", "MISSING"],
      {},
      () => undefined,
      /regular file/u,
    ],
    [
      "a symlink token file",
      ["--token-file", "SYMLINK"],
      {},
      (root) => {
        symlinkSync(join(root, "token-source"), join(root, "token-link"));
      },
      /regular file/u,
    ],
    [
      "a directory token file",
      ["--token-file", "DIRECTORY"],
      {},
      (root) => {
        mkdirSync(join(root, "token-dir"));
      },
      /regular file/u,
    ],
  ];
  it.each(refusals.map((entry) => entry[0]))(
    "BR-233 refuses %s with a fixed message and no changing call",
    (name) => {
      const entry = refusals.find((candidate) => candidate[0] === name)!;
      const [, rawArgs, env, prepare, message] = entry;
      const f = installFixture();
      prepare(f.root);
      const args = rawArgs.map((arg) =>
        arg === "TOKEN_PATH"
          ? f.tokenPath
          : arg === "MISSING"
            ? join(f.root, "missing")
            : arg === "SYMLINK"
              ? join(f.root, "token-link")
              : arg === "DIRECTORY"
                ? join(f.root, "token-dir")
                : arg,
      );
      const result = f.run(args, env);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(message);
      expect(result.stderr.split("\n").filter(Boolean)).toHaveLength(1);
      expect(f.calls()).toEqual([]);
      noToken(result, f.calls());
    },
  );

  it("BR-233 installs in order: host-setup, egress unit, self-test, golden, runner service", () => {
    const f = installFixture();
    const result = f.run(["--token-file", f.tokenPath]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const calls = f.calls();
    const index = (pattern: RegExp) =>
      calls.findIndex((line) => pattern.test(line));
    const order = [
      index(/^host-setup\.sh $/u),
      index(/^systemctl restart kdrive-runner-nft\.service$/u),
      index(/^systemctl (start|enable) kdrive-runner-nft\.service$/u),
      index(/^runuser -u kdrive-runner -- .*supervise\.sh golden$/u),
      index(/^egress-selftest\.sh/u),
      index(/^limactl start/u),
      index(/^systemctl start kdrive-ci-runner\.service$/u),
    ];
    expect(order.every((value) => value >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(calls).toContain("systemctl enable kdrive-runner-nft.service");
    expect(calls).toContain("systemctl enable kdrive-ci-runner.service");
    expect(read(f.storedToken)).toBe(`${INSTALL_TOKEN}\n`);
    expect(statSync(f.storedToken).mode & 0o777).toBe(0o600);
    expect(
      calls.some((line) =>
        /^runuser -u kdrive-runner -- sh -c # token-store/u.test(line),
      ),
    ).toBe(true);
    expect(read(join(f.root, "opt/kdrive-runner/ops/supervise.sh"))).toBe(
      ops("supervise.sh"),
    );
    noToken(result, calls);
  });

  it("BR-233 a second install changes nothing and says so", () => {
    const f = installFixture();
    expect(f.run(["--token-file", f.tokenPath]).status).toBe(0);
    const before = f.snapshot();
    const count = f.calls().length;
    const second = f.run(["--token-file", f.tokenPath]);
    expect(second.status).toBe(0);
    expect(second.stdout).toBe(
      "kdrive-runner install: already installed, no change\n",
    );
    expect(f.changing(count)).toEqual([]);
    expect(f.snapshot()).toBe(before);
    noToken(second, f.calls());
  });

  it("BR-233 a different token rotates the stored one through runuser", () => {
    const f = installFixture();
    expect(f.run(["--token-file", f.tokenPath]).status).toBe(0);
    const rotated = `${INSTALL_TOKEN}-rotated`;
    writeFileSync(f.tokenPath, `${rotated}\n`);
    const count = f.calls().length;
    const result = f.run(["--token-file", f.tokenPath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("kdrive-runner install: token rotated\n");
    expect(read(f.storedToken)).toBe(`${rotated}\n`);
    expect(
      f.changing(count).every((line) => line.includes("token-store")),
    ).toBe(true);
    expect(result.stdout + result.stderr).not.toContain(rotated);
  });

  it("BR-233 a symlink at the stored token path is refused and nothing is written", () => {
    const f = installFixture();
    mkdirSync(join(f.home, ".config/kdrive-runner"), { recursive: true });
    const target = join(f.root, "elsewhere");
    writeFileSync(target, "untouched");
    symlinkSync(target, f.storedToken);
    const result = f.run(["--token-file", f.tokenPath]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/symlink/u);
    expect(read(target)).toBe("untouched");
    expect(lstatSync(f.storedToken).isSymbolicLink()).toBe(true);
    expect(f.calls().some((line) => line.startsWith("limactl"))).toBe(false);
    noToken(result, f.calls());
  });

  it("BR-233 a self-test that connects stops golden before limactl start", () => {
    const f = installFixture();
    const result = f.run(["--token-file", f.tokenPath], { FAKE_SELFTEST: "1" });
    expect(result.status).not.toBe(0);
    expect(f.calls().some((line) => line.startsWith("limactl start"))).toBe(
      false,
    );
    expect(f.calls()).not.toContain("systemctl start kdrive-ci-runner.service");
  });

  it("BR-233 refuses a Lima download whose SHA-256 differs", () => {
    const f = installFixture();
    rmSync(join(f.root, "opt/kdrive-runner/lima"), { recursive: true });
    const result = f.run(["--token-file", f.tokenPath]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/SHA-256/u);
    expect(existsSync(join(f.root, "opt/kdrive-runner/lima"))).toBe(false);
  });

  it("BR-233 --check changes nothing, fails before install and passes after", () => {
    const f = installFixture();
    const fresh = f.run(["--check"]);
    expect(fresh.status).not.toBe(0);
    expect(f.changing()).toEqual([]);
    expect(f.run(["--token-file", f.tokenPath]).status).toBe(0);
    const before = f.snapshot();
    const count = f.calls().length;
    const installed = f.run(["--check"]);
    expect(installed.stderr).toBe("");
    expect(installed.status).toBe(0);
    expect(f.changing(count)).toEqual([]);
    expect(f.snapshot()).toBe(before);
    chmodSync(f.storedToken, 0o644);
    expect(f.run(["--check"]).status).not.toBe(0);
  });

  it("BR-233 --uninstall removes only what install created and keeps the user and the token", () => {
    const f = installFixture();
    expect(f.run(["--token-file", f.tokenPath]).status).toBe(0);
    writeFileSync(
      join(f.root, "etc/kdrive-runner/extra-internal.conf"),
      "203.0.113.0/24\n",
    );
    const count = f.calls().length;
    const result = f.run(["--uninstall"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/[Rr]evoke the runner token/u);
    const calls = f.calls().slice(count);
    const stop = calls.indexOf("systemctl stop kdrive-ci-runner.service");
    expect(stop).toBeGreaterThanOrEqual(0);
    expect(calls.slice(0, stop).filter((line) => isChanging(line))).toEqual([]);
    for (const line of calls) {
      expect(line).not.toMatch(/^(userdel|sudo)/u);
      if (line.startsWith("systemctl ") && line !== "systemctl daemon-reload")
        expect(line).toMatch(
          / (kdrive-ci-runner|kdrive-runner-nft)\.service$/u,
        );
    }
    expect(read(f.storedToken)).toBe(`${INSTALL_TOKEN}\n`);
    expect(read(f.tokenPath)).toBe(`${INSTALL_TOKEN}\n`);
    expect(existsSync(f.home)).toBe(true);
    expect(read(join(f.root, "etc/kdrive-runner/extra-internal.conf"))).toBe(
      "203.0.113.0/24\n",
    );
    for (const gone of [
      "etc/kdrive-runner/nftables.conf",
      "etc/kdrive-runner/nft-sets.conf",
      "etc/systemd/system/kdrive-ci-runner.service",
      "etc/systemd/system/kdrive-runner-nft.service",
      "opt/kdrive-runner",
      "home/kdrive-runner/.lima/kdrive-ci",
      "home/kdrive-runner/.local/share/kdrive-runner/golden.qcow2",
    ])
      expect(existsSync(join(f.root, gone)), gone).toBe(false);
    expect(calls).toContain("nft delete table inet kdrive_runner");
    noToken(result, f.calls());
  });
});
