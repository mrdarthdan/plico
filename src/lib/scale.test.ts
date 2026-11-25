import { describe, expect, it } from 'vitest'
import { timeLabel } from './format'
import { ingredientsToText, parseIngredients, parseSteps, stepsToText } from './parse'
import { itemFactor, scaleRecipe, scaledSeconds, sizeItem } from './scale'
import type { Group, Step } from './types'

const ingredients: Group[] = [
  {
    name: 'Turkey',
    items: [
      { qty: 8.5, unit: 'lb', item: 'turkey, thawed', size: true },
      { qty: 1, unit: '', item: 'onion, quartered', fixed: true },
      { qty: 2, unit: 'cup', item: 'chicken broth', fixed: true },
    ],
  },
  { name: 'Herb butter', items: [{ qty: 0.5, unit: 'cup', item: 'butter' }, { qty: null, unit: '', item: 'salt, to taste' }] },
]
const steps: Step[] = [
  { title: 'High heat', text: 'Roast at 400°F.', seconds: 1800 },
  { title: 'Low and slow', text: 'For a {size} bird, check after {time}.', seconds: 3900, per_unit: 780 },
  { title: 'Carve', text: 'Carve.', seconds: 0 },
]
const turkey = { ingredients, steps, serves: 6 }

describe('scaling by size', () => {
  it('finds the size ingredient', () => {
    expect(sizeItem(turkey)?.item).toBe('turkey, thawed')
    expect(sizeItem({ ingredients: [{ name: '', items: [{ qty: 1, unit: '', item: 'egg' }] }] })).toBeNull()
  })
  it('keeps the base recipe unchanged at its own size', () => {
    const s = scaleRecipe(turkey, 8.5)
    expect(s.factor).toBe(1)
    expect(s.serves).toBe(6)
    expect(s.steps[1].seconds).toBe(3900)
    expect(s.steps[1].text).toBe('For a 8 ½ lb bird, check after 1 hr 5 min.')
  })
  it('scales amounts, servings and per-unit timers', () => {
    const s = scaleRecipe(turkey, 13)
    expect(s.factor).toBeCloseTo(13 / 8.5)
    expect(s.serves).toBe(9)
    expect(s.steps[0].seconds).toBe(1800) // fixed timer
    expect(s.steps[1].seconds).toBe(7440) // 3900 + 780 × 4.5, to the nearest minute
    expect(s.steps[1].text).toBe('For a 13 lb bird, check after ' + timeLabel(7440) + '.')
    expect(s.steps[2].seconds).toBe(0)
  })
  it('leaves fixed items alone', () => {
    expect(itemFactor(ingredients[0].items[1], 2)).toBe(1)
    expect(itemFactor(ingredients[1].items[0], 2)).toBe(2)
  })
  it('never shrinks a timer below a minute', () => {
    expect(scaledSeconds(steps[1], 8.5, 1)).toBe(60)
  })
  it('still scales by servings without a size ingredient', () => {
    const s = scaleRecipe({ ingredients: [{ name: '', items: [{ qty: 1, unit: 'cup', item: 'rice' }] }], steps, serves: 4 }, 8)
    expect(s.factor).toBe(2)
    expect(s.serves).toBe(8)
    expect(s.steps).toBe(steps)
  })
})

describe('size in the editor text', () => {
  it('round-trips [size] and [fixed]', () => {
    const text = ingredientsToText(ingredients)
    expect(text).toContain('8 ½ lb turkey, thawed [size]')
    expect(text).toContain('1 onion, quartered [fixed]')
    expect(parseIngredients(text)).toEqual(ingredients)
  })
  it('round-trips timers that grow with size', () => {
    const text = stepsToText(steps, 'lb')
    expect(text).toContain('(65 min, +13 min per lb)')
    expect(parseSteps(text)).toEqual(steps)
    expect(parseSteps('Roast: In the oven. (2 hr, +15 min per lb)')[0]).toEqual({
      title: 'Roast', text: 'In the oven.', seconds: 7200, per_unit: 900,
    })
  })
})
