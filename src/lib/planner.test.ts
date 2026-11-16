import { describe, expect, it } from 'vitest'
import { ingredientKey, makeResolver } from './ingredients'
import { buildWeek, makePriceBook, mealCost, shoppingList, stockFrom, weekStartOf } from './planner'
import type { GroceryItem, PlannerSettings, Recipe } from './types'
import { normalizeUnit, toPackageUnits } from './units'

const item = (id: number, name: string, extra: Partial<GroceryItem> = {}): GroceryItem => ({
  id, name, category: null, package_qty: 1, package_unit: 'each', price: 1, price_source: 'manual',
  price_updated_at: null, conversions: {}, staple: false, aliases: [], kroger_product_id: null, kroger_label: null,
  kroger_regular: null, kroger_promo: null, kroger_promo_ends: null, kroger_checked_at: null, ...extra,
})

const recipe = (id: string, section_id: number, serves: number, items: [number | null, string, string][]): Recipe => ({
  id, title: id, section_id, serves, time: null, description: null, steps: [], notes: [], tags: [],
  source_url: null, added: '2026-01-01', contributor: null,
  ingredients: [{ name: '', items: items.map(([qty, unit, it]) => ({ qty, unit, item: it })) }],
})

describe('ingredientKey', () => {
  it('drops notes, preparation and packaging', () => {
    expect(ingredientKey('garlic, minced (¼ tsp. granulated)')).toBe('garlic')
    expect(ingredientKey('(14.5-ounce) cans diced tomatoes with basil')).toBe('diced tomato with basil')
    expect(ingredientKey('black beans (15 oz.), drained')).toBe('black bean')
    expect(ingredientKey('Freshly grated Parmesan')).toBe('grated parmesan')
    expect(ingredientKey('8 oz. can tomato sauce')).toBe('tomato sauce')
    expect(ingredientKey('boneless, skinless chicken breasts')).toBe('boneless skinless chicken breast')
    expect(ingredientKey('large eggs')).toBe('egg')
    expect(ingredientKey('red potatoes cut into bite-sized pieces')).toBe('red potato')
  })
})

describe('units', () => {
  it('normalizes spellings', () => {
    expect(normalizeUnit('Tbsp.')).toBe('tbsp')
    expect(normalizeUnit('cups')).toBe('cup')
    expect(normalizeUnit('')).toBe('each')
  })
  it('converts within a kind and through item conversions', () => {
    expect(toPackageUnits(16, 'oz', 'lb', {})).toBeCloseTo(1)
    expect(toPackageUnits(2, 'cans', 'each', {})).toBe(2)
    expect(toPackageUnits(2, 'cup', 'lb', {})).toBeNull()
    expect(toPackageUnits(2, 'cup', 'lb', { cup: 0.28 })).toBeCloseTo(0.56)
    expect(toPackageUnits(8, 'tbsp', 'lb', { cup: 0.28 })).toBeCloseTo(0.14)
    expect(toPackageUnits(8, 'oz', 'fl oz', {})).toBeCloseTo(8)
  })
})

describe('matching', () => {
  it('prefers aliases, then the longest name inside the key', () => {
    const resolve = makeResolver([item(1, 'sugar'), item(2, 'brown sugar'), item(3, 'flour', { aliases: ['all purpose flour'] })])
    expect(resolve('light brown sugar')?.id).toBe(2)
    expect(resolve('sugar')?.id).toBe(1)
    expect(resolve('all purpose flour')?.id).toBe(3)
    expect(resolve('powdered milk')).toBeNull()
  })
})

const settings: PlannerSettings = {
  weekly_budget: 100, household_size: 4, week_starts_on: 0, ignored: ['water'], kroger_location_id: null, kroger_store: null,
  slots: { breakfast: { on: true, sections: [1] }, lunch: { on: true, sections: [2] }, dinner: { on: true, sections: [2] } },
}

describe('costs and shopping', () => {
  const book = makePriceBook(
    [
      item(1, 'flour', { package_qty: 5, package_unit: 'lb', price: 4, conversions: { cup: 0.28 } }),
      item(2, 'egg', { package_qty: 12, price: 3 }),
      item(3, 'salt', { staple: true }),
    ],
    ['water'],
  )
  const pancakes = recipe('pancakes', 1, 4, [[2, 'cups', 'all-purpose flour'], [2, '', 'eggs'], [1, 'tsp', 'salt'], [1, 'cup', 'water'], [1, 'cup', 'milk']])

  it('prices a meal by the share of each package', () => {
    const c = mealCost(pancakes, 1, book)
    expect(c.cost).toBeCloseTo((0.56 / 5) * 4 + (2 / 12) * 3)
    expect(c.unknown).toBe(1) // milk has no item
  })

  it('buys whole packages and flags what needs attention', () => {
    const list = shoppingList(
      [
        { day: 0, slot: 'breakfast', recipe_id: 'pancakes', batches: 1, locked: false, leftover: false, note: null },
        { day: 1, slot: 'breakfast', recipe_id: 'pancakes', batches: 1, locked: false, leftover: true, note: null },
      ],
      new Map([['pancakes', pancakes]]),
      book,
    )
    const egg = list.lines.find((l) => l.name === 'egg')!
    expect(egg.packages).toBe(1)
    expect(list.total).toBeCloseTo(4 + 3)
    expect(list.lines.find((l) => l.name === 'milk')?.problems).toEqual(['no-item'])
    expect(list.lines.some((l) => l.name === 'water')).toBe(false)
    expect(list.unknown).toBe(1)
  })
})

describe('buildWeek', () => {
  const book = makePriceBook([item(1, 'steak', { price: 20 }), item(2, 'bean', { price: 1 }), item(3, 'oat', { price: 2 })], [])
  const recipes = [
    recipe('oatmeal', 1, 4, [[1, '', 'oats']]),
    recipe('steak-dinner', 2, 4, [[2, '', 'steak']]),
    recipe('bean-pot', 2, 8, [[2, 'cans', 'beans']]),
  ]
  const base = {
    recipes, sections: [], settings, people: 4, existing: [], favorites: new Set<string>(), recent: new Set<string>(), book, seed: 7,
  }

  it('fills every meal and uses big batches for the next lunch', () => {
    const r = buildWeek({ ...base, budget: 1000 })
    expect(r.meals).toHaveLength(21)
    expect(r.meals.every((m) => m.recipe_id)).toBe(true)
    for (const m of r.meals.filter((x) => x.leftover)) {
      const dinner = r.meals.find((x) => x.day === m.day - 1 && x.slot === 'dinner')!
      expect(dinner.recipe_id).toBe('bean-pot')
      expect(m.recipe_id).toBe('bean-pot')
    }
  })

  it('leans on cheap recipes to fit a tight budget', () => {
    const r = buildWeek({ ...base, budget: 40 })
    expect(r.overBudget).toBe(false)
    expect(r.meals.some((m) => m.recipe_id === 'steak-dinner')).toBe(false)
  })

  it('keeps locked meals', () => {
    const lockedMeal = { day: 3, slot: 'dinner' as const, recipe_id: 'steak-dinner', batches: 1, locked: true, leftover: false, note: null }
    const r = buildWeek({ ...base, budget: 40, existing: [lockedMeal] })
    expect(r.meals.find((m) => m.day === 3 && m.slot === 'dinner')).toEqual(lockedMeal)
  })
})

describe('weekStartOf', () => {
  it('finds the Sunday or Monday on or before a date', () => {
    expect(weekStartOf(new Date(2026, 10, 18), 0)).toBe('2026-11-15')
    expect(weekStartOf(new Date(2026, 10, 18), 1)).toBe('2026-11-16')
    expect(weekStartOf(new Date(2026, 10, 15), 1)).toBe('2026-11-09')
  })
})

describe('stock', () => {
  const items = [
    item(1, 'flour', { package_qty: 5, package_unit: 'lb', price: 4, conversions: { cup: 0.28 } }),
    item(2, 'egg', { package_qty: 12, price: 3 }),
    item(3, 'spinach', { package_qty: 10, package_unit: 'oz', price: 3 }),
  ]
  const book = makePriceBook(items, [])
  const pantry = [
    { id: 1, grocery_item_id: 2, qty: 6, unit: 'each', location: 'Fridge', expires: '2026-11-30' },
    { id: 2, grocery_item_id: 1, qty: 32, unit: 'oz', location: 'Pantry', expires: null },
    { id: 3, grocery_item_id: 3, qty: 10, unit: 'oz', location: 'Fridge', expires: '2026-11-17' },
  ]
  const stock = stockFrom(items, pantry, '2026-11-15')

  it('adds up lots in the package unit and spots what expires soon', () => {
    expect(stock.get(1)?.qty).toBeCloseTo(2)
    expect(stock.get(2)?.expiringSoon).toBe(false)
    expect(stock.get(3)?.expiringSoon).toBe(true)
  })

  it('only buys what the pantry is short of', () => {
    const omelet = recipe('omelet', 1, 2, [[8, '', 'eggs'], [5, 'oz', 'spinach']])
    const list = shoppingList(
      [{ day: 0, slot: 'breakfast', recipe_id: 'omelet', batches: 1, locked: false, leftover: false, note: null }],
      new Map([['omelet', omelet]]),
      book,
      stock,
    )
    const egg = list.lines.find((l) => l.name === 'egg')!
    expect(egg.onHand).toBe(6)
    expect(egg.packages).toBe(1)
    const spinach = list.lines.find((l) => l.name === 'spinach')!
    expect(spinach.packages).toBe(0)
    expect(list.total).toBeCloseTo(3)
  })

  it('counts pantry stock as already paid for when costing a meal', () => {
    const omelet = recipe('omelet', 1, 2, [[6, '', 'eggs'], [5, 'oz', 'spinach']])
    const c = mealCost(omelet, 1, book, stock)
    expect(c.cost).toBeCloseTo(0)
    expect(c.inStock).toBe(2)
    expect(c.expiring).toBe(1)
  })
})

describe('cooked meals', () => {
  it('stay put on a rebuild and leave the shopping list', () => {
    const book = makePriceBook([item(1, 'steak', { price: 20 }), item(2, 'bean', { price: 1 }), item(3, 'oat', { price: 2 })], [])
    const recipes = [recipe('oatmeal', 1, 4, [[1, '', 'oats']]), recipe('steak-dinner', 2, 4, [[2, '', 'steak']]), recipe('bean-pot', 2, 4, [[2, 'cans', 'beans']])]
    const cooked = { day: 0, slot: 'dinner' as const, recipe_id: 'steak-dinner', batches: 1, locked: false, leftover: false, note: null, cooked: true }
    const r = buildWeek({
      recipes, sections: [], settings, budget: 40, people: 4, existing: [cooked], favorites: new Set<string>(),
      recent: new Set<string>(), book, seed: 3,
    })
    expect(r.meals.find((m) => m.day === 0 && m.slot === 'dinner')).toEqual(cooked)
    const list = shoppingList([cooked], new Map(recipes.map((x) => [x.id, x])), book)
    expect(list.lines).toHaveLength(0)
  })
})
