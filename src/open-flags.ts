/** Linux O_CLOEXEC; Node does not export it, and libuv also sets it on open. */
export function closeOnExecFlag(
  platform: NodeJS.Platform = process.platform,
): number {
  return platform === "linux" ? 0o2000000 : 0;
}
