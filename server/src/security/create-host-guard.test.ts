import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { createHostGuard } from './create-host-guard.js'

function app(additionalHosts?: readonly string[]) {
  const routes = new Hono()
  routes.use(createHostGuard(additionalHosts ? { additionalHosts } : undefined))
  routes.get('/artifacts', (context) => context.json({ read: true }))
  return routes
}

async function get(routes: Hono, headers: Record<string, string>) {
  return routes.request('http://127.0.0.1:3000/artifacts', { headers })
}

describe('the host guard', () => {
  it('lets a request from this machine through', async () => {
    for (const host of ['127.0.0.1:3000', 'localhost:3000', '[::1]:3000', 'keel.localhost']) {
      const response = await get(app(), { host })
      expect(response.status, host).toBe(200)
    }
  })

  it('refuses a host that is not this machine, and says which one', async () => {
    const response = await get(app(), { host: 'rebound.example.com' })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      reason:
        'keel-web answers to this machine only, and rebound.example.com is not one of its names.',
    })
  })

  it('refuses a request without a host header', async () => {
    const routes = app()
    const response = await routes.request(
      new Request('http://127.0.0.1:3000/artifacts', { headers: { host: '' } }),
    )

    expect(response.status).toBe(403)
  })

  it('accepts a host the developer allowed', async () => {
    expect((await get(app(['keel.internal']), { host: 'keel.internal:3000' })).status).toBe(200)
  })

  it('ignores an absent origin, because a terminal sends none', async () => {
    expect((await get(app(), { host: 'localhost:3000' })).status).toBe(200)
  })

  it('accepts an origin on this machine, whatever its port', async () => {
    const response = await get(app(), { host: 'localhost:3000', origin: 'http://localhost:5173' })

    expect(response.status).toBe(200)
  })

  it('refuses a foreign origin even when the host is loopback', async () => {
    const response = await get(app(), { host: 'localhost:3000', origin: 'https://evil.example' })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      reason: 'keel-web does not answer requests from https://evil.example.',
    })
  })
})
