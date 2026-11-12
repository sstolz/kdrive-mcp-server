/** The foundation's only data-access dependency; production adaptation is deferred. */
export type MetadataAdapter = (
  driveId: number,
  fileId: number,
) => Promise<unknown>;

export interface DriveClient {
  readonly driveId: number;
  info(fileId: number): Promise<unknown>;
}

function validateId(id: number, kind: string): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new RangeError(`${kind} ID must be a positive safe integer.`);
  }
}

export function createDriveClient(
  driveId: number,
  adapter: MetadataAdapter,
): DriveClient {
  validateId(driveId, "Drive");
  return Object.freeze({
    driveId,
    async info(fileId: number): Promise<unknown> {
      validateId(fileId, "File");
      return adapter(driveId, fileId);
    },
  });
}
