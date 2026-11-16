// Matching recipe ingredient text ("garlic, minced (¼ tsp granulated)") to the
// grocery items the household buys ("garlic").

import type { GroceryItem } from './types'

// Words that describe preparation, not what to buy.
const PREP = new Set([
  'a', 'an', 'the', 'of', 'fresh', 'freshly', 'softened', 'melted', 'beaten', 'packed', 'heaping', 'level',
  'cold', 'warm', 'hot', 'room', 'temperature', 'finely', 'roughly', 'coarsely', 'thinly', 'chopped', 'minced',
  'peeled', 'cubed', 'divided', 'optional', 'about', 'approx', 'approximately', 'plus', 'more', 'extra', 'good',
  'quality', 'store', 'bought', 'homemade', 'lightly', 'firmly', 'loosely', 'or', 'and', 'to', 'taste', 'for',
  'serving', 'garnish', 'large', 'medium', 'small', '&',
])
// Describing words that can stand alone before a comma: "boneless, skinless chicken".
const LEAD_ADJ = new Set(['boneless', 'skinless', 'seasoned', 'browned', 'cooked', 'fresh', 'frozen', 'large', 'medium', 'small', 'ripe', 'peeled', 'raw'])
// Package words that sometimes start the item text: "cans black beans".
const PACKAGING = new Set(['can', 'cans', 'package', 'packages', 'pkg', 'bag', 'bags', 'jar', 'jars', 'box', 'boxes', 'bottle', 'bottles', 'container', 'containers', 'carton', 'cartons', 'envelope', 'envelopes', 'packet', 'packets'])

// Sizes that sometimes start the item text: "8 oz. can tomato sauce".
const LEADING_UNITS = new Set([
  'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'g', 'gram', 'grams', 'kg', 'ml', 'l', 'qt', 'quart', 'inch', 'in',
  'sprig', 'sprigs', 'head', 'heads', 'bunch', 'bunches', 'pinch', 'dash', 'slice', 'slices', 'stick', 'sticks',
])

function singular(w: string): string {
  if (w.length <= 3 || w.endsWith('ss') || w.endsWith('us')) return w
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.endsWith('oes')) return w.slice(0, -2)
  if (/(ches|shes|xes)$/.test(w)) return w.slice(0, -2)
  if (w.endsWith('s')) return w.slice(0, -1)
  return w
}

/**
 * A short, stable key for an ingredient: lowercase, no notes in brackets,
 * nothing after the first comma, no preparation words, singular nouns.
 * "Black beans (15 oz.), drained" -> "black bean".
 */
export function ingredientKey(text: string): string {
  let s = text.toLowerCase()
  s = s.replace(/\([^)]*\)?/g, ' ') // (14.5 oz.) notes, even unclosed ones
  const parts = s.split(/[,;]/)
  s = parts.shift() ?? ''
  while (parts.length && s.trim().split(/\s+/).every((w) => !w || LEAD_ADJ.has(w) || w === '&')) s += ' ' + parts.shift()
  s = s.replace(/\b(cut|sliced|diced|chopped|torn|broken)\s+(into|in)\b.*$/, '')
  s = s.replace(/[’']/g, '').replace(/[^a-z0-9%&\s]/g, ' ')
  const words = s.split(/\s+/).filter(Boolean)
  while (words.length > 1 && (PACKAGING.has(words[0]) || LEADING_UNITS.has(words[0]) || /^[0-9]/.test(words[0]))) {
    words.shift()
  }
  const kept = words.filter((w) => !PREP.has(w)).map(singular)
  return (kept.length ? kept : words.map(singular)).join(' ').trim()
}

/** Finds the grocery item for an ingredient key: aliases first, then the item name, then the longest item name contained in the key. */
export function makeResolver(items: GroceryItem[]): (key: string) => GroceryItem | null {
  const exact = new Map<string, GroceryItem>()
  for (const it of items) exact.set(ingredientKey(it.name), it)
  // Aliases win over names, so a deliberate link always holds.
  for (const it of items) for (const a of it.aliases) exact.set(ingredientKey(a), it)
  const byLength = items
    .map((it) => ({ it, words: ingredientKey(it.name).split(' ') }))
    .sort((a, b) => b.words.join(' ').length - a.words.join(' ').length)
  const memo = new Map<string, GroceryItem | null>()
  return (key) => {
    if (memo.has(key)) return memo.get(key)!
    let hit = exact.get(key) ?? null
    if (!hit) {
      const kw = key.split(' ')
      for (const { it, words } of byLength) {
        if (containsRun(kw, words)) {
          hit = it
          break
        }
      }
    }
    memo.set(key, hit)
    return hit
  }
}

/** Whether `run` appears as consecutive whole words in `words`. */
function containsRun(words: string[], run: string[]): boolean {
  if (!run.length || !run[0]) return false
  outer: for (let i = 0; i + run.length <= words.length; i++) {
    for (let j = 0; j < run.length; j++) if (words[i + j] !== run[j]) continue outer
    return true
  }
  return false
}
