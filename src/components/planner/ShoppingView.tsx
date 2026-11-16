import { useState, type FormEvent } from 'react'
import { money, type ShoppingLine } from '../../lib/planner'
import { amount } from '../../lib/units'
import { go } from '../../lib/useHash'
import { BudgetMeter, type PlannerContext } from './Planner'
import { focusLine } from './PricesView'

export function ShoppingView({ ctx }: { ctx: PlannerContext }) {
  const { plan, list, updatePlan } = ctx
  const [label, setLabel] = useState('')
  const [cost, setCost] = useState('')
  const checked = new Set(plan.checked)

  const toggle = (key: string, on: boolean) => {
    const next = new Set(checked)
    if (on) next.add(key)
    else next.delete(key)
    updatePlan({ ...plan, checked: [...next] })
  }

  const toBuy = list.lines.filter((l) => !l.staple)
  const staples = list.lines.filter((l) => l.staple)
  const categories = [...new Set(toBuy.map((l) => l.category))]

  if (list.lines.length === 0 && plan.extras.length === 0) {
    return (
      <p className="empty">
        The shopping list fills in from the week's meals.{' '}
        <button className="link" onClick={() => go('planner')}>
          Plan the week
        </button>{' '}
        first.
      </p>
    )
  }

  return (
    <>
      <BudgetMeter total={ctx.total} budget={plan.budget} unknown={list.unknown} />
      <div className="actions">
        <button className="btn ghost" onClick={() => window.print()}>
          Print list
        </button>
        {checked.size > 0 && (
          <button className="btn ghost" onClick={() => updatePlan({ ...plan, checked: [] })}>
            Untick all
          </button>
        )}
      </div>

      {categories.map((cat) => (
        <section key={cat}>
          <div className="section-label">{cat}</div>
          <ul className="shop">
            {toBuy
              .filter((l) => l.category === cat)
              .map((l) => (
                <Line key={l.key} line={l} checked={checked.has(l.key)} onToggle={(on) => toggle(l.key, on)} />
              ))}
          </ul>
        </section>
      ))}

      <section>
        <div className="section-label">Extras</div>
        <ul className="shop">
          {plan.extras.map((e, i) => (
            <li key={i}>
              <label className="shop-row">
                <input type="checkbox" checked={checked.has('x' + i)} onChange={(ev) => toggle('x' + i, ev.target.checked)} />
                <span className="shop-name">{e.label}</span>
                <span className="shop-cost">{e.cost != null ? money(e.cost) : ''}</span>
              </label>
              <button
                className="link"
                aria-label={'Remove ' + e.label}
                onClick={() =>
                  updatePlan({
                    ...plan,
                    extras: plan.extras.filter((_, j) => j !== i),
                    checked: plan.checked.filter((k) => !k.startsWith('x')),
                  })
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form
          className="inline-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (!label.trim()) return
            const c = cost.trim() ? Number(cost) : null
            updatePlan({ ...plan, extras: [...plan.extras, { label: label.trim().slice(0, 80), cost: c != null && c >= 0 ? c : null }] })
            setLabel('')
            setCost('')
          }}
        >
          <input aria-label="Extra item" placeholder="Something else to buy (paper towels…)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input aria-label="Its cost" className="narrow" type="number" inputMode="decimal" min={0} step="0.01" placeholder="$" value={cost} onChange={(e) => setCost(e.target.value)} />
          <button className="btn ghost" type="submit">
            Add
          </button>
        </form>
      </section>

      {staples.length > 0 && (
        <section>
          <div className="section-label">Pantry staples: check you have them</div>
          <ul className="shop">
            {staples.map((l) => (
              <Line key={l.key} line={l} checked={checked.has(l.key)} onToggle={(on) => toggle(l.key, on)} />
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function Line({ line: l, checked, onToggle }: { line: ShoppingLine; checked: boolean; onToggle: (on: boolean) => void }) {
  const it = l.item
  const size = it ? amount(it.package_qty, it.package_unit) : ''
  return (
    <li className={checked ? 'done' : ''}>
      <label className="shop-row">
        <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
        <span className="shop-name">
          {l.name}
          {it && !l.staple && (
            <span className="shop-qty">
              {' '}
              {l.packages} × {size}
              {it.price != null ? ` @ ${money(it.price)}` : ''}
            </span>
          )}
        </span>
        <span className="shop-cost">{l.staple ? '' : l.cost != null ? money(l.cost) : '?'}</span>
      </label>
      <details className="shop-uses">
        <summary>
          {l.uses.length} use{l.uses.length === 1 ? '' : 's'}
          {l.problems.length > 0 && <span className="badge">needs {problemText(l)}</span>}
        </summary>
        <ul>
          {l.uses.map((u, i) => (
            <li key={i}>{u}</li>
          ))}
        </ul>
        {l.problems.length > 0 && (
          <button
            className="link"
            onClick={() => {
              focusLine(l)
              go('planner-prices')
            }}
          >
            Fix on the Prices tab
          </button>
        )}
      </details>
    </li>
  )
}

export function problemText(l: ShoppingLine): string {
  if (l.problems.includes('no-item')) return 'an item'
  const parts = []
  if (l.problems.includes('no-price')) parts.push('a price')
  if (l.problems.includes('no-conversion')) parts.push(`a ${l.missingUnits.join('/')} conversion`)
  return parts.join(' and ')
}
