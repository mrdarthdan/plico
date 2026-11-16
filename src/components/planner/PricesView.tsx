import { useMemo, useState, type FormEvent } from 'react'
import { batchesFor, money, shoppingList, slotSections, SLOTS, type ShoppingLine } from '../../lib/planner'
import { addGroceryItems, deleteGroceryItem, saveGroceryItem, savePlannerSettings } from '../../lib/plannerApi'
import type { GroceryItem, GroceryItemInput, PlannedMeal } from '../../lib/types'
import { amount, PACKAGE_UNITS } from '../../lib/units'
import type { PlannerContext } from './Planner'
import { problemText } from './ShoppingView'

// Set by the shopping list's "Fix on the Prices tab" link.
let pendingFocus: ShoppingLine | null = null
export function focusLine(l: ShoppingLine) {
  pendingFocus = l
}

const CATEGORIES = [
  'Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery & Bread', 'Pantry', 'Canned Goods', 'Baking & Spices',
  'Frozen', 'Beverages', 'Household',
]

// Common pantry staples, added in one go with no prices. Staples count as on
// hand and aren't costed per meal.
const STARTER_STAPLES = [
  'salt', 'black pepper', 'garlic powder', 'granulated garlic', 'onion powder', 'dried onion flake', 'oregano',
  'thyme', 'basil', 'cumin', 'chili powder', 'paprika', 'smoked paprika', 'cinnamon', 'nutmeg', 'bay leaf',
  'red pepper flake', 'italian seasoning', 'cayenne pepper', 'seasoning salt', 'baking soda', 'baking powder',
  'cream of tartar', 'cornstarch', 'vanilla extract', 'olive oil', 'vegetable oil', 'canola oil', 'cooking spray',
  'worcestershire sauce', 'soy sauce', 'chicken bouillon',
]

type Draft = Partial<GroceryItem> & { name: string }

export function PricesView({ ctx }: { ctx: PlannerContext }) {
  const { items, settings, data, plan } = ctx
  const [scope, setScope] = useState<'week' | 'all'>('week')
  const [editing, setEditing] = useState<{ draft: Draft; hints: string[]; link?: string } | null>(() => {
    const l = pendingFocus
    pendingFocus = null
    if (!l) return null
    return l.item
      ? { draft: l.item, hints: l.missingUnits }
      : { draft: { name: l.name }, hints: [] }
  })
  const [filter, setFilter] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)

  // Everything the planner could choose from, made once each, to price ahead.
  const allLines = useMemo(() => {
    if (scope === 'week') return ctx.list.lines
    const pools = slotSections(settings, data.sections)
    const secs = new Set(SLOTS.flatMap((s) => (settings.slots[s]?.on ? pools[s] : [])))
    const meals: PlannedMeal[] = data.recipes
      .filter((r) => secs.has(r.section_id))
      .map((r) => ({ day: 0, slot: 'dinner', recipe_id: r.id, batches: batchesFor(r, 1), locked: false, leftover: false, note: null }))
    return shoppingList(meals, new Map(data.recipes.map((r) => [r.id, r])), ctx.book).lines
  }, [scope, ctx.list, ctx.book, settings, data])

  const attention = allLines
    .filter((l) => !l.staple && l.problems.length > 0)
    .sort((a, b) => b.uses.length - a.uses.length)
  const shown = showAll ? attention : attention.slice(0, 25)

  const run = async (change: () => Promise<unknown>) => {
    setBusy(true)
    ctx.onError(null)
    try {
      await change()
      await ctx.reloadItems()
      return true
    } catch (e) {
      ctx.onError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const ignore = (name: string) =>
    run(async () => {
      const next = { ...settings, ignored: [...settings.ignored, name] }
      await savePlannerSettings(next)
      ctx.setSettings(next)
    })

  const visibleItems = items.filter((i) => !filter || i.name.toLowerCase().includes(filter.toLowerCase()))
  const used = new Set(plan ? ctx.list.lines.map((l) => l.item?.id) : [])

  return (
    <>
      {editing && (
        <ItemEditor
          key={(editing.draft.id ?? 'new') + editing.draft.name}
          draft={editing.draft}
          hints={editing.hints}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={async (id, input) => {
            const ok = await run(() => saveGroceryItem(id, input))
            if (ok) setEditing(null)
          }}
        />
      )}

      <section className="admin-block">
        <h2>Needs attention</h2>
        <p className="hint">
          Ingredients the shopping list can't cost yet, most used first. Add each as a grocery item with its package
          size and price, link it to an item you already have, or mark it as a pantry staple.
        </p>
        <div className="chips">
          <button className="chip" aria-pressed={scope === 'week'} onClick={() => setScope('week')}>
            This week's meals
          </button>
          <button className="chip" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
            Every recipe the planner can pick
          </button>
        </div>
        {attention.length === 0 ? (
          <p className="msg ok">
            {scope === 'week' && ctx.list.lines.length === 0 ? 'Nothing planned this week yet.' : 'Everything here has a price.'}
          </p>
        ) : (
          <ul className="fix-list">
            {shown.map((l) => (
              <FixRow
                key={l.key}
                line={l}
                items={items}
                busy={busy}
                onEdit={() => setEditing(l.item ? { draft: l.item, hints: l.missingUnits } : { draft: { name: l.name }, hints: [] })}
                onStaple={() => run(() => saveGroceryItem(null, { name: l.name, staple: true, category: 'Baking & Spices' }))}
                onLink={(it) => run(() => saveGroceryItem(it.id, { aliases: [...it.aliases, l.name] }))}
                onIgnore={() => ignore(l.name)}
              />
            ))}
          </ul>
        )}
        {attention.length > shown.length && (
          <button className="link" onClick={() => setShowAll(true)}>
            Show all {attention.length}
          </button>
        )}
      </section>

      <section className="admin-block">
        <h2>Grocery items</h2>
        <p className="hint">
          What you buy, the package you buy it in, and what that package costs. Kroger price lookups come in a later
          update; for now, type prices from a receipt or the store's site.
        </p>
        <div className="inline-form">
          <input type="search" placeholder="Find an item" aria-label="Find an item" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button className="btn" onClick={() => setEditing({ draft: { name: filter.trim() }, hints: [] })}>
            + New item
          </button>
          {items.filter((i) => i.staple).length < 5 && (
            <button
              className="btn ghost"
              disabled={busy}
              onClick={() =>
                run(() => addGroceryItems(STARTER_STAPLES.map((name) => ({ name, staple: true, category: 'Baking & Spices' }))))
              }
            >
              Add common pantry staples
            </button>
          )}
        </div>
        {visibleItems.length === 0 ? (
          <p className="empty">No grocery items yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Package</th>
                <th>Price</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((it) => (
                <tr key={it.id}>
                  <td>
                    {it.name}
                    {it.staple && <span className="tag"> staple</span>}
                    {used.has(it.id) && <span className="hint"> · this week</span>}
                  </td>
                  <td>{amount(it.package_qty, it.package_unit)}</td>
                  <td>
                    {it.price != null ? money(it.price) : '—'}
                    {it.price_updated_at && <span className="hint"> · {new Date(it.price_updated_at).toLocaleDateString()}</span>}
                  </td>
                  <td>
                    <span className="row-actions">
                      <button className="btn ghost" onClick={() => setEditing({ draft: it, hints: [] })}>
                        Edit
                      </button>
                      <button
                        className="btn danger"
                        disabled={busy}
                        onClick={() => window.confirm(`Delete ${it.name}?`) && run(() => deleteGroceryItem(it.id))}
                      >
                        Delete
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

function FixRow({
  line: l, items, busy, onEdit, onStaple, onLink, onIgnore,
}: {
  line: ShoppingLine
  items: GroceryItem[]
  busy: boolean
  onEdit: () => void
  onStaple: () => void
  onLink: (it: GroceryItem) => void
  onIgnore: () => void
}) {
  return (
    <li className="fix-row">
      <div>
        <strong>{l.name}</strong> <span className="badge">needs {problemText(l)}</span>
        <div className="hint">
          {l.uses.length} use{l.uses.length === 1 ? '' : 's'}: {l.uses.slice(0, 2).join('; ')}
          {l.uses.length > 2 ? '; …' : ''}
        </div>
      </div>
      <div className="row-actions">
        {l.item ? (
          <button className="btn" disabled={busy} onClick={onEdit}>
            Edit {l.item.name}
          </button>
        ) : (
          <>
            <button className="btn" disabled={busy} onClick={onEdit}>
              Add item
            </button>
            <button className="btn ghost" disabled={busy} onClick={onStaple} title="Count it as always on hand">
              Staple
            </button>
            {items.length > 0 && (
              <select
                aria-label={`Link ${l.name} to an existing item`}
                disabled={busy}
                value=""
                onChange={(e) => {
                  const it = items.find((i) => String(i.id) === e.target.value)
                  if (it) onLink(it)
                }}
              >
                <option value="">Same as…</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            )}
            <button className="link" disabled={busy} onClick={onIgnore} title="Never put this on a shopping list">
              Ignore
            </button>
          </>
        )}
      </div>
    </li>
  )
}

function ItemEditor({
  draft, hints, busy, onCancel, onSave,
}: {
  draft: Draft
  hints: string[]
  busy: boolean
  onCancel: () => void
  onSave: (id: number | null, input: Partial<GroceryItemInput>) => void
}) {
  const [name, setName] = useState(draft.name)
  const [category, setCategory] = useState(draft.category ?? '')
  const [qty, setQty] = useState(String(draft.package_qty ?? 1))
  const [unit, setUnit] = useState(draft.package_unit ?? 'each')
  const [price, setPrice] = useState(draft.price != null ? String(draft.price) : '')
  const [staple, setStaple] = useState(draft.staple ?? false)
  const [aliases, setAliases] = useState((draft.aliases ?? []).join(', '))
  const [conv, setConv] = useState<[string, string][]>(() => {
    const rows: [string, string][] = Object.entries(draft.conversions ?? {}).map(([u, v]) => [u, String(v)])
    for (const h of hints) if (!rows.some(([u]) => u === h)) rows.push([h, ''])
    return rows
  })
  const [err, setErr] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const q = Number(qty)
    if (!name.trim()) return setErr('Give the item a name.')
    if (!(q > 0)) return setErr('The package size must be more than 0.')
    const p = price.trim() === '' ? null : Number(price)
    if (p != null && !(p >= 0)) return setErr('The price must be a number.')
    const conversions: Record<string, number> = {}
    for (const [u, v] of conv) {
      const n = Number(v)
      if (u.trim() && v.trim() && n > 0) conversions[u.trim().toLowerCase()] = n
    }
    const input: Partial<GroceryItemInput> = {
      name: name.trim().toLowerCase(),
      category: category.trim() || null,
      package_qty: q,
      package_unit: unit,
      staple,
      conversions,
      aliases: aliases.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean),
    }
    if (p !== (draft.price ?? null)) {
      input.price = p
      input.price_source = p == null ? null : 'manual'
    }
    onSave(draft.id ?? null, input)
  }

  return (
    <form className="editor" onSubmit={submit}>
      <h2>{draft.id ? `Edit ${draft.name}` : 'New grocery item'}</h2>
      {err && <p className="msg err">{err}</p>}
      <div className="row">
        <div className="field">
          <label htmlFor="g-name">Name</label>
          <input id="g-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="g-cat">Aisle</label>
          <input id="g-cat" list="g-cats" maxLength={40} value={category} onChange={(e) => setCategory(e.target.value)} />
          <datalist id="g-cats">
            {CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor="g-price">Package price ($)</label>
          <input id="g-price" type="number" inputMode="decimal" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="g-qty">Package size</label>
          <input id="g-qty" type="number" inputMode="decimal" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="g-unit">Unit</label>
          <select id="g-unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {PACKAGE_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <label className="check" style={{ alignSelf: 'end', paddingBottom: 10 }}>
          <input type="checkbox" checked={staple} onChange={(e) => setStaple(e.target.checked)} />
          <span>Pantry staple</span>
        </label>
      </div>
      <p className="hint">
        E.g. eggs: 12 each. Flour: 5 lb. Canned tomatoes: 14.5 oz (or 1 each).
      </p>

      <div className="field">
        <label>Recipe units this item is measured in</label>
        <p className="hint">
          Needed when recipes measure it differently from how it's sold, e.g. flour sold by the lb but measured in cups:
          1 cup = 0.28 lb.
        </p>
        {conv.map(([u, v], i) => (
          <div key={i} className="inline-form conv-row">
            <span>1</span>
            <input aria-label="Recipe unit" className="narrow" value={u} onChange={(e) => setConv(conv.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} />
            <span>=</span>
            <input aria-label={`How many ${unit} in 1 ${u}`} className="narrow" type="number" step="any" min={0} value={v} onChange={(e) => setConv(conv.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} />
            <span>{unit}</span>
            <button type="button" className="link" onClick={() => setConv(conv.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="link" onClick={() => setConv([...conv, ['', '']])}>
          + Add a unit
        </button>
      </div>

      <div className="field">
        <label htmlFor="g-alias">Also called (comma-separated)</label>
        <input id="g-alias" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="all purpose flour, ap flour" />
      </div>
      <div className="actions">
        <button className="btn" type="submit" disabled={busy}>
          Save item
        </button>
        <button className="btn ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
