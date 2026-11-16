// Barcodes: tidying scanned codes and looking products up in Open Food Facts,
// a free, open product database (https://world.openfoodfacts.org).

import { normalizeUnit } from './units'

/** Digits only; a 13-digit code with a leading 0 is the same product as its 12-digit UPC-A. */
export function normalizeCode(raw: string): string {
  const d = raw.replace(/\D/g, '')
  return d.length === 13 && d.startsWith('0') ? d.slice(1) : d
}

export function validCode(code: string): boolean {
  return /^[0-9]{6,14}$/.test(code)
}

export interface ProductInfo {
  name: string | null
  brand: string | null
  size: { qty: number; unit: string } | null
}

/**
 * Reads a package size such as "16 oz", "1.5 lb", "12 ct", "32 fl oz (946 mL)"
 * or "453 g". Prefers the first US measure written, as US labels lead with it.
 */
export function parseSize(text: string | null | undefined): { qty: number; unit: string } | null {
  if (!text) return null
  const t = text.toLowerCase().replace(/,/g, '.')
  const m = t.match(/(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|oz|lbs?|ct|count|pk|pack|g|kg|ml|l|qt|pt|gal|dozen)\b/)
  if (!m) return null
  const qty = Number(m[1])
  const word = m[2].replace(/\s+/g, ' ').replace('fl. oz', 'fl oz')
  if (!(qty > 0)) return null
  if (word === 'dozen') return { qty: qty * 12, unit: 'each' }
  if (['ct', 'count', 'pk', 'pack'].includes(word)) return { qty, unit: 'each' }
  return { qty, unit: normalizeUnit(word) }
}

interface OffProduct {
  product_name?: string
  product_name_en?: string
  generic_name?: string
  brands?: string
  quantity?: string
  product_quantity?: number | string
  product_quantity_unit?: string
}

/** Looks a barcode up in Open Food Facts. Null when it isn't known there or the lookup fails. */
export async function lookupProduct(code: string): Promise<ProductInfo | null> {
  const fields = 'product_name,product_name_en,generic_name,brands,quantity,product_quantity,product_quantity_unit'
  // Open Food Facts stores UPC-A codes as 13 digits with a leading 0.
  const tries = code.length === 12 ? ['0' + code, code] : [code]
  for (const c of tries) {
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${c}.json?fields=${fields}`)
      if (!res.ok) continue
      const body = (await res.json()) as { status?: number; product?: OffProduct }
      if (body.status !== 1 || !body.product) continue
      const p = body.product
      const name = (p.product_name_en || p.product_name || p.generic_name || '').trim() || null
      const brand = (p.brands || '').split(',')[0].trim() || null
      let size = parseSize(p.quantity)
      if (!size && Number(p.product_quantity) > 0) {
        const u = normalizeUnit(p.product_quantity_unit || 'g')
        size = { qty: Number(p.product_quantity), unit: u }
      }
      return { name, brand, size }
    } catch {
      /* offline or blocked: try the next form, then give up */
    }
  }
  return null
}
