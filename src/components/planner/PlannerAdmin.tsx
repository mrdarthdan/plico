import { useEffect, useState } from 'react'
import { SLOTS, SLOT_LABEL, slotSections } from '../../lib/planner'
import { loadPlannerSettings, savePlannerSettings, setPlannerEnabled } from '../../lib/plannerApi'
import type { PlannerSettings, RecipeBoxData } from '../../lib/types'

/** Admin page block: turn the meal planner on or off and set household defaults. */
export function PlannerAdmin({ data, run }: { data: RecipeBoxData; run: (change: () => Promise<void>) => Promise<boolean> }) {
  const enabled = !!data.settings.planner_enabled
  const [s, setS] = useState<PlannerSettings | null>(null)
  const [saved, setSaved] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    loadPlannerSettings()
      .then(setS)
      .catch((e: Error) => setLoadError(e.message))
  }, [enabled])

  // Installs without the planner migration have no planner_enabled column.
  if (data.settings.planner_enabled === undefined) {
    return (
      <section className="admin-block">
        <h2>Meal planner</h2>
        <p className="hint">
          The meal planner needs its database tables first. Run the migration in{' '}
          <code>supabase/migrations/20261116000000_meal_planner.sql</code>; see <code>docs/meal-planner.md</code>.
        </p>
      </section>
    )
  }

  const guessed = s ? slotSections({ ...s, slots: { breakfast: { on: true, sections: [] }, lunch: { on: true, sections: [] }, dinner: { on: true, sections: [] } } }, data.sections) : null

  return (
    <section className="admin-block">
      <h2>Meal planner</h2>
      <p className="hint">
        Plans breakfast, lunch and dinner from these recipes within a weekly budget, with a priced shopping list. One
        shared plan for the household: editors and admins can use it; viewers can't see it.
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            const on = e.target.checked
            void run(() => setPlannerEnabled(on))
          }}
        />
        <span>Turn on the meal planner</span>
      </label>
      {enabled && loadError && <p className="msg err">{loadError}</p>}
      {enabled && s && guessed && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            setSaved(false)
            void run(() => savePlannerSettings(s)).then(setSaved)
          }}
        >
          <div className="row">
            <div className="field">
              <label htmlFor="ps-budget">Usual weekly budget ($)</label>
              <input id="ps-budget" type="number" min={0} step={5} value={s.weekly_budget} onChange={(e) => setS({ ...s, weekly_budget: Math.max(0, Number(e.target.value) || 0) })} />
            </div>
            <div className="field">
              <label htmlFor="ps-people">People in the household</label>
              <input id="ps-people" type="number" min={1} max={30} value={s.household_size} onChange={(e) => setS({ ...s, household_size: Math.min(30, Math.max(1, Math.round(Number(e.target.value) || 1))) })} />
            </div>
            <div className="field">
              <label htmlFor="ps-start">Weeks start on</label>
              <select id="ps-start" value={s.week_starts_on} onChange={(e) => setS({ ...s, week_starts_on: Number(e.target.value) })}>
                <option value={0}>Sunday</option>
                <option value={1}>Monday</option>
              </select>
            </div>
          </div>
          {SLOTS.map((slot) => {
            const cfg = s.slots[slot] ?? { on: true, sections: [] }
            const set = (next: typeof cfg) => setS({ ...s, slots: { ...s.slots, [slot]: next } })
            return (
              <div key={slot} className="field">
                <label className="check">
                  <input type="checkbox" checked={cfg.on} onChange={(e) => set({ ...cfg, on: e.target.checked })} />
                  <span>Plan {SLOT_LABEL[slot].toLowerCase()} from:</span>
                </label>
                {cfg.on && (
                  <div className="chips">
                    {data.sections.map((sec) => {
                      const picked = cfg.sections.length ? cfg.sections.includes(sec.id) : guessed[slot].includes(sec.id)
                      return (
                        <button
                          type="button"
                          key={sec.id}
                          className="chip"
                          aria-pressed={picked}
                          onClick={() => {
                            const base = cfg.sections.length ? cfg.sections : guessed[slot]
                            set({ ...cfg, sections: picked ? base.filter((x) => x !== sec.id) : [...base, sec.id] })
                          }}
                        >
                          {sec.name}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
          <div className="actions">
            <button className="btn" type="submit">
              Save planner settings
            </button>
            {saved && <span className="hint">Saved.</span>}
          </div>
        </form>
      )}
    </section>
  )
}
