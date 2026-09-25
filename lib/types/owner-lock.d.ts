type Release = () => Promise<void>;
/**
 * Hold a kernel lock while preserving the legacy owner.lock barrier for older plugin processes.
 * A dead legacy PID can be adopted under the kernel lock; a live or unverifiable owner is refused.
 * @param stateRoot - canonical private `.paper-review` directory.
 * @returns Cleanup that removes this instance's legacy barrier and releases the kernel lock.
 */
export declare function acquireOwnerLock(stateRoot: string): Promise<Release>;
export {};
//# sourceMappingURL=owner-lock.d.ts.map