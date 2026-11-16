import { describe, expect, it } from 'vitest'
import { mergeTakes, planCooking } from './cooking'
import { makePriceBook } from './planner'
import type { GroceryItem, PantryRow, Recipe } from './types'

const item = (id: number, name: string, extra: Partial<GroceryItem> = {}): GroceryItem => ({
  id, name, category: null, package_qty: 1, package_unit: 'each', price: 1, price_source: null, price_updated_at: null,
  conversions: {}, staple: false, aliases: [], kroger_product_id: null, kroger_label: null, kroger_regular: null,
  kroger_promo: null, kroger_promo_ends: null, kroger_checked_at: null, ...extra,
})
const lot = (id: number, item: number, qty: number, unit: string, expires: string | null = null): PantryRow => ({
  id, grocery_item_id: item, qty, unit, location: 'Pantry', expires,
})

const items = [
  item(1, 'flour', { package_qty: 5, package_unit: 'lb', conversions: { cup: 0.28 } }),
  item(2, 'egg', { package_qty: 12 }),
  item(3, 'milk', { package_qty: 1, package_unit: 'gal' }),
  item(4, 'salt', { staple: true }),
]
const book = makePriceBook(items, ['water'])

const pancakes: Recipe = {
  id: 'pancakes', title: 'Pancakes', section_id: 1, serves: 4, time: null, description: null, steps: [], notes: [], tags: [],
  source_url: null, added: '2026-01-01', contributor: null,
  ingredients: [{
    name: '',
    items: [
      { qty: 2, unit: 'cups', item: 'all-purpose flour' },
      { qty: 3, unit: '', item: 'large eggs' },
      { qty: 2, unit: 'cups', item: 'milk' },
      { qty: null, unit: '', item: 'salt' },
      { qty: 1, unit: 'cup', item: 'water' },
      { qty: 1, unit: 'tbsp', item: 'baking powder' },
    ],
  }],
}

describe('planCooking', () => {
  const pantry = [
    lot(10, 1, 32, 'oz'), // 2 lb of flour, no date
    lot(11, 2, 2, 'each', '2026-11-20'), // 2 eggs, older
    lot(12, 2, 12, 'each', '2026-12-05'), // a dozen, newer
    lot(13, 3, 0.0625, 'gal', '2026-11-18'), // a cup of milk
    lot(14, 4, 26, 'oz'),
  ]
  const lines = planCooking(pancakes, 1, book, pantry)
  const find = (name: string) => lines.find((l) => l.text.includes(name))!

  it('converts recipe amounts into each lot unit', () => {
    const flour = find('flour')
    expect(flour.takes).toEqual([{ lot: 10, qty: 8.96, item: 1, unit: 'oz', location: 'Pantry', expires: null }])
    expect(flour.reason).toBe(null)
  })

  it('takes from the soonest-expiring lot first', () => {
    const eggs = find('eggs')
    expect(eggs.takes.map((t) => [t.lot, t.qty])).toEqual([[11, 2], [12, 1]])
  })

  it('reports what the pantry is short of', () => {
    const milk = find('milk')
    expect(milk.takes[0].qty).toBe(0.0625) // all of it, never more than the lot holds
    expect(milk.short).toBeCloseTo(0.0625)
  })

  it('leaves alone what has no amount, no item, or is ignored', () => {
    expect(find('salt').reason).toBe('no-amount')
    expect(find('baking powder').reason).toBe('no-item')
    expect(lines.some((l) => l.text.includes('water'))).toBe(false)
  })

  it('doubles for two batches, without taking more than a lot holds', () => {
    const two = planCooking(pancakes, 2, book, pantry)
    const eggs = two.find((l) => l.text.includes('eggs'))!
    expect(eggs.takes.map((t) => [t.lot, t.qty])).toEqual([[11, 2], [12, 4]])
  })

  it('merges takes per lot', () => {
    const merged = mergeTakes([
      { text: 'a', item: null, need: 1, short: 0, reason: null, takes: [{ lot: 1, qty: 1, item: 1, unit: 'lb', location: 'Pantry', expires: null }] },
      { text: 'b', item: null, need: 1, short: 0, reason: null, takes: [{ lot: 1, qty: 0.5, item: 1, unit: 'lb', location: 'Pantry', expires: null }] },
    ])
    expect(merged).toEqual([{ lot: 1, qty: 1.5, item: 1, unit: 'lb', location: 'Pantry', expires: null }])
  })
})
