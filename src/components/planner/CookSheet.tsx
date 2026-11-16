import { useMemo, useState } from 'react'
import { mergeTakes, planCooking, type UseLine } from '../../lib/cooking'
import { pantryTake } from '../../lib/plannerApi'
import type { PlannedMeal, Recipe } from '../../lib/types'
import { amount } from '../../lib/units'
import type { PlannerContext } from './Planner'

function describe(l: UseLine): string {
  if (l.reason === 'no-item') return "not matched to a grocery item, so it isn't tracked"
  if (l.reason === 'not-in-pantry') return 'none in the pantry'
  if (l.reason === 'no-amount') return 'no amount in the recipe; adjust it on the Pantry tab if needed'
  if (l.reason === 'no-conversion') return "the recipe's unit can't be converted to how it's stored"
  const parts = l.takes.map((t) => `${amount(t.qty, t.unit)} from the ${t.location.toLowerCase()}`)
  return parts.join(' + ') + (l.short > 0 && l.item ? `; short ${amount(l.short, l.item.package_unit)}` : '')
}

/**
 * Shown when a meal is marked cooked: what will come out of the pantry,
 * earliest use-by first. Untick anything you didn't use, then confirm.
 */
export function CookSheet({
  ctx, meal, recipe, onClose,
}: {
  ctx: PlannerContext
  meal: PlannedMeal
  recipe: Recipe
  onClose: () => void
}) {
  const [batches, setBatches] = useState(Math.max(1, meal.batches))
  const lines = useMemo(() => planCooking(recipe, batches, ctx.book, ctx.pantry), [recipe, batches, ctx.book, ctx.pantry])
  const [skip, setSkip] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const chosen = lines.filter((l, i) => l.takes.length > 0 && !skip.has(i))
  const takes = mergeTakes(chosen)

  const confirm = async () => {
    setBusy(true)
    setErr(null)
    try {
      await pantryTake(takes)
      ctx.updatePlan({
        ...ctx.plan,
        meals: ctx.plan.meals.map((m) =>
          m.day === meal.day && m.slot === meal.slot ? { ...m, batches, cooked: true, used: takes } : m,
        ),
      })
      await ctx.reloadStock()
      onClose()
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Cooked ${recipe.title}`}>
        <h2>Cooked {recipe.title}</h2>
        <div className="inline-form" style={{ alignItems: 'center' }}>
          <span>Made the recipe</span>
          <div className="stepper">
            <button aria-label="Fewer batches" disabled={batches <= 1} onClick={() => setBatches(batches - 1)}>
              −
            </button>
            <span>{batches}×</span>
            <button aria-label="More batches" disabled={batches >= 10} onClick={() => setBatches(batches + 1)}>
              +
            </button>
          </div>
        </div>
        <p className="hint">
          These come out of the pantry, oldest use-by date first. Untick anything you didn't use.
        </p>
        {err && <p className="msg err">{err}</p>}
        <ul className="cook-list">
          {lines.map((l, i) => {
            const can = l.takes.length > 0
            return (
              <li key={i} className={can ? '' : 'muted'}>
                <label className="check">
                  <input
                    type="checkbox"
                    disabled={!can}
                    checked={can && !skip.has(i)}
                    onChange={(e) => {
                      const next = new Set(skip)
                      if (e.target.checked) next.delete(i)
                      else next.add(i)
                      setSkip(next)
                    }}
                  />
                  <span>
                    <strong>{l.text}</strong>
                    <span className="hint"> · {describe(l)}</span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
        <div className="actions">
          <button className="btn" disabled={busy} onClick={confirm}>
            {takes.length ? `Mark cooked and update the pantry` : 'Mark cooked'}
          </button>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
