// Kitchen units: recognising the many ways recipes spell them, and converting
// between them. Weight converts to weight and volume to volume; anything
// across those (a cup of flour in pounds) needs a per-item conversion.

export type Dim = 'mass' | 'volume' | 'count'

/** The package units a grocery item can be bought in. */
export const PACKAGE_UNITS = ['each', 'oz', 'lb', 'g', 'kg', 'fl oz', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'pt', 'qt', 'gal'] as const
export type PackageUnit = (typeof PACKAGE_UNITS)[number]

// Size of each unit in grams, millilitres, or items.
const SIZE: Record<string, { dim: Dim; base: number }> = {
  g: { dim: 'mass', base: 1 },
  kg: { dim: 'mass', base: 1000 },
  oz: { dim: 'mass', base: 28.3495 },
  lb: { dim: 'mass', base: 453.592 },
  ml: { dim: 'volume', base: 1 },
  l: { dim: 'volume', base: 1000 },
  tsp: { dim: 'volume', base: 4.92892 },
  tbsp: { dim: 'volume', base: 14.7868 },
  cup: { dim: 'volume', base: 236.588 },
  'fl oz': { dim: 'volume', base: 29.5735 },
  pt: { dim: 'volume', base: 473.176 },
  qt: { dim: 'volume', base: 946.353 },
  gal: { dim: 'volume', base: 3785.41 },
  each: { dim: 'count', base: 1 },
}

// Things you buy one of. A recipe's "2 cans" of something sold "each" is 2.
const CONTAINERS = new Set(['each', 'can', 'package', 'bag', 'jar', 'box', 'bottle', 'carton', 'container', 'head', 'bunch', 'loaf'])

const SPELLINGS: Record<string, string> = {
  '': 'each', ea: 'each', each: 'each', whole: 'each', large: 'each', medium: 'each', small: 'each',
  t: 'tsp', tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tbl: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  c: 'cup', cup: 'cup', cups: 'cup',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  'fl oz': 'fl oz', floz: 'fl oz', 'fluid ounce': 'fl oz', 'fluid ounces': 'fl oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  g: 'g', gram: 'g', grams: 'g', kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  pt: 'pt', pint: 'pt', pints: 'pt', qt: 'qt', quart: 'qt', quarts: 'qt', gal: 'gal', gallon: 'gal', gallons: 'gal',
  can: 'can', cans: 'can', pkg: 'package', pkgs: 'package', package: 'package', packages: 'package',
  bag: 'bag', bags: 'bag', jar: 'jar', jars: 'jar', box: 'box', boxes: 'box', bottle: 'bottle', bottles: 'bottle',
  carton: 'carton', cartons: 'carton', container: 'container', containers: 'container',
  head: 'head', heads: 'head', bunch: 'bunch', bunches: 'bunch', loaf: 'loaf', loaves: 'loaf',
  clove: 'clove', cloves: 'clove', slice: 'slice', slices: 'slice', stick: 'stick', sticks: 'stick',
  pinch: 'pinch', dash: 'dash', sprig: 'sprig', sprigs: 'sprig', stalk: 'stalk', stalks: 'stalk',
}

/** "Tbsp." -> "tbsp", "cups" -> "cup", "" -> "each". Unknown words come back lowercased. */
export function normalizeUnit(raw: string): string {
  const u = raw.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()
  return SPELLINGS[u] ?? u
}

export function dimOf(unit: string): Dim | null {
  return SIZE[unit]?.dim ?? null
}

/** Converts between two standard units of the same kind, or returns null. */
export function convertStd(qty: number, from: string, to: string): number | null {
  if (from === to) return qty
  if (CONTAINERS.has(from) && to === 'each') return qty
  // Recipes say "oz" for liquids too; treat ounces and fluid ounces as equal.
  if (from === 'oz' && SIZE[to]?.dim === 'volume') from = 'fl oz'
  if (from === 'fl oz' && SIZE[to]?.dim === 'mass') from = 'oz'
  const a = SIZE[from]
  const b = SIZE[to]
  if (!a || !b || a.dim !== b.dim) return null
  return (qty * a.base) / b.base
}

/**
 * How much of an item's package unit a recipe amount uses, or null if it
 * can't be worked out. `conversions` maps a recipe unit to an amount of the
 * package unit, e.g. {"cup": 0.28} for flour sold by the lb.
 */
export function toPackageUnits(
  qty: number,
  recipeUnit: string,
  packageUnit: string,
  conversions: Record<string, number>,
): number | null {
  const unit = normalizeUnit(recipeUnit)
  const direct = convertStd(qty, unit, packageUnit)
  if (direct != null) return direct
  const own = conversions[unit]
  if (typeof own === 'number' && own > 0) return qty * own
  // A conversion given for another unit of the same kind: 3 tbsp via {"cup": 0.28}.
  for (const [cu, per] of Object.entries(conversions)) {
    if (typeof per !== 'number' || per <= 0) continue
    const inThat = convertStd(qty, unit, normalizeUnit(cu))
    if (inThat != null) return inThat * per
  }
  return null
}

/** "1.5", "lb" -> "1.5 lb"; trims needless decimals. */
export function amount(qty: number, unit: string): string {
  const n = qty >= 10 ? Math.round(qty * 10) / 10 : Math.round(qty * 100) / 100
  return `${n}${unit && unit !== 'each' ? ' ' + unit : ''}`
}
