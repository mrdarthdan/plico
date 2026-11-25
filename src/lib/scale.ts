// Scaling a recipe by the size of one ingredient (e.g. "Scale by turkey weight").
//
// Most recipes scale by servings. A recipe can instead mark one ingredient as its
// size (`size: true`), such as "8.5 lb turkey". Changing that amount then:
//   - scales every other amount by the same factor, except items marked `fixed`
//     (things like "1 onion for the cavity" or "2 cups broth for the pan"),
//   - stretches step timers that have `per_unit` seconds (e.g. +13 min per lb),
//   - fills {size} and {time} in step text with the current size and timer.

import { frac, timeLabel } from './format'
import type { Item, Recipe, Step } from './types'

/** The ingredient the recipe scales by, if it has one. */
export function sizeItem(r: Pick<Recipe, 'ingredients'>): Item | null {
  for (const g of r.ingredients) for (const it of g.items) if (it.size && it.qty != null && it.qty > 0) return it
  return null
}

/** "8 ½ lb" */
export function sizeLabel(qty: number, unit: string): string {
  return frac(qty) + (unit ? ' ' + unit : '')
}

/** A step's timer for a given size. Never shorter than a minute when it started with one. */
export function scaledSeconds(step: Step, base: number, size: number): number {
  if (!step.seconds) return 0
  if (!step.per_unit) return step.seconds
  return Math.max(60, Math.round((step.seconds + step.per_unit * (size - base)) / 60) * 60)
}

/** Replaces {size} and {time} in step text. */
export function fillText(text: string, size: string, time: string): string {
  return text.replace(/\{size\}/gi, size).replace(/\{time\}/gi, time)
}

export interface Scaled {
  /** Multiplier for ingredient amounts (fixed items ignore it). */
  factor: number
  /** Servings at this size, rounded; null if the recipe has no serving count. */
  serves: number | null
  steps: Step[]
}

/**
 * The recipe at a chosen amount: `amount` is the size ingredient's amount when the
 * recipe has one, otherwise the number of servings.
 */
export function scaleRecipe(r: Pick<Recipe, 'ingredients' | 'steps' | 'serves'>, amount: number): Scaled {
  const key = sizeItem(r)
  if (!key) {
    const factor = r.serves ? amount / r.serves : 1
    return { factor, serves: r.serves ? amount : null, steps: r.steps }
  }
  const base = key.qty as number
  const factor = amount / base
  const size = sizeLabel(amount, key.unit)
  const steps = r.steps.map((s) => {
    const seconds = scaledSeconds(s, base, amount)
    return { ...s, seconds, text: fillText(s.text, size, seconds ? timeLabel(seconds) : '') }
  })
  return { factor, serves: r.serves ? Math.max(1, Math.round(r.serves * factor)) : null, steps }
}

/** The amount for an ingredient line at a given factor. */
export function itemFactor(it: Item, factor: number): number {
  return it.fixed ? 1 : factor
}

/** How far the size control moves per tap: halves for small amounts, wholes above 20. */
export function sizeStep(base: number): number {
  return base > 20 ? 1 : 0.5
}
