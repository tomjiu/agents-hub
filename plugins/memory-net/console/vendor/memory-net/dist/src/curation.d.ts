/** Read-only recall policy. It does not promote, mutate or delete stored evidence. */
import type { ActivateOpts, MemoryNode } from './types.js';
export declare function contextReason(n: MemoryNode, opts: ActivateOpts): string | null;
/** NFKC literal tokens, ASCII word boundaries; not embeddings or semantic matching. */
export declare function curatedMatch(query: string, n: MemoryNode): boolean;
export declare function curationReason(n: MemoryNode, query: string, opts: ActivateOpts): string | null;
