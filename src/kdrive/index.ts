/** F-014: the production kDrive read adapter (read calls only). */
export {
  createKdriveAdapter,
  derivedETag,
  type KdriveAdapter,
  type KdriveAdapterOptions,
} from "./adapter.js";
export type {
  Connect,
  ConnectOptions,
  Lookup,
  LookupAddress,
  RequestObserver,
  UnavailableClass,
} from "./transport.js";
