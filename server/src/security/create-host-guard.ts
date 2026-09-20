import type { CreateHostGuard } from './types.js'

const loopback = new Set(['127.0.0.1', '[::1]', '::1', 'localhost'])

/**
 * The name out of an authority, without its port.
 *
 * An IPv6 authority brackets its address, so a colon separates the port only
 * when it sits after the closing bracket.
 */
function nameOf(authority: string): string {
  const trimmed = authority.trim().toLowerCase()
  if (trimmed.startsWith('[')) {
    const closed = trimmed.indexOf(']')
    return closed === -1 ? trimmed : trimmed.slice(0, closed + 1)
  }
  const colon = trimmed.lastIndexOf(':')
  return colon === -1 ? trimmed : trimmed.slice(0, colon)
}

export const createHostGuard: CreateHostGuard = (options) => {
  const additional = new Set((options?.additionalHosts ?? []).map((host) => host.toLowerCase()))

  const permitted = (name: string) =>
    loopback.has(name) || name.endsWith('.localhost') || additional.has(name)

  return async (context, next) => {
    const host = context.req.header('host')
    if (host === undefined) {
      return context.json({ reason: 'This request carries no Host header.' }, 403)
    }

    const name = nameOf(host)
    if (!permitted(name)) {
      return context.json(
        { reason: `keel-web answers to this machine only, and ${name} is not one of its names.` },
        403,
      )
    }

    // Absent from a terminal and from same-origin requests, so its absence
    // says nothing. Present and foreign is a different matter.
    const origin = context.req.header('origin')
    if (origin !== undefined && origin !== 'null') {
      let originName
      try {
        originName = nameOf(new URL(origin).host)
      } catch {
        return context.json({ reason: `${origin} is not an origin keel-web can read.` }, 403)
      }
      if (!permitted(originName)) {
        return context.json({ reason: `keel-web does not answer requests from ${origin}.` }, 403)
      }
    }

    await next()
  }
}
