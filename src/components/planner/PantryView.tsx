import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { lookupProduct, type ProductInfo } from '../../lib/barcode'
import { ingredientKey, makeResolver } from '../../lib/ingredients'
import { addDays, money, today } from '../../lib/planner'
import { addPantry, deletePantry, saveBarcode, saveGroceryItem, updatePantry } from '../../lib/plannerApi'
import type { Barcode, GroceryItem, PantryRow } from '../../lib/types'
import { amount, PACKAGE_UNITS, toPackageUnits } from '../../lib/units'
import type { PlannerContext } from './Planner'
import { Scanner } from './Scanner'

const LOCATIONS = ['Pantry', 'Fridge', 'Freezer']

type Receiving =
  | { kind: 'scan'; code: string; barcode: Barcode | null; product: ProductInfo | null; looking: boolean }
  | { kind: 'manual' }

export function PantryView({ ctx }: { ctx: PlannerContext }) {
  const { pantry, items, barcodes } = ctx
  const [scanning, setScanning] = useState(false)
  const [receiving, setReceiving] = useState<Receiving | null>(null)
  const [filter, setFilter] = useState('')
  const [flash, setFlash] = useState<string | null>(null)
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  const scanned = (code: string) => {
    setScanning(false)
    setFlash(null)
    const known = barcodes.find((b) => b.code === code) ?? null
    setReceiving({ kind: 'scan', code, barcode: known, product: null, looking: !known })
    if (!known) {
      void lookupProduct(code).then((product) =>
        setReceiving((r) => (r?.kind === 'scan' && r.code === code ? { ...r, product, looking: false } : r)),
      )
    }
  }

  const now = today()
  const soonBy = addDays(now, 4)
  const rows = pantry
    .map((r) => ({ r, it: itemById.get(r.grocery_item_id) }))
    .filter((x): x is { r: PantryRow; it: GroceryItem } => !!x.it)
    .filter((x) => !filter || x.it.name.includes(filter.toLowerCase()))
    .sort((a, b) => a.it.name.localeCompare(b.it.name))
  const soon = rows.filter((x) => x.r.expires && x.r.expires <= soonBy).sort((a, b) => a.r.expires!.localeCompare(b.r.expires!))
  const locations = [...new Set([...LOCATIONS, ...rows.map((x) => x.r.location)])]

  return (
    <>
      {scanning && <Scanner onCode={scanned} onClose={() => setScanning(false)} />}

      <div className="actions">
        <button className="btn" onClick={() => setScanning(true)}>
          📷 Scan to add
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            setFlash(null)
            setReceiving({ kind: 'manual' })
          }}
        >
          Add without scanning
        </button>
      </div>
      {flash && <p className="msg ok">{flash}</p>}

      {receiving && (
        <ReceiveForm
          key={receiving.kind === 'scan' ? receiving.code + receiving.looking : 'manual'}
          ctx={ctx}
          receiving={receiving}
          onDone={(msg) => {
            setReceiving(null)
            if (msg) setFlash(msg)
          }}
        />
      )}

      {soon.length > 0 && (
        <section>
          <div className="section-label">Use soon</div>
          <ul className="stock">
            {soon.map(({ r, it }) => (
              <StockRow key={'s' + r.id} ctx={ctx} row={r} item={it} now={now} />
            ))}
          </ul>
        </section>
      )}

      <div className="inline-form">
        <input type="search" placeholder="Find in the pantry" aria-label="Find in the pantry" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      {rows.length === 0 ? (
        <p className="empty">
          {pantry.length === 0
            ? "Nothing in the pantry yet. Scan groceries as you put them away, or tick items on the shopping list and put them in the pantry from there. The planner then buys only what you're short of, and picks recipes that use up food before it expires."
            : 'Nothing matches.'}
        </p>
      ) : (
        locations.map((loc) => {
          const here = rows.filter((x) => x.r.location === loc)
          if (!here.length) return null
          return (
            <section key={loc}>
              <div className="section-label">
                {loc} · {here.length}
              </div>
              <ul className="stock">
                {here.map(({ r, it }) => (
                  <StockRow key={r.id} ctx={ctx} row={r} item={it} now={now} />
                ))}
              </ul>
            </section>
          )
        })
      )}
    </>
  )
}

function StockRow({ ctx, row: r, item: it, now }: { ctx: PlannerContext; row: PantryRow; item: GroceryItem; now: string }) {
  const [mode, setMode] = useState<'view' | 'use' | 'edit'>('view')
  const [use, setUse] = useState('')
  const [qty, setQty] = useState(String(r.qty))
  const [location, setLocation] = useState(r.location)
  const [expires, setExpires] = useState(r.expires ?? '')
  const [busy, setBusy] = useState(false)

  const run = async (change: () => Promise<void>) => {
    setBusy(true)
    ctx.onError(null)
    try {
      await change()
      await ctx.reloadStock()
      setMode('view')
    } catch (e) {
      ctx.onError((e as Error).message)
    }
    setBusy(false)
  }

  const expired = !!r.expires && r.expires < now
  const soon = !!r.expires && !expired && r.expires <= addDays(now, 4)
  const dateText = r.expires ? new Date(r.expires + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''

  return (
    <li className="stock-row">
      <div className="stock-main">
        <span className="stock-name">{it.name}</span>
        <span className="shop-qty">{amount(r.qty, r.unit)}</span>
        {r.expires && (
          <span className={'badge' + (expired || soon ? '' : ' calm')}>
            {expired ? `expired ${dateText}` : `use by ${dateText}`}
          </span>
        )}
      </div>
      {mode === 'view' && (
        <div className="row-actions">
          <button className="btn ghost" onClick={() => setMode('use')}>
            Use some
          </button>
          <button className="btn ghost" onClick={() => setMode('edit')}>
            Edit
          </button>
          <button className="btn danger" disabled={busy} onClick={() => run(() => deletePantry(r.id))}>
            Used up
          </button>
        </div>
      )}
      {mode === 'use' && (
        <form
          className="inline-form stock-edit"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            const n = Number(use)
            if (!(n > 0)) return
            const left = Math.max(0, Math.round((r.qty - n) * 1000) / 1000)
            void run(() => (left <= 0 ? deletePantry(r.id) : updatePantry(r.id, { qty: left })))
          }}
        >
          <input autoFocus className="narrow" type="number" inputMode="decimal" min={0} step="any" aria-label={`How much ${it.name} was used, in ${r.unit}`} value={use} onChange={(e) => setUse(e.target.value)} />
          <span>{r.unit === 'each' ? 'used' : r.unit + ' used'}</span>
          <button className="btn" type="submit" disabled={busy}>
            Save
          </button>
          <button className="link" type="button" onClick={() => setMode('view')}>
            Cancel
          </button>
        </form>
      )}
      {mode === 'edit' && (
        <form
          className="inline-form stock-edit"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            const n = Number(qty)
            if (!(n >= 0) || !location.trim()) return
            void run(() =>
              n === 0 ? deletePantry(r.id) : updatePantry(r.id, { qty: n, location: location.trim().slice(0, 40), expires: expires || null }),
            )
          }}
        >
          <input className="narrow" type="number" inputMode="decimal" min={0} step="any" aria-label={`Amount in ${r.unit}`} value={qty} onChange={(e) => setQty(e.target.value)} />
          <span>{r.unit}</span>
          <input className="narrow" list="pantry-locs" aria-label="Where it's kept" value={location} onChange={(e) => setLocation(e.target.value)} />
          <input type="date" aria-label="Use by" value={expires} onChange={(e) => setExpires(e.target.value)} />
          <datalist id="pantry-locs">
            {LOCATIONS.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <button className="btn" type="submit" disabled={busy}>
            Save
          </button>
          <button className="link" type="button" onClick={() => setMode('view')}>
            Cancel
          </button>
        </form>
      )}
    </li>
  )
}

/** Suggests a plain grocery name from a product name: "Great Value All-Purpose Flour" -> "all purpose flour". */
function plainName(product: ProductInfo | null): string {
  if (!product?.name) return ''
  const brandWords = new Set(ingredientKey(product.brand ?? '').split(' '))
  return ingredientKey(product.name)
    .split(' ')
    .filter((w) => !brandWords.has(w))
    .join(' ')
}

function ReceiveForm({ ctx, receiving, onDone }: { ctx: PlannerContext; receiving: Receiving; onDone: (msg: string | null) => void }) {
  const { items } = ctx
  const scan = receiving.kind === 'scan' ? receiving : null
  const known = scan?.barcode ? items.find((i) => i.id === scan.barcode!.grocery_item_id) ?? null : null
  const product = scan?.product ?? null

  // Best guess at which item a new product is: the longest item name inside its name.
  const guess = useMemo(() => {
    if (known || !product?.name) return null
    return makeResolver(items)(ingredientKey(product.name))
  }, [known, product, items])

  const [itemId, setItemId] = useState<string>(known ? String(known.id) : guess ? String(guess.id) : '')
  const chosen = items.find((i) => String(i.id) === itemId) ?? null
  const [name, setName] = useState(plainName(product))
  const [category, setCategory] = useState('')
  const startSize = scan?.barcode?.size_qty
    ? { qty: scan.barcode.size_qty, unit: scan.barcode.size_unit ?? 'each' }
    : product?.size && (PACKAGE_UNITS as readonly string[]).includes(product.size.unit)
      ? product.size
      : chosen
        ? { qty: chosen.package_qty, unit: chosen.package_unit }
        : { qty: 1, unit: 'each' }
  const [sizeQty, setSizeQty] = useState(String(startSize.qty))
  const [sizeUnit, setSizeUnit] = useState(startSize.unit)
  const [count, setCount] = useState('1')
  const [paid, setPaid] = useState('')
  const [location, setLocation] = useState('Pantry')
  const [expires, setExpires] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // A manual add of an existing item starts from that item's usual package.
  useEffect(() => {
    if (!scan && chosen) {
      setSizeQty(String(chosen.package_qty))
      setSizeUnit(chosen.package_unit)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  if (scan?.looking) {
    return (
      <div className="editor">
        <p className="hint">Looking up {scan.code}…</p>
      </div>
    )
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    const q = Number(sizeQty)
    const n = Number(count)
    const p = paid.trim() === '' ? null : Number(paid)
    if (!chosen && !name.trim()) return setErr('Give the item a plain name, like "flour" or "black beans", so recipes can find it.')
    if (!(q > 0)) return setErr('The package size must be more than 0.')
    if (!(n > 0)) return setErr('How many did you get?')
    if (p != null && !(p >= 0)) return setErr('The price must be a number.')
    setBusy(true)
    try {
      let item = chosen
      if (!item) {
        item = await saveGroceryItem(null, {
          name: name.trim().toLowerCase(),
          category: category.trim() || null,
          package_qty: q,
          package_unit: sizeUnit,
          price: p,
          price_source: p == null ? null : 'receipt',
          staple: false,
          conversions: {},
          aliases: [],
        })
      } else if (p != null) {
        // Record the price for the item's usual package size.
        const inItemUnits = toPackageUnits(q, sizeUnit, item.package_unit, item.conversions)
        if (inItemUnits) {
          await saveGroceryItem(item.id, {
            price: Math.round(((p * item.package_qty) / inItemUnits) * 100) / 100,
            price_source: 'receipt',
          })
        }
      }
      if (scan) {
        await saveBarcode({
          code: scan.code,
          grocery_item_id: item.id,
          product_name: scan.barcode?.product_name ?? product?.name?.slice(0, 200) ?? null,
          brand: scan.barcode?.brand ?? product?.brand?.slice(0, 120) ?? null,
          size_qty: q,
          size_unit: sizeUnit,
        })
      }
      await addPantry([
        {
          grocery_item_id: item.id,
          qty: Math.round(n * q * 1000) / 1000,
          unit: sizeUnit,
          location: location.trim().slice(0, 40) || 'Pantry',
          expires: expires || null,
        },
      ])
      await ctx.reloadStock()
      onDone(`Added ${amount(n * q, sizeUnit)} of ${item.name} to the ${location.trim() || 'pantry'}.`)
    } catch (e2) {
      setErr((e2 as Error).message)
      setBusy(false)
    }
  }

  return (
    <form className="editor" onSubmit={submit}>
      <h2>{known ? `Add ${known.name}` : scan ? 'New product' : 'Add to the pantry'}</h2>
      {scan && (
        <p className="hint">
          Barcode {scan.code}
          {known
            ? scan.barcode?.product_name
              ? ` · ${[scan.barcode.brand, scan.barcode.product_name].filter(Boolean).join(' ')}`
              : ''
            : product
              ? ` · ${[product.brand, product.name].filter(Boolean).join(' ') || 'found, but unnamed'}${product.size ? ` · ${amount(product.size.qty, product.size.unit)}` : ''}`
              : " · not in Open Food Facts, so fill it in once and it's remembered."}
        </p>
      )}
      {err && <p className="msg err">{err}</p>}

      {!known && (
        <div className="row">
          <div className="field">
            <label htmlFor="r-item">Which grocery item is it?</label>
            <select id="r-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">A new item…</option>
              {guess && <option value={guess.id}>{guess.name} (best match)</option>}
              {items
                .filter((i) => i.id !== guess?.id)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
            </select>
          </div>
          {!chosen && (
            <>
              <div className="field">
                <label htmlFor="r-name">Plain name</label>
                <input id="r-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. black beans" />
              </div>
              <div className="field">
                <label htmlFor="r-cat">Aisle</label>
                <input id="r-cat" list="r-cats" maxLength={40} value={category} onChange={(e) => setCategory(e.target.value)} />
                <datalist id="r-cats">
                  {['Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery & Bread', 'Pantry', 'Canned Goods', 'Baking & Spices', 'Frozen', 'Beverages', 'Household'].map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
            </>
          )}
        </div>
      )}

      <div className="row">
        <div className="field">
          <label htmlFor="r-count">How many</label>
          <input id="r-count" type="number" inputMode="decimal" min={0} step="any" value={count} onChange={(e) => setCount(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="r-size">Each one is</label>
          <div className="inline-form">
            <input id="r-size" className="narrow" type="number" inputMode="decimal" min={0} step="any" value={sizeQty} onChange={(e) => setSizeQty(e.target.value)} />
            <select aria-label="Unit" value={sizeUnit} onChange={(e) => setSizeUnit(e.target.value)}>
              {PACKAGE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="r-paid">Price paid each ($, optional)</label>
          <input id="r-paid" type="number" inputMode="decimal" min={0} step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder={chosen?.price != null ? `was ${money(chosen.price)}` : ''} />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="r-loc">Kept in</label>
          <input id="r-loc" list="r-locs" maxLength={40} value={location} onChange={(e) => setLocation(e.target.value)} />
          <datalist id="r-locs">
            {LOCATIONS.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor="r-exp">Use by (optional)</label>
          <input id="r-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </div>
      </div>
      <div className="actions">
        <button className="btn" type="submit" disabled={busy}>
          Add to the pantry
        </button>
        <button className="btn ghost" type="button" onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
    </form>
  )
}
