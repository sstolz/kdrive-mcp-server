// F-048: synthetic API evidence and the exact BR-435 v1 wire contract.
import { kdriveFixture, type Node } from "./kdrive.js";

export const warningNodes: Node[] = [
  { id: 10, parent: 1, type: "dir", name: "Private" },
  { id: 42, parent: 10, type: "dir", name: "Documents" },
  { id: 43, parent: 42, type: "file", name: "SYNTHETIC_NAME_CANARY" },
];
export const warningFixture = () =>
  kdriveFixture({ nodes: warningNodes, drives: [{ id: 7, role: "admin" }] });
export const warningEnvironment = (deny = "/Documents/Confidential/**") => ({
  KDRIVE_ID: "7",
  KDRIVE_TOKEN: "SYNTHETIC_CREDENTIAL_CANARY",
  KDRIVE_MCP_ROOTS: "7:/Private/Documents",
  KDRIVE_MCP_DENY: deny,
});
export const warningEvent = (pattern_index: number) => ({
  event: "deny_pattern_root_warning",
  level: "warn",
  setting: "deny",
  pattern_index,
  reason: "outside_configured_roots",
});
export const warningLine = (index: number) =>
  `${JSON.stringify(warningEvent(index))}\n`;

export type DiagnosticPath = Readonly<{
  driveId: number;
  folderId: number;
  path: string | null;
}>;
export const rootPaths = (...paths: (string | null)[]): DiagnosticPath[] =>
  paths.map((path, index) => ({ driveId: 7, folderId: 42 + index, path }));
