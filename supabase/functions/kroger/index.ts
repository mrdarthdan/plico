// Kroger prices for the meal planner.
//
// Kroger's public API (https://developer.kroger.com) needs a client ID and
// secret, which must never reach the browser. This function holds them, as
// the KROGER_CLIENT_ID and KROGER_CLIENT_SECRET secrets, and answers three
// questions for signed-in planners: which stores are near a ZIP code, which
// products match a search, and what given products cost at a store.
//
// Deploy: supabase functions deploy kroger --no-verify-jwt
// (It checks the caller itself, so the connection check works signed out.)

import { createClient } from 'npm:@supabase/supabase-js@2'

const API = 'https://api.kroger.com/v1'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

// ---- Kroger access token (client credentials), kept until shortly before it expires ----

let token: { value: string; until: number } | null = null

async function accessToken(): Promise<string> {
  if (token && Date.now() < token.until) return token.value
  const id = Deno.env.get('KROGER_CLIENT_ID')
  const secret = Deno.env.get('KROGER_CLIENT_SECRET')
  if (!id || !secret) throw new Error('The KROGER_CLIENT_ID and KROGER_CLIENT_SECRET secrets are not set.')
  const res = await fetch(`${API}/connect/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${id}:${secret}`),
    },
    body: 'grant_type=client_credentials&scope=product.compact',
  })
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 400
        ? 'Kroger turned down the client ID and secret. Check both secrets match the app on developer.kroger.com.'
        : `Kroger sign-in failed (${res.status}).`,
    )
  }
  const body = (await res.json()) as { access_token: string; expires_in: number }
  token = { value: body.access_token, until: Date.now() + (body.expires_in - 60) * 1000 }
  return token.value
}

async function kroger(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const url = `${API}${path}?${new URLSearchParams(params)}`
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${await accessToken()}` } })
    if (res.status === 401 && attempt === 0) {
      token = null // expired early: get a new one and try once more
      continue
    }
    if (!res.ok) throw new Error(`Kroger answered ${res.status} for ${path}.`)
    return (await res.json()) as Record<string, unknown>
  }
  throw new Error('Kroger sign-in keeps expiring.')
}

// ---- Shapes sent back to the app ----

interface KrogerItem {
  size?: string
  soldBy?: string
  price?: { regular?: number; promo?: number; expirationDate?: { value?: string } }
}
interface KrogerProduct {
  productId: string
  upc?: string
  brand?: string
  description?: string
  categories?: string[]
  items?: KrogerItem[]
  images?: { perspective?: string; featured?: boolean; sizes?: { size?: string; url?: string }[] }[]
}

function product(p: KrogerProduct) {
  const it = p.items?.[0] ?? {}
  const img = p.images?.find((i) => i.featured) ?? p.images?.[0]
  const thumb = img?.sizes?.find((s) => s.size === 'thumbnail') ?? img?.sizes?.find((s) => s.size === 'small')
  return {
    productId: p.productId,
    upc: p.upc ?? null,
    brand: p.brand ?? null,
    description: p.description ?? '',
    category: p.categories?.[0] ?? null,
    size: it.size ?? null,
    soldBy: it.soldBy ?? null,
    regular: it.price?.regular || null,
    promo: it.price?.promo || null,
    // When the sale price ends, as YYYY-MM-DD.
    promoEnds: it.price?.promo ? it.price?.expirationDate?.value?.slice(0, 10) ?? null : null,
    image: thumb?.url ?? null,
  }
}

const isLocation = (v: unknown): v is string => typeof v === 'string' && /^[0-9A-Za-z]{1,20}$/.test(v)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return reply({ error: 'Send a JSON body.' }, 400)
  }

  try {
    // Connection check: says whether Kroger accepts the secrets, and nothing else.
    if (body.action === 'status') {
      await accessToken()
      return reply({ ok: true })
    }

    // Everything else is for meal planners only, as in the database.
    const auth = req.headers.get('Authorization') ?? ''
    const key = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? ''
    const db = createClient(Deno.env.get('SUPABASE_URL')!, key, {
      global: { headers: { Authorization: auth } },
      db: { schema: 'plico' },
    })
    const { data: allowed, error } = await db.rpc('can_plan')
    if (error || allowed !== true) return reply({ error: 'Only meal planners can look up Kroger prices.' }, 403)

    if (body.action === 'locations') {
      const zip = String(body.zip ?? '')
      if (!/^\d{5}$/.test(zip)) return reply({ error: 'Give a 5-digit ZIP code.' }, 400)
      const res = await kroger('/locations', { 'filter.zipCode.near': zip, 'filter.limit': '12' })
      const list = ((res.data as Record<string, any>[]) ?? []).map((l) => ({
        locationId: l.locationId,
        chain: l.chain ?? null,
        name: l.name ?? null,
        address: [l.address?.addressLine1, l.address?.city, l.address?.state].filter(Boolean).join(', '),
      }))
      return reply({ locations: list })
    }

    if (body.action === 'search') {
      const term = String(body.term ?? '').trim().replace(/\s+/g, ' ')
      if (term.length < 3 || term.length > 100) return reply({ error: 'Search for 3 to 100 characters.' }, 400)
      if (!isLocation(body.locationId)) return reply({ error: 'Choose a store first.' }, 400)
      const res = await kroger('/products', {
        'filter.term': term.split(' ').slice(0, 8).join(' '),
        'filter.locationId': body.locationId,
        'filter.limit': '12',
      })
      return reply({ products: ((res.data as KrogerProduct[]) ?? []).map(product) })
    }

    if (body.action === 'products') {
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string' && /^\d{1,20}$/.test(x)) : []
      if (!ids.length || ids.length > 50) return reply({ error: 'Ask for 1 to 50 products.' }, 400)
      if (!isLocation(body.locationId)) return reply({ error: 'Choose a store first.' }, 400)
      const res = await kroger('/products', {
        'filter.productId': ids.join(','),
        'filter.locationId': body.locationId,
        'filter.limit': String(ids.length),
      })
      return reply({ products: ((res.data as KrogerProduct[]) ?? []).map(product) })
    }

    return reply({ error: 'Unknown action.' }, 400)
  } catch (e) {
    return reply({ error: (e as Error).message }, 502)
  }
})
