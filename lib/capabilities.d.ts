/**
 * Runtime capability guard.
 *
 * Kept in its own module with no `@deepseek-ai/*` imports so it is directly
 * unit-testable, and so the check can run before anything else in `apply`.
 *
 * WHY THIS EXISTS: `peerDependencies` warn at install time and do nothing at
 * run time. DSH core is a release candidate (`0.1.5-rc.1` when this was
 * written), so the contract — not the version string — is what must be
 * verified. A silent partial load is the one outcome that must never happen: it
 * would leave a deployment believing titles work while nothing was registered.
 */
/** The methods this plugin calls on the title service. */
export declare const REQUIRED_TITLE_METHODS: readonly string[];
/** Minimal shape the guard inspects. */
export interface CapabilitySurface {
    readonly sessionTitle?: unknown;
    readonly llm?: unknown;
    readonly settings?: unknown;
}
/**
 * Collect the missing required methods.
 *
 * @param surface - the services `apply` received.
 * @returns one `ctx.<service>.<method>` label per missing method.
 */
export declare function findMissingCapabilities(surface: CapabilitySurface): string[];
/**
 * Fail loudly when this DSH core does not expose the API the plugin needs.
 *
 * Deliberately does NOT compare version strings: a patch release may still be
 * compatible, and a minor release may break a contract without changing its
 * string.
 *
 * @param surface - the services `apply` received.
 * @throws {Error} naming every missing method.
 */
export declare function assertTitleCapabilities(surface: CapabilitySurface): void;
