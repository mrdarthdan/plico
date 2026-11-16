// What cooking a meal takes out of the pantry. Each ingredient is matched to
// its grocery item and taken from that item's lots, the one with the earliest
// use-by date first, so the oldest food gets used up.

import { ingredientKey } from './ingredients'
import type { PriceBook } from './planner'
import type { GroceryItem, PantryRow, Recipe } from './types'
import { convertStd, normalizeUnit, toPackageUnits } from './units'

/** One amount taken from one lot, with what's needed to put it back. */
export interface Take {
  lot: number
  /** In the lot's own unit. */
  qty: number
  item: number
  unit: string
  location: string
  expires: string | null
}

export type UseReason = 'no-item' | 'not-in-pantry' | 'no-amount' | 'no-conversion'

export interface UseLine {
  /** The ingredient as the recipe writes it, with its amount. */
  text: string
  item: GroceryItem | null
  /** Amount needed, in the item's package unit; null if it can't be worked out. */
  need: number | null
  takes: Take[]
  /** What the pantry was short by, in the item's package unit. */
  short: number
  /** Why nothing (or not everything) is taken, if so. */
  reason: UseReason | null
}

function lotToItem(qty: number, lot: PantryRow, item: GroceryItem): number | null {
  return toPackageUnits(qty, lot.unit, item.package_unit, item.conversions)
}
function itemToLot(qty: number, lot: PantryRow, item: GroceryItem): number | null {
  if (lot.unit === item.package_unit) return qty
  const direct = convertStd(qty, item.package_unit, lot.unit)
  if (direct != null) return direct
  // Lot in a unit only an item conversion understands: invert it.
  const one = lotToItem(1, lot, item)
  return one ? qty / one : null
}

const byUseBy = (a: PantryRow, b: PantryRow) =>
  (a.expires ?? '9999-12-31').localeCompare(b.expires ?? '9999-12-31') || a.id - b.id

/**
 * Works out what cooking `recipe` `batches` times takes from the pantry.
 * Nothing is changed: the result is shown for checking, then applied.
 */
export function planCooking(recipe: Recipe, batches: number, book: PriceBook, pantry: PantryRow[]): UseLine[] {
  const left = new Map(pantry.map((l) => [l.id, l.qty]))
  const lines: UseLine[] = []
  for (const g of recipe.ingredients) {
    for (const ing of g.items) {
      const key = ingredientKey(ing.item)
      if (!key || book.ignored.has(key)) continue
      const qty = ing.qty == null ? null : ing.qty * batches
      const text = `${qty == null ? '' : `${Math.round(qty * 100) / 100} ${ing.unit ? normalizeUnit(ing.unit) + ' ' : ''}`}${ing.item}`.trim()
      const item = book.resolve(key)
      if (!item) {
        lines.push({ text, item: null, need: null, takes: [], short: 0, reason: 'no-item' })
        continue
      }
      const need = qty == null ? null : toPackageUnits(qty, ing.unit, item.package_unit, item.conversions)
      const lots = pantry.filter((l) => l.grocery_item_id === item.id && (left.get(l.id) ?? 0) > 0).sort(byUseBy)
      if (!lots.length) {
        lines.push({ text, item, need, takes: [], short: need ?? 0, reason: 'not-in-pantry' })
        continue
      }
      if (qty == null) {
        lines.push({ text, item, need: null, takes: [], short: 0, reason: 'no-amount' })
        continue
      }
      if (need == null) {
        lines.push({ text, item, need: null, takes: [], short: 0, reason: 'no-conversion' })
        continue
      }
      let still = need
      const takes: Take[] = []
      for (const lot of lots) {
        if (still <= 1e-9) break
        const remaining = left.get(lot.id) ?? 0
        const available = lotToItem(remaining, lot, item)
        if (available == null || available <= 0) continue
        const takeItem = Math.min(still, available)
        let takeLot = itemToLot(takeItem, lot, item)
        if (takeLot == null) continue
        takeLot = Math.min(remaining, Math.round(takeLot * 1000) / 1000)
        if (takeLot <= 0) continue
        takes.push({ lot: lot.id, qty: takeLot, item: item.id, unit: lot.unit, location: lot.location, expires: lot.expires })
        left.set(lot.id, remaining - takeLot)
        still -= takeItem
      }
      const short = Math.max(0, Math.round(still * 1000) / 1000)
      lines.push({ text, item, need, takes, short, reason: takes.length ? null : 'no-conversion' })
    }
  }
  return lines
}

/** Merges the takes of the chosen lines into one amount per lot, ready for the database. */
export function mergeTakes(lines: UseLine[]): Take[] {
  const byLot = new Map<number, Take>()
  for (const l of lines) {
    for (const t of l.takes) {
      const prev = byLot.get(t.lot)
      byLot.set(t.lot, prev ? { ...prev, qty: Math.round((prev.qty + t.qty) * 1000) / 1000 } : { ...t })
    }
  }
  return [...byLot.values()]
}
