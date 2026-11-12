import type { ChildProcess } from "node:child_process";
export function killGroup(child: ChildProcess) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ESRCH"
    )
      throw error;
  }
}
export async function withinDeadline<T>(
  duration: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 900_000)
    throw new Error("Invalid or expired analysis deadline");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Analysis deadline exceeded"));
      }, duration);
    });
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}
