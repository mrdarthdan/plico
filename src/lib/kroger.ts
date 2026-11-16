// Kroger prices. The `kroger` edge function talks to Kroger with the API keys;
// this file asks it questions and turns its answers into grocery-item prices.

import { parseSize } from './barcode'
import { supabase } from './supabase'
import type { GroceryItem, GroceryItemInput } from './types'
import { PACKAGE_UNITS, toPackageUnits } from './units'

export interface KrogerStore {
  locationId: string
  chain: string | null
  name: string | null
  address: string
}

export interface KrogerProduct {
  productId: string
  upc: string | null
  brand: string | null
  description: string
  category: string | null
  size: string | null
  soldBy: string | null
  regular: number | null
  promo: number | null
  /** Last day of the sale price, YYYY-MM-DD. */
  promoEnds: string | null
  image: string | null
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('kroger', { body })
  if (error) {
    // The function answers errors as {error: "..."}; show that rather than "non-2xx".
    let message = error.message
    try {
      const ctx = (error as { context?: Response }).context
      const parsed = ctx ? await ctx.json() : null
      if (parsed?.error) message = parsed.error
    } catch {
      /* keep the generic message */
    }
    throw new Error(message)
  }
  return data as T
}

export async function findStores(zip: string): Promise<KrogerStore[]> {
  return (await call<{ locations: KrogerStore[] }>({ action: 'locations', zip })).locations
}

export async function searchProducts(term: string, locationId: string): Promise<KrogerProduct[]> {
  return (await call<{ products: KrogerProduct[] }>({ action: 'search', term, locationId })).products
}

/** Current prices for any number of products, asked 50 at a time. */
export async function productsById(ids: string[], locationId: string): Promise<Map<string, KrogerProduct>> {
  const out = new Map<string, KrogerProduct>()
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const { products } = await call<{ products: KrogerProduct[] }>({ action: 'products', ids: chunk, locationId })
    for (const p of products) out.set(p.productId, p)
  }
  return out
}

/** The price you'd pay today: the sale price while it lasts, else the regular price. */
export function currentPrice(p: Pick<KrogerProduct, 'regular' | 'promo' | 'promoEnds'>, today: string): number | null {
  const onSale = p.promo != null && p.promo > 0 && (p.regular == null || p.promo < p.regular) && (!p.promoEnds || p.promoEnds >= today)
  return onSale ? p.promo : p.regular
}

/** The product's size as a package size, or null if it isn't written in a way we can read. */
export function productSize(p: Pick<KrogerProduct, 'size'>): { qty: number; unit: string } | null {
  const s = parseSize(p.size)
  return s && (PACKAGE_UNITS as readonly string[]).includes(s.unit) ? s : null
}

/**
 * What one of the item's usual packages costs, priced from this product:
 * a 5 lb bag at $3.99 prices a 10 lb item package at $7.98. Null when the
 * sizes can't be compared.
 */
export function packagePrice(
  item: Pick<GroceryItem, 'package_qty' | 'package_unit' | 'conversions'>,
  p: KrogerProduct,
  today: string,
): number | null {
  const price = currentPrice(p, today)
  if (price == null) return null
  const size = productSize(p) ?? (item.package_unit === 'each' ? { qty: 1, unit: 'each' } : null)
  if (!size) return null
  const inItemUnits = toPackageUnits(size.qty, size.unit, item.package_unit, item.conversions)
  if (!inItemUnits) return null
  return Math.round(((price * item.package_qty) / inItemUnits) * 100) / 100
}

/** The Kroger columns to save for an item priced from this product. */
export function krogerFields(p: KrogerProduct) {
  return {
    kroger_product_id: p.productId,
    kroger_label: [p.brand, p.description, p.size].filter(Boolean).join(' · ').slice(0, 300),
    kroger_regular: p.regular,
    kroger_promo: p.promo,
    kroger_promo_ends: p.promoEnds,
    kroger_checked_at: new Date().toISOString(),
  }
}

/** A receipt price from the last 45 days is what you actually paid, so it wins over Kroger's. */
export function keepsOwnPrice(item: Pick<GroceryItem, 'price' | 'price_source' | 'price_updated_at'>, today: string): boolean {
  if (item.price == null || item.price_source !== 'receipt' || !item.price_updated_at) return false
  const days = (Date.parse(today) - Date.parse(item.price_updated_at.slice(0, 10))) / 86400000
  return days <= 45
}

/**
 * The changes to make when linking or refreshing an item from a product. An
 * item that has never been priced also takes the product's package size.
 */
export function updateFromProduct(item: GroceryItem, p: KrogerProduct, today: string): Partial<GroceryItemInput> {
  const patch: Partial<GroceryItemInput> = krogerFields(p)
  const size = productSize(p)
  const base = item.price == null && size ? { ...item, package_qty: size.qty, package_unit: size.unit } : item
  if (base !== item) {
    patch.package_qty = base.package_qty
    patch.package_unit = base.package_unit
  }
  if (!keepsOwnPrice(item, today)) {
    const price = packagePrice(base, p, today)
    if (price != null) {
      patch.price = price
      patch.price_source = 'kroger'
    }
  }
  return patch
}

/** A new grocery item made from a Kroger product, named for the ingredient it's for. */
export function itemFromProduct(name: string, p: KrogerProduct, today: string): Partial<GroceryItemInput> {
  const size = productSize(p) ?? { qty: 1, unit: 'each' }
  return {
    name: name.trim().toLowerCase(),
    category: p.category,
    package_qty: size.qty,
    package_unit: size.unit,
    price: currentPrice(p, today),
    price_source: 'kroger',
    staple: false,
    conversions: {},
    aliases: [],
    ...krogerFields(p),
  }
}
