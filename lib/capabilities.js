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
export const REQUIRED_TITLE_METHODS = ["register", "refresh", "get", "rename"];
/**
 * Collect the missing required methods.
 *
 * @param surface - the services `apply` received.
 * @returns one `ctx.<service>.<method>` label per missing method.
 */
export function findMissingCapabilities(surface) {
    const missing = [];
    const title = surface.sessionTitle;
    const llm = surface.llm;
    for (const method of REQUIRED_TITLE_METHODS) {
        if (typeof title?.[method] !== "function")
            missing.push(`ctx.sessionTitle.${method}`);
    }
    if (typeof llm?.stream !== "function")
        missing.push("ctx.llm.stream");
    if (typeof surface.settings?.register !== "function")
        missing.push("ctx.settings.register");
    return missing;
}
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
export function assertTitleCapabilities(surface) {
    const missing = findMissingCapabilities(surface);
    if (missing.length === 0)
        return;
    throw new Error(`smart-session-title: this DSH core does not expose the required API: ${missing.join(", ")}. ` +
        "The plugin cannot generate titles and refuses to load partially; " +
        "disable the smart-session-title row to boot without it.");
}
