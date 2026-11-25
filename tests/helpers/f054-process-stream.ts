import { FlushPort, type FlushCallback } from "./f039-composition.js";

/** Mirrors measured process.stdout: destroy leaves pending callbacks and the stream alive. */
export class ProcessOutput extends FlushPort {
  readonly frames: string[] = [];
  readonly frameCallbacks: FlushCallback[] = [];
  writableLength = 0;
  closes = 0;
  holdFrames = false;
  override write(text: string, callback?: FlushCallback): boolean {
    if (!text) return super.write(text, callback);
    this.frames.push(text);
    if (this.holdFrames) {
      this.writableLength = Buffer.byteLength(text);
      if (callback) this.frameCallbacks.push(callback);
      return false;
    }
    this.emit("data", Buffer.from(text));
    callback?.();
    return true;
  }
  destroy() { this.closes++; return this; }
}
