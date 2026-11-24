import type { MemoryNode } from './types.js';
export interface CandidateInput {
    text: string;
    confidence: number;
    source_ids: string[];
    run_id: string;
    task_id?: string | null;
}
export interface CandidateReview {
    expected_fingerprint: string;
    decision: 'accept' | 'reject';
    reviewer: string;
    note: string;
    evidence: string[];
}
export interface CandidateMeta {
    version: 1;
    fingerprint: string;
    state: 'pending' | 'accepted' | 'rejected';
    sources: Record<string, string>;
    review?: {
        request: CandidateReview;
        digests: Record<string, string>;
        at: number;
    };
}
export declare const digest: (v: unknown) => string;
export declare const eventDigest: (n: MemoryNode) => string;
export declare const claimDigest: (n: Pick<MemoryNode, "text" | "confidence" | "run_id" | "task_id" | "based_on">, sources: Record<string, string>) => string;
export declare function candidateMeta(n: MemoryNode): CandidateMeta | null;
export declare function referenceIds(value: unknown, label: string, opts?: {
    allowEmpty?: boolean;
}): string[];
export declare function validateEvent(n: MemoryNode | null, run: string, task: string | null, label: string): MemoryNode;
export declare function candidateReason(n: MemoryNode, get: (id: string) => MemoryNode | null): string | null;
