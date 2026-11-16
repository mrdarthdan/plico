import { describe, expect, it } from 'vitest'
import { currentPrice, itemFromProduct, keepsOwnPrice, packagePrice, updateFromProduct, type KrogerProduct } from './kroger'
import type { GroceryItem } from './types'

const flour: KrogerProduct = {
  productId: '0001600010610', upc: '0001600010610', brand: 'Gold Medal', description: 'Gold Medal All Purpose Flour',
  category: 'Baking Goods', size: '5 lbs', soldBy: 'UNIT', regular: 4.49, promo: 3.99, promoEnds: '2026-11-17', image: null,
}

const item = (extra: Partial<GroceryItem> = {}): GroceryItem => ({
  id: 1, name: 'flour', category: null, package_qty: 5, package_unit: 'lb', price: null, price_source: null,
  price_updated_at: null, conversions: {}, staple: false, aliases: [], kroger_product_id: null, kroger_label: null,
  kroger_regular: null, kroger_promo: null, kroger_promo_ends: null, kroger_checked_at: null, ...extra,
})

describe('currentPrice', () => {
  it('uses the sale price until it ends', () => {
    expect(currentPrice(flour, '2026-11-16')).toBe(3.99)
    expect(currentPrice(flour, '2026-11-17')).toBe(3.99)
    expect(currentPrice(flour, '2026-11-18')).toBe(4.49)
    expect(currentPrice({ regular: 2, promo: null, promoEnds: null }, '2026-11-16')).toBe(2)
  })
})

describe('packagePrice', () => {
  it('scales the product price to the item package', () => {
    expect(packagePrice(item(), flour, '2026-11-16')).toBe(3.99)
    expect(packagePrice(item({ package_qty: 10 }), flour, '2026-11-16')).toBe(7.98)
    expect(packagePrice(item({ package_qty: 80, package_unit: 'oz' }), flour, '2026-11-16')).toBe(3.99)
    expect(packagePrice(item({ package_unit: 'cup' }), flour, '2026-11-16')).toBeNull()
  })
})

describe('updateFromProduct', () => {
  it('prices an unpriced item and takes the product size', () => {
    const patch = updateFromProduct(item({ package_qty: 1, package_unit: 'each' }), flour, '2026-11-16')
    expect(patch.package_qty).toBe(5)
    expect(patch.package_unit).toBe('lb')
    expect(patch.price).toBe(3.99)
    expect(patch.price_source).toBe('kroger')
    expect(patch.kroger_product_id).toBe('0001600010610')
  })

  it('keeps a recent receipt price but still records Kroger prices', () => {
    const own = item({ price: 3.5, price_source: 'receipt', price_updated_at: '2026-11-10T18:00:00Z' })
    expect(keepsOwnPrice(own, '2026-11-16')).toBe(true)
    const patch = updateFromProduct(own, flour, '2026-11-16')
    expect(patch.price).toBe(undefined)
    expect(patch.kroger_promo).toBe(3.99)
    expect(keepsOwnPrice({ ...own, price_updated_at: '2026-09-01T00:00:00Z' }, '2026-11-16')).toBe(false)
  })
})

describe('itemFromProduct', () => {
  it('makes an item named for the ingredient', () => {
    const it = itemFromProduct('All purpose flour', flour, '2026-11-16')
    expect(it.name).toBe('all purpose flour')
    expect(it.package_qty).toBe(5)
    expect(it.category).toBe('Baking Goods')
  })
})
