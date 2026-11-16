import { useState } from 'react'
import {
  SLOTS, SLOT_LABEL, batchesFor, dayLabel, leftoverServings, mealCost, money, slotSections, type BuildResult,
} from '../../lib/planner'
import type { PlannedMeal, Recipe, Slot } from '../../lib/types'
import { go } from '../../lib/useHash'
import { BudgetMeter, type PlannerContext } from './Planner'

export function WeekView({ ctx, rebuild }: { ctx: PlannerContext; rebuild: () => BuildResult }) {
  const { plan, settings, data, updatePlan } = ctx
  const [notice, setNotice] = useState<string | null>(null)
  const on = SLOTS.filter((s) => settings.slots[s]?.on)
  const pools = slotSections(settings, data.sections)
  const byId = new Map(data.recipes.map((r) => [r.id, r]))
  const people = plan.household_size

  const build = () => {
    const r = rebuild()
    updatePlan({ ...plan, meals: r.meals })
    setNotice(
      r.overBudget
        ? `This is the cheapest week I could find, and it's still ${money(r.total - plan.budget)} over budget. Lock fewer meals, raise the budget, or price more items.`
        : null,
    )
  }

  const mealAt = (day: number, slot: Slot) => plan.meals.find((m) => m.day === day && m.slot === slot)

  const setMeal = (day: number, slot: Slot, m: PlannedMeal | null) => {
    const rest = plan.meals.filter((x) => !(x.day === day && x.slot === slot))
    updatePlan({ ...plan, meals: m ? [...rest, m] : rest })
  }

  const empty = plan.meals.length === 0

  return (
    <>
      <div className="plan-bar">
        <div className="field">
          <label htmlFor="p-budget">Budget this week</label>
          <input
            id="p-budget"
            type="number"
            inputMode="decimal"
            min={0}
            step={5}
            value={plan.budget}
            onChange={(e) => updatePlan({ ...plan, budget: Math.max(0, Number(e.target.value) || 0) })}
          />
        </div>
        <div className="field">
          <label htmlFor="p-people">People</label>
          <input
            id="p-people"
            type="number"
            inputMode="numeric"
            min={1}
            max={30}
            value={people}
            onChange={(e) =>
              updatePlan({ ...plan, household_size: Math.min(30, Math.max(1, Math.round(Number(e.target.value) || 1))) })
            }
          />
        </div>
        <div className="actions">
          <button className="btn" onClick={build}>
            {empty ? 'Plan this week' : 'Rebuild unlocked meals'}
          </button>
          {!empty && (
            <button className="btn ghost" onClick={() => updatePlan({ ...plan, meals: plan.meals.filter((m) => m.locked) })}>
              Clear unlocked
            </button>
          )}
        </div>
      </div>

      <BudgetMeter total={ctx.total} budget={plan.budget} unknown={ctx.list.unknown} />
      {notice && <p className="msg err">{notice}</p>}

      {on.length === 0 ? (
        <p className="empty">No meals are turned on. An admin can choose them on the Admin page.</p>
      ) : empty ? (
        <p className="empty">
          Nothing planned for this week yet. <strong>Plan this week</strong> fills breakfast, lunch and dinner from your
          recipes within the budget. Lock any meal you want to keep, then rebuild the rest as often as you like.
        </p>
      ) : (
        <div className="plan-week">
          {Array.from({ length: 7 }, (_, day) => (
            <section key={day} className="plan-day">
              <h3>{dayLabel(plan.week_start, day)}</h3>
              {on.map((slot) => (
                <MealCell
                  key={slot}
                  ctx={ctx}
                  day={day}
                  slot={slot}
                  meal={mealAt(day, slot)}
                  choices={data.recipes.filter((r) => pools[slot].includes(r.section_id))}
                  byId={byId}
                  people={people}
                  onChange={(m) => setMeal(day, slot, m)}
                />
              ))}
            </section>
          ))}
        </div>
      )}
      <p className="hint">
        Costs are estimates from the prices on the Prices tab. A dinner that makes enough for another meal becomes the
        next day's lunch. Items marked as pantry staples (salt, spices, oil) count as already on hand.
      </p>
    </>
  )
}

function MealCell({
  ctx, day, slot, meal, choices, byId, people, onChange,
}: {
  ctx: PlannerContext
  day: number
  slot: Slot
  meal: PlannedMeal | undefined
  choices: Recipe[]
  byId: Map<string, Recipe>
  people: number
  onChange: (m: PlannedMeal | null) => void
}) {
  const [picking, setPicking] = useState(false)
  const recipe = meal?.recipe_id ? byId.get(meal.recipe_id) : undefined
  const cost = recipe && meal && !meal.leftover ? mealCost(recipe, meal.batches, ctx.book) : null
  const spare = recipe && meal && !meal.leftover ? leftoverServings(recipe, meal.batches, people) : 0

  const choose = (value: string) => {
    setPicking(false)
    if (value === '') return onChange(null)
    if (value === '__note') {
      const note = window.prompt('What is this meal? (e.g. Eating out, Pizza night)')?.trim()
      if (note) onChange({ day, slot, recipe_id: null, batches: 0, locked: true, leftover: false, note: note.slice(0, 80) })
      return
    }
    if (value.startsWith('__left:')) {
      onChange({ day, slot, recipe_id: value.slice(7), batches: 0, locked: true, leftover: true, note: null })
      return
    }
    const r = byId.get(value)
    if (r) onChange({ day, slot, recipe_id: r.id, batches: batchesFor(r, people), locked: true, leftover: false, note: null })
  }

  // Leftover options: the previous day's dinner, if one is planned.
  const prevDinner = ctx.plan.meals.find((m) => m.day === day - 1 && m.slot === 'dinner' && m.recipe_id && !m.leftover)
  const sorted = choices
    .map((r) => ({ r, c: mealCost(r, batchesFor(r, people), ctx.book) }))
    .sort((a, b) => a.c.cost - b.c.cost)

  return (
    <div className={'meal' + (meal?.locked ? ' locked' : '')}>
      <span className="meal-slot">{SLOT_LABEL[slot]}</span>
      <div className="meal-main">
        {picking ? (
          <select autoFocus aria-label={`Choose ${SLOT_LABEL[slot].toLowerCase()}`} defaultValue="" onChange={(e) => choose(e.target.value)} onBlur={() => setPicking(false)}>
            <option value="" disabled>
              Choose…
            </option>
            {prevDinner && <option value={'__left:' + prevDinner.recipe_id}>Leftovers: {byId.get(prevDinner.recipe_id!)?.title}</option>}
            <option value="__note">Something else (type it)…</option>
            <option value="">Nothing planned</option>
            <optgroup label={`${SLOT_LABEL[slot]} recipes, cheapest first`}>
              {sorted.map(({ r, c }) => (
                <option key={r.id} value={r.id}>
                  {r.title} · {money(c.cost)}
                  {c.unknown ? ' +?' : ''}
                </option>
              ))}
            </optgroup>
            <optgroup label="Any recipe">
              {ctx.data.recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </optgroup>
          </select>
        ) : meal?.note ? (
          <span className="meal-title">{meal.note}</span>
        ) : recipe ? (
          <button className="meal-title link" onClick={() => go(recipe.id)}>
            {meal?.leftover ? 'Leftovers: ' : ''}
            {recipe.title}
          </button>
        ) : (
          <span className="meal-title muted">Nothing planned</span>
        )}
        {!picking && cost && (
          <span className="meal-meta">
            {money(cost.cost)}
            {cost.unknown ? ` + ${cost.unknown} unpriced` : ''}
            {meal && meal.batches > 1 ? ` · ${meal.batches}× recipe` : ''}
            {spare >= people ? ` · leftovers for ${Math.floor(spare / people)} more meal${spare >= 2 * people ? 's' : ''}` : ''}
          </span>
        )}
      </div>
      <div className="meal-actions">
        {meal && (
          <button
            className={'icon-btn' + (meal.locked ? ' on' : '')}
            aria-pressed={meal.locked}
            title={meal.locked ? 'Locked: kept when rebuilding' : 'Lock to keep it when rebuilding'}
            aria-label={meal.locked ? 'Unlock this meal' : 'Lock this meal'}
            onClick={() => onChange({ ...meal, locked: !meal.locked })}
          >
            {meal.locked ? '🔒' : '🔓'}
          </button>
        )}
        <button className="icon-btn" title="Change this meal" aria-label="Change this meal" onClick={() => setPicking(true)}>
          ✎
        </button>
      </div>
    </div>
  )
}
