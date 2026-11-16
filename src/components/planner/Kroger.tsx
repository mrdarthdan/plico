import { useEffect, useState, type FormEvent } from 'react'
import { currentPrice, findStores, productsById, searchProducts, updateFromProduct, type KrogerProduct, type KrogerStore } from '../../lib/kroger'
import { money, today } from '../../lib/planner'
import { saveGroceryItem, savePlannerSettings } from '../../lib/plannerApi'
import type { GroceryItem } from '../../lib/types'
import type { PlannerContext } from './Planner'

function shortDate(d: string): string {
  return new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** "$3.99 (sale through Nov 17, was $4.49)" */
export function PriceTag({ p }: { p: Pick<KrogerProduct, 'regular' | 'promo' | 'promoEnds'> }) {
  const now = currentPrice(p, today())
  if (now == null) return <span className="hint">no price at this store</span>
  const sale = p.regular != null && now < p.regular
  return (
    <span className="ktag">
      <strong>{money(now)}</strong>
      {sale && (
        <span className="badge">
          sale{p.promoEnds ? ` through ${shortDate(p.promoEnds)}` : ''}, was {money(p.regular!)}
        </span>
      )}
    </span>
  )
}

/** Searches the chosen store and lets you pick a product. */
export function KrogerPicker({
  term, locationId, busy, onPick, onCancel,
}: {
  term: string
  locationId: string
  busy: boolean
  onPick: (p: KrogerProduct) => void
  onCancel: () => void
}) {
  const [q, setQ] = useState(term)
  const [results, setResults] = useState<KrogerProduct[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = async (text: string) => {
    if (text.trim().length < 3) return setError('Search for at least 3 letters.')
    setLoading(true)
    setError(null)
    try {
      setResults(await searchProducts(text, locationId))
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }

  useEffect(() => {
    void search(term)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, locationId])

  return (
    <div className="kpicker">
      <form
        className="inline-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          void search(q)
        }}
      >
        <input type="search" aria-label="Search the store" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn ghost" type="submit" disabled={loading}>
          Search
        </button>
        <button className="link" type="button" onClick={onCancel}>
          Cancel
        </button>
      </form>
      {error && <p className="msg err">{error}</p>}
      {loading && <p className="hint">Searching…</p>}
      {!loading && results?.length === 0 && <p className="hint">Nothing found. Try fewer or plainer words.</p>}
      {!loading && results && results.length > 0 && (
        <ul className="kresults">
          {results.map((p) => (
            <li key={p.productId}>
              {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span className="kimg" />}
              <div className="kinfo">
                <span>{p.description}</span>
                <span className="hint">
                  {[p.brand, p.size].filter(Boolean).join(' · ')}
                </span>
                <PriceTag p={p} />
              </div>
              <button className="btn" disabled={busy || currentPrice(p, today()) == null} onClick={() => onPick(p)}>
                Use this
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Store choice, price refresh, and matching items to products. */
export function KrogerPanel({ ctx }: { ctx: PlannerContext }) {
  const { settings, items } = ctx
  const [choosing, setChoosing] = useState(!settings.kroger_location_id)
  const [zip, setZip] = useState('85203')
  const [stores, setStores] = useState<KrogerStore[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [matching, setMatching] = useState<number[] | null>(null)

  const run = async (change: () => Promise<void>) => {
    setBusy(true)
    ctx.onError(null)
    try {
      await change()
    } catch (e) {
      ctx.onError((e as Error).message)
    }
    setBusy(false)
  }

  const chooseStore = (s: KrogerStore) =>
    run(async () => {
      const next = { ...settings, kroger_location_id: s.locationId, kroger_store: [s.name, s.address].filter(Boolean).join(' · ').slice(0, 200) }
      await savePlannerSettings(next)
      ctx.setSettings(next)
      setChoosing(false)
      setNote('Store saved. Refresh prices to price your linked items at this store.')
    })

  const linked = items.filter((i) => i.kroger_product_id)
  const unlinked = items.filter((i) => !i.kroger_product_id && !i.staple)

  const refresh = () =>
    run(async () => {
      const loc = settings.kroger_location_id!
      const now = today()
      const found = await productsById(linked.map((i) => i.kroger_product_id!), loc)
      let priced = 0
      let kept = 0
      const missing: string[] = []
      const updates = linked.map((it) => {
        const p = found.get(it.kroger_product_id!)
        if (!p) {
          missing.push(it.name)
          return null
        }
        const patch = updateFromProduct(it, p, now)
        if (patch.price != null) priced++
        else kept++
        return () => saveGroceryItem(it.id, patch)
      })
      const jobs = updates.filter((u): u is () => Promise<GroceryItem> => !!u)
      for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8).map((j) => j()))
      await ctx.reloadStock()
      setNote(
        `Updated ${priced} price${priced === 1 ? '' : 's'}` +
          (kept ? `; kept ${kept} recent receipt price${kept === 1 ? '' : 's'}` : '') +
          (missing.length ? `. Not sold at this store: ${missing.join(', ')}.` : '.'),
      )
    })

  if (choosing || !settings.kroger_location_id) {
    return (
      <section className="admin-block">
        <h2>Store prices</h2>
        <p className="hint">Pick the Kroger-family store (Fry's, Smith's, King Soopers, Ralphs…) whose prices to use.</p>
        <form
          className="inline-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            void run(async () => setStores(await findStores(zip.trim())))
          }}
        >
          <input className="narrow" inputMode="numeric" maxLength={5} aria-label="ZIP code" value={zip} onChange={(e) => setZip(e.target.value)} />
          <button className="btn" type="submit" disabled={busy}>
            Find stores
          </button>
          {settings.kroger_location_id && (
            <button className="link" type="button" onClick={() => setChoosing(false)}>
              Cancel
            </button>
          )}
        </form>
        {stores && stores.length === 0 && <p className="hint">No stores near there.</p>}
        {stores && stores.length > 0 && (
          <ul className="fix-list">
            {stores.map((s) => (
              <li key={s.locationId} className="fix-row">
                <div>
                  <strong>{s.name}</strong>
                  <div className="hint">{s.address}</div>
                </div>
                <button className="btn" disabled={busy} onClick={() => chooseStore(s)}>
                  Use this store
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  const current = matching?.length ? items.find((i) => i.id === matching[0]) : null

  return (
    <section className="admin-block">
      <h2>Store prices</h2>
      <p className="hint">
        From <strong>{settings.kroger_store}</strong>.{' '}
        <button className="link" onClick={() => setChoosing(true)}>
          Change store
        </button>
        <br />
        {linked.length} item{linked.length === 1 ? ' is' : 's are'} linked to a store product. Sale prices are used
        until they end. A price from a receipt in the last 45 days is kept, since it's what you actually paid.
      </p>
      <div className="actions">
        <button className="btn" disabled={busy || linked.length === 0} onClick={refresh}>
          {busy && !matching ? 'Working…' : 'Refresh store prices'}
        </button>
        {unlinked.length > 0 && !matching && (
          <button className="btn ghost" disabled={busy} onClick={() => setMatching(unlinked.map((i) => i.id))}>
            Match {unlinked.length} item{unlinked.length === 1 ? '' : 's'} to store products
          </button>
        )}
      </div>
      {note && <p className="msg ok">{note}</p>}
      {matching && (
        <div className="editor">
          {current ? (
            <>
              <h2>
                {current.name} <span className="hint">({matching.length} left)</span>
              </h2>
              <KrogerPicker
                key={current.id}
                term={current.name}
                locationId={settings.kroger_location_id}
                busy={busy}
                onPick={(p) =>
                  run(async () => {
                    await saveGroceryItem(current.id, updateFromProduct(current, p, today()))
                    await ctx.reloadStock()
                    setMatching(matching.slice(1))
                  })
                }
                onCancel={() => setMatching(null)}
              />
              <div className="actions">
                <button className="btn ghost" onClick={() => setMatching(matching.slice(1))}>
                  Skip this one
                </button>
                <button className="link" onClick={() => setMatching(null)}>
                  Stop matching
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="msg ok">All done.</p>
              <button className="btn ghost" onClick={() => setMatching(null)}>
                Close
              </button>
            </>
          )}
        </div>
      )}
    </section>
  )
}
