import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addDays, buildWeek, extrasTotal, makePriceBook, money, shoppingList, stockFrom, today, weekLabel, weekStartOf,
  type Stock,
} from '../../lib/planner'
import {
  loadBarcodes, loadGroceryItems, loadPantry, loadPlan, loadPlannerSettings, recentRecipeIds, savePlan,
} from '../../lib/plannerApi'
import type { Barcode, GroceryItem, MealPlan, PantryRow, PlannerSettings, RecipeBoxData } from '../../lib/types'
import { go } from '../../lib/useHash'
import { PantryView } from './PantryView'
import { PricesView } from './PricesView'
import { ShoppingView } from './ShoppingView'
import { WeekView } from './WeekView'

export type PlannerTab = 'week' | 'list' | 'pantry' | 'prices'

// Kept while the page stays open, so switching tabs keeps the week you were on.
let rememberedWeek: string | null = null

export interface PlannerContext {
  data: RecipeBoxData
  settings: PlannerSettings
  items: GroceryItem[]
  setItems: (items: GroceryItem[]) => void
  reloadItems: () => Promise<void>
  setSettings: (s: PlannerSettings) => void
  pantry: PantryRow[]
  barcodes: Barcode[]
  /** Reloads grocery items, pantry and barcodes together. */
  reloadStock: () => Promise<void>
  stock: Stock
  plan: MealPlan
  updatePlan: (next: MealPlan) => void
  favorites: Set<string>
  recent: Set<string>
  book: ReturnType<typeof makePriceBook>
  list: ReturnType<typeof shoppingList>
  total: number
  onError: (m: string | null) => void
}

export function Planner({ tab, data, favorites }: { tab: PlannerTab; data: RecipeBoxData; favorites: Set<string> }) {
  const [settings, setSettings] = useState<PlannerSettings | null>(null)
  const [items, setItems] = useState<GroceryItem[] | null>(null)
  const [pantry, setPantry] = useState<PantryRow[]>([])
  const [barcodes, setBarcodes] = useState<Barcode[]>([])
  const [week, setWeekState] = useState<string | null>(rememberedWeek)
  const [plan, setPlan] = useState<MealPlan | null>(null)
  const [recent, setRecent] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const setWeek = (w: string) => {
    rememberedWeek = w
    setWeekState(w)
  }

  const reloadItems = useCallback(async () => {
    setItems(await loadGroceryItems())
  }, [])
  const reloadStock = useCallback(async () => {
    const [i, p, b] = await Promise.all([loadGroceryItems(), loadPantry(), loadBarcodes()])
    setItems(i)
    setPantry(p)
    setBarcodes(b)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const s = await loadPlannerSettings()
        setSettings(s)
        if (!rememberedWeek) setWeek(weekStartOf(new Date(), s.week_starts_on))
        await reloadStock()
      } catch (e) {
        setError((e as Error).message)
      }
    })()
  }, [reloadStock])

  useEffect(() => {
    if (!week || !settings) return
    let stale = false
    setPlan(null)
    void (async () => {
      try {
        const [p, r] = await Promise.all([loadPlan(week), recentRecipeIds([addDays(week, -7), addDays(week, -14)])])
        if (stale) return
        setRecent(r)
        setPlan(
          p ? { ...p, stocked: p.stocked ?? [] } : {
            week_start: week, budget: settings.weekly_budget, household_size: settings.household_size,
            meals: [], checked: [], extras: [], stocked: [],
          },
        )
      } catch (e) {
        if (!stale) setError((e as Error).message)
      }
    })()
    return () => {
      stale = true
    }
    // Only the week matters here; settings changes don't reload the plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, !!settings])

  const book = useMemo(() => makePriceBook(items ?? [], settings?.ignored ?? []), [items, settings])
  const byId = useMemo(() => new Map(data.recipes.map((r) => [r.id, r])), [data.recipes])
  const stock = useMemo(() => stockFrom(items ?? [], pantry, today()), [items, pantry])
  const list = useMemo(() => shoppingList(plan?.meals ?? [], byId, book, stock), [plan, byId, book, stock])

  const updatePlan = (next: MealPlan) => {
    setPlan(next)
    setError(null)
    savePlan(next).catch((e: Error) => setError("Couldn't save: " + e.message))
  }

  const tabs: [PlannerTab, string, string][] = [
    ['week', 'Week', 'planner'],
    ['list', 'Shopping list', 'planner-list'],
    ['pantry', 'Pantry', 'planner-pantry'],
    ['prices', 'Prices', 'planner-prices'],
  ]

  let body
  if (!settings || !items || !plan || !week) {
    body = error ? null : <p className="hint">Loading the planner…</p>
  } else {
    const ctx: PlannerContext = {
      data, settings, items, setItems, reloadItems, setSettings, pantry, barcodes, reloadStock, stock,
      plan, updatePlan, favorites, recent, book, list,
      total: list.total + extrasTotal(plan), onError: setError,
    }
    body = (
      <>
        <div className="week-nav">
          <button className="btn ghost" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}>
            ‹
          </button>
          <strong>{weekLabel(week)}</strong>
          <button className="btn ghost" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}>
            ›
          </button>
          {week !== weekStartOf(new Date(), settings.week_starts_on) && (
            <button className="link" onClick={() => setWeek(weekStartOf(new Date(), settings.week_starts_on))}>
              This week
            </button>
          )}
        </div>
        {tab === 'week' && (
          <WeekView
            ctx={ctx}
            rebuild={() =>
              buildWeek({
                recipes: data.recipes, sections: data.sections, settings, budget: plan.budget,
                people: plan.household_size, existing: plan.meals, favorites, recent, book, stock,
                seed: Date.now() % 2147483647,
              })
            }
          />
        )}
        {tab === 'list' && <ShoppingView ctx={ctx} />}
        {tab === 'pantry' && <PantryView ctx={ctx} />}
        {tab === 'prices' && <PricesView ctx={ctx} />}
      </>
    )
  }

  return (
    <>
      <button className="back" onClick={() => go('')}>
        ← All recipes
      </button>
      <div className="panel wide">
        <h1>Meal planner</h1>
        <nav className="chips" aria-label="Meal planner">
          {tabs.map(([t, label, hash]) => (
            <button key={t} className="chip" aria-pressed={tab === t} onClick={() => go(hash)}>
              {label}
            </button>
          ))}
        </nav>
        {error && <p className="msg err">{error}</p>}
        {body}
      </div>
    </>
  )
}

/** Budget meter shared by the week and the shopping list. */
export function BudgetMeter({ total, budget, unknown }: { total: number; budget: number; unknown: number }) {
  const over = total > budget
  const pct = budget > 0 ? Math.min(100, (total / budget) * 100) : 100
  return (
    <div className="budget">
      <div className="budget-line">
        <span>
          Shopping estimate <strong>{money(total)}</strong> of {money(budget)}
        </span>
        <span className={over ? 'over' : 'under'}>
          {over ? `${money(total - budget)} over` : `${money(budget - total)} left`}
        </span>
      </div>
      <div className={'progress' + (over ? ' over' : '')}>
        <div style={{ width: pct + '%' }} />
      </div>
      {unknown > 0 && (
        <p className="hint">
          {unknown} item{unknown === 1 ? ' has' : 's have'} no price yet, so the real total is higher.{' '}
          <button className="link" onClick={() => go('planner-prices')}>
            Price them
          </button>
        </p>
      )}
    </div>
  )
}
