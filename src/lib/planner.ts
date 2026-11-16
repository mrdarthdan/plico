// The meal planner's arithmetic: what a meal costs, what a week's shopping
// list holds, and how a week gets filled within a budget. Pure functions, so
// they can be tested without a database.

import { ingredientKey, makeResolver } from './ingredients'
import { normalizeUnit, toPackageUnits } from './units'
import type { GroceryItem, MealPlan, PlannedMeal, PlannerSettings, Recipe, Section, Slot } from './types'

export const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner']
export const SLOT_LABEL: Record<Slot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' }

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

export interface PriceBook {
  resolve: (key: string) => GroceryItem | null
  ignored: Set<string>
}

export function makePriceBook(items: GroceryItem[], ignored: string[]): PriceBook {
  return { resolve: makeResolver(items), ignored: new Set(ignored.map(ingredientKey)) }
}

export type Problem = 'no-item' | 'no-price' | 'no-conversion'

interface Need {
  key: string
  text: string
  qty: number | null
  unit: string
  recipe: string
}

function needsOf(r: Recipe, batches: number, book: PriceBook): Need[] {
  const out: Need[] = []
  for (const g of r.ingredients) {
    for (const i of g.items) {
      const key = ingredientKey(i.item)
      if (!key || book.ignored.has(key)) continue
      out.push({ key, text: i.item, qty: i.qty == null ? null : i.qty * batches, unit: i.unit, recipe: r.title })
    }
  }
  return out
}

/** How many times to cook a recipe so everyone gets a serving. */
export function batchesFor(r: Recipe, people: number): number {
  return r.serves ? Math.max(1, Math.ceil(people / r.serves)) : 1
}

/** Servings left over after everyone has eaten once. */
export function leftoverServings(r: Recipe, batches: number, people: number): number {
  return r.serves ? r.serves * batches - people : 0
}

/**
 * What one meal uses, priced by the share of each package it takes. Staples
 * count as free. `unknown` counts ingredients that couldn't be priced.
 */
export function mealCost(r: Recipe, batches: number, book: PriceBook): { cost: number; unknown: number } {
  let cost = 0
  let unknown = 0
  for (const n of needsOf(r, batches, book)) {
    const it = book.resolve(n.key)
    if (it?.staple) continue
    if (!it || it.price == null) {
      unknown++
      continue
    }
    if (n.qty == null) continue
    const used = toPackageUnits(n.qty, n.unit, it.package_unit, it.conversions)
    if (used == null) unknown++
    else cost += (used / it.package_qty) * it.price
  }
  return { cost, unknown }
}

// ---------------------------------------------------------------------------
// Shopping list
// ---------------------------------------------------------------------------

export interface ShoppingLine {
  /** Stable id for ticking off: "i<item id>" or "k<ingredient key>". */
  key: string
  name: string
  category: string
  item: GroceryItem | null
  /** Total in the item's package unit. 0 when nothing could be measured. */
  needed: number
  packages: number
  /** packages × price; null when there is no item or no price. */
  cost: number | null
  staple: boolean
  /** "2 cup · Chili" for each use, to show where the need comes from. */
  uses: string[]
  problems: Problem[]
  /** Recipe units that couldn't be converted to the package unit. */
  missingUnits: string[]
}

export interface ShoppingList {
  lines: ShoppingLine[]
  /** Estimated cost of everything priced, staples excluded. */
  total: number
  /** Lines that still need an item, a price or a conversion. */
  unknown: number
}

export function shoppingList(meals: PlannedMeal[], recipes: Map<string, Recipe>, book: PriceBook): ShoppingList {
  const lines = new Map<string, ShoppingLine & { unmeasured: boolean }>()
  for (const m of meals) {
    if (m.leftover || !m.recipe_id) continue
    const r = recipes.get(m.recipe_id)
    if (!r) continue
    for (const n of needsOf(r, m.batches, book)) {
      const it = book.resolve(n.key)
      const key = it ? 'i' + it.id : 'k' + n.key
      let line = lines.get(key)
      if (!line) {
        line = {
          key,
          name: it ? it.name : n.key,
          category: it?.category || (it ? 'Other' : 'Not matched yet'),
          item: it,
          needed: 0,
          packages: 0,
          cost: null,
          staple: !!it?.staple,
          uses: [],
          problems: [],
          missingUnits: [],
          unmeasured: false,
        }
        lines.set(key, line)
      }
      const amt = n.qty == null ? '' : `${round(n.qty)}${n.unit ? ' ' + normalizeUnit(n.unit) : ''} `
      line.uses.push(`${amt}${n.text} · ${n.recipe}`.trim())
      if (!it) {
        if (!line.problems.includes('no-item')) line.problems.push('no-item')
        continue
      }
      if (n.qty == null) {
        line.unmeasured = true
        continue
      }
      const used = toPackageUnits(n.qty, n.unit, it.package_unit, it.conversions)
      if (used == null) {
        if (!line.problems.includes('no-conversion')) line.problems.push('no-conversion')
        const u = normalizeUnit(n.unit)
        if (!line.missingUnits.includes(u)) line.missingUnits.push(u)
        line.unmeasured = true
      } else line.needed += used
    }
  }

  let total = 0
  let unknown = 0
  const out: ShoppingLine[] = []
  for (const { unmeasured, ...line } of lines.values()) {
    const it = line.item
    if (it) {
      line.packages = Math.ceil(line.needed / it.package_qty - 1e-6)
      // Something was needed but couldn't be measured: assume one package.
      if (line.packages === 0 && unmeasured) line.packages = 1
      if (it.price == null) line.problems.push('no-price')
      else line.cost = line.packages * it.price
    }
    if (!line.staple) {
      if (line.cost != null) total += line.cost
      if (line.problems.length) unknown++
    }
    out.push(line)
  }
  out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  return { lines: out, total, unknown }
}

export function extrasTotal(plan: Pick<MealPlan, 'extras'>): number {
  return plan.extras.reduce((s, e) => s + (e.cost ?? 0), 0)
}

// ---------------------------------------------------------------------------
// Which recipes suit which meal
// ---------------------------------------------------------------------------

const GUESS: Record<Slot, RegExp> = {
  breakfast: /breakfast|brunch/i,
  lunch: /lunch|soup|stew|salad|sandwich|main|entr[eé]e/i,
  dinner: /dinner|supper|main|entr[eé]e|soup|stew|casserole/i,
}

/** The sections feeding each meal: as set in the planner settings, or guessed from section names. */
export function slotSections(settings: PlannerSettings, sections: Section[]): Record<Slot, number[]> {
  const out = {} as Record<Slot, number[]>
  for (const s of SLOTS) {
    const chosen = settings.slots[s]?.sections ?? []
    out[s] = chosen.length ? chosen : sections.filter((x) => GUESS[s].test(x.name)).map((x) => x.id)
  }
  return out
}

// ---------------------------------------------------------------------------
// Building a week
// ---------------------------------------------------------------------------

export interface BuildInput {
  recipes: Recipe[]
  sections: Section[]
  settings: PlannerSettings
  budget: number
  people: number
  /** The week's current meals; locked ones are kept as they are. */
  existing: PlannedMeal[]
  favorites: Set<string>
  /** Recipes planned recently, to rest them for a week. */
  recent: Set<string>
  book: PriceBook
  seed: number
}

export interface BuildResult {
  meals: PlannedMeal[]
  total: number
  unknown: number
  overBudget: boolean
}

/**
 * Fills every planned meal that isn't locked. Each pick weighs cost against
 * the budget, favorites, variety and a little chance; a dinner that makes
 * enough leftovers becomes the next day's lunch. If the shopping list comes
 * out over budget, it tries again leaning harder on cost.
 */
export function buildWeek(input: BuildInput): BuildResult {
  const byId = new Map(input.recipes.map((r) => [r.id, r]))
  let best: BuildResult | null = null
  for (const lean of [1, 2, 4, 8, 16]) {
    const meals = fillWeek(input, lean)
    const list = shoppingList(meals, byId, input.book)
    const result = { meals, total: list.total, unknown: list.unknown, overBudget: list.total > input.budget }
    if (!best || result.total < best.total) best = result
    if (!result.overBudget) return result
  }
  return best!
}

function fillWeek(input: BuildInput, costLean: number): PlannedMeal[] {
  const { settings, people, book, favorites, recent } = input
  const rand = rng(input.seed)
  const pools = slotSections(settings, input.sections)
  const candidates = {} as Record<Slot, { r: Recipe; batches: number; cost: number; unknown: number }[]>
  for (const s of SLOTS) {
    const secs = new Set(pools[s])
    candidates[s] = input.recipes
      .filter((r) => secs.has(r.section_id))
      .map((r) => {
        const batches = batchesFor(r, people)
        return { r, batches, ...mealCost(r, batches, book) }
      })
  }
  const on = SLOTS.filter((s) => settings.slots[s]?.on)
  // Roughly what one cooked meal may cost: lunches are often leftovers.
  const cooked = on.reduce((n, s) => n + (s === 'lunch' && on.includes('dinner') ? 3.5 : 7), 0)
  const target = Math.max(input.budget / Math.max(cooked, 1), 0.01)

  const locked = new Map(input.existing.filter((m) => m.locked).map((m) => [m.day + m.slot, m]))
  const used = new Map<string, number>()
  for (const m of locked.values()) if (m.recipe_id && !m.leftover) used.set(m.recipe_id, (used.get(m.recipe_id) ?? 0) + 1)

  const meals: PlannedMeal[] = []
  let leftoverFrom: string | null = null
  for (let day = 0; day < 7; day++) {
    for (const slot of on) {
      const keep = locked.get(day + slot)
      if (keep) {
        meals.push(keep)
        if (slot === 'lunch') leftoverFrom = null
      } else if (slot === 'lunch' && leftoverFrom) {
        meals.push({ day, slot, recipe_id: leftoverFrom, batches: 0, locked: false, leftover: true, note: null })
        leftoverFrom = null
      } else {
        let pick: (typeof candidates)[Slot][number] | null = null
        let bestScore = Infinity
        for (const c of candidates[slot]) {
          const score =
            (c.cost / target) * costLean +
            (used.get(c.r.id) ?? 0) * 1.5 +
            (recent.has(c.r.id) ? 0.5 : 0) -
            (favorites.has(c.r.id) ? 0.4 : 0) +
            c.unknown * 0.15 +
            rand() * 0.8
          if (score < bestScore) {
            bestScore = score
            pick = c
          }
        }
        meals.push({
          day, slot, recipe_id: pick?.r.id ?? null, batches: pick?.batches ?? 1, locked: false, leftover: false, note: null,
        })
        if (pick) used.set(pick.r.id, (used.get(pick.r.id) ?? 0) + 1)
      }
      if (slot === 'dinner') {
        const m = meals[meals.length - 1]
        const r = m.recipe_id ? input.recipes.find((x) => x.id === m.recipe_id) : undefined
        leftoverFrom = r && !m.leftover && leftoverServings(r, m.batches, people) >= people ? r.id : null
      }
    }
  }
  return meals
}

/** Small seeded random number generator (mulberry32), so a rebuild is repeatable for a given seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Weeks
// ---------------------------------------------------------------------------

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function parse(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** The first day of the week holding `date`, as YYYY-MM-DD. */
export function weekStartOf(date: Date, startsOn: number): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - ((d.getDay() - startsOn + 7) % 7))
  return iso(d)
}

export function addDays(isoDate: string, n: number): string {
  const d = parse(isoDate)
  d.setDate(d.getDate() + n)
  return iso(d)
}

/** "Sun 16" for the nth day of a week. */
export function dayLabel(weekStart: string, n: number): string {
  const d = parse(addDays(weekStart, n))
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
}

export function weekLabel(weekStart: string): string {
  const a = parse(weekStart)
  const b = parse(addDays(weekStart, 6))
  const f = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${f(a)} – ${f(b)}`
}

export function money(n: number): string {
  return '$' + n.toFixed(2)
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
