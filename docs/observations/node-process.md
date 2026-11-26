# Node process observations

Runtime-specific measurements supplied for process and stdio lifecycle work
(F-054, ticket #139). These are observations of Node v26.13.0 in the dev
container, not guarantees for other versions. They were not rerun by the spec
author.

## Closed stderr pipe without an error listener

- Date: 2026-11-25.
- Method: write to process.stderr on Node v26.13.0 with stderr connected to a
  pipe whose reader was destroyed, with no stderr `error` listener; pass a
  callback to `process.stderr.write(data, cb)`.
- Result: write returns normally, then an asynchronous EPIPE `error` event is
  uncaught and the process exits 1. The write callback does not prevent this.
- Evidence: [Earlier stderr/close probes](https://github.com/sstolz/kdrive-mcp-server/issues/139#issuecomment-7156888846).

## Closed stderr pipe with one error listener

- Date: 2026-11-25.
- Method: the same broken stderr pipe, with one `error` listener installed;
  attempt later writes as well.
- Result: every later write emits an EPIPE `error` event to the listener; the
  process keeps running and exits 0.
- Evidence: [Earlier stderr/close probes](https://github.com/sstolz/kdrive-mcp-server/issues/139#issuecomment-7156888846).

## Unhandled close rejection

- Date: 2026-11-25.
- Method: on Node v26.13.0 in its default unhandled-rejections mode, invoke an
  async function that rejects through `void close().then(exit0)`, without a
  rejection handler.
- Result: Node prints the rejection's stack trace to stderr and exits 1.
- Evidence: [Earlier stderr/close probes](https://github.com/sstolz/kdrive-mcp-server/issues/139#issuecomment-7156888846).

## Closed stdout pipe with and without an error listener

- Date: 2026-11-25.
- Method: on Node v26.13.0 in the dev container, use a child process whose
  stdout is a pipe; the parent pauses its reader, then destroys it. Compare
  child writes without an `error` listener and with one listener installed.
  Run each case once.
- Result: in the single run without a listener, the write returns, an
  asynchronous EPIPE `error` is uncaught and the child exits 1. In the single
  run with one listener, EPIPE is delivered to it, the child survives and exits 0. This matches the stderr observations above.
- Evidence: [139-probe-1-orchestrator](https://github.com/sstolz/kdrive-mcp-server/issues/139#issuecomment-7157090270), repeat counts in its [amendment](https://github.com/sstolz/kdrive-mcp-server/issues/139#issuecomment-7157327883).

## Pending stdout write after transport-style close

- Date: 2026-11-25.
- Method: on Node v26.13.0 in the dev container, use a child with piped stdout
  and a parent that pauses its reader. Attach an `error` listener and start a
  1 MiB write: write returns false and writableLength is 1048576. Mirror
  `src/stdio-transport.ts` close by calling
  `process.stdout.off("error", listener)` then `process.stdout.destroy()`.
  Have the parent destroy its reader afterwards. Repeat three times.
- Result: three of three runs were identical. After destroy(),
  process.stdout.destroyed remains false: destroy does not destroy this process
  stream. When the reader disappears, the pending write callback receives
  EPIPE, but the asynchronous error remains uncaught and the child exits 1.
  Removing the transport listener therefore leaves pending stdout errors
  uncontained after transport close, including while the mutation gate drains
  before production exit flushing installs its listener.
- Evidence: [139-probe-1-orchestrator](https://github.com/sstolz/kdrive-mcp-server/issues/139#issuecomment-7157090270), repeat counts in its [amendment](https://github.com/sstolz/kdrive-mcp-server/issues/139#issuecomment-7157327883).

## Pending stdout write with a remaining owner listener

- Date: 2026-11-25.
- Method: on Node v26.13.0 in the dev container, use real process.stdout in a
  child with a paused parent pipe reader and a 1 MiB pending write. Attach
  separate transport and owner `error` listeners, then call
  `process.stdout.off("error", transportListener)` and
  `process.stdout.destroy()`, leaving the owner attached. After that close,
  (a) destroy the parent reader or (b) resume it. Run each case three times.
- Result: (a) 3/3 runs: the write callback reports EPIPE, the owner listener
  receives EPIPE, the process survives and exits 0. (b) 3/3 runs: the write
  callback reports no error, all 1048576 bytes arrive and the process exits 0.
  A remaining owner contains the broken-reader error after transport-style
  close, while a healthy slow reader does not produce a callback failure.
- Evidence: [139-probe-2-orchestrator](https://github.com/sstolz/kdrive-mcp-server/issues/139#issuecomment-7157477735).

## Setup-dependent stdout pending threshold

- Date: 2026-11-25.
- Method: in the same child/paused-parent stdout setup, compare writes of
  131072 and 262144 bytes, one run per size, observing the write return value
  and writableLength.
- Result: 131072 bytes did not stay pending: write returned true. With
  262144 bytes, write returned false and writableLength was 262144. This is
  setup-dependent because the paused parent stream buffers; it does not
  establish a general pipe-capacity threshold. A test using a 262144-byte
  encoded frame must assert that write returned false and writableLength is
  positive before acknowledging readiness, failing loudly otherwise.
- Evidence: [139-probe-2-orchestrator](https://github.com/sstolz/kdrive-mcp-server/issues/139#issuecomment-7157477735).
