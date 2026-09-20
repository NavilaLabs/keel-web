import type { MiddlewareHandler } from 'hono'

/**
 * Refuses a request that did not come from this machine's own name.
 *
 * ADR 0009 made the loopback binding the access control, and that holds for
 * anything speaking IP. It does not hold for the browser: a page on the
 * public internet can point a domain it owns at 127.0.0.1, and the browser
 * will then send its request to this server with that domain in `Host`. The
 * binding sees a local connection and the request reads whatever it asks for.
 *
 * Closing it is one comparison, and it is the same one Vite, Jupyter and
 * Storybook make.
 */

/**
 * Passes a request whose `Host` names this machine, refuses every other.
 *
 * Accepted are `127.0.0.1`, `[::1]`, `localhost` and any name ending in
 * `.localhost`, each with or without a port. Anything else is answered 403
 * with a sentence naming the host that was sent, because the developer
 * reaching keel-web through an alias needs to know why it refused rather
 * than see an empty page.
 *
 * `Origin` is checked the other way round: it is refused when it is present
 * and is not this server's own origin, and ignored when absent. A request
 * from a terminal carries no origin and is not a browser, so requiring one
 * would refuse the wrong things.
 *
 * A missing `Host` is refused. HTTP/1.1 requires it, and a request without
 * one is not something to guess about.
 */
export type CreateHostGuard = (allowed?: HostGuardOptions) => MiddlewareHandler

export interface HostGuardOptions {
  /**
   * Extra host names to accept, for a developer reaching keel-web through a
   * tunnel or an alias. Each is matched whole, without wildcards.
   */
  additionalHosts?: readonly string[]
}
