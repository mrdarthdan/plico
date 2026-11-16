import { describe, expect, it } from 'vitest'
import { normalizeCode, parseSize } from './barcode'

describe('normalizeCode', () => {
  it('keeps digits and shortens EAN-13 with a leading 0 to UPC-A', () => {
    expect(normalizeCode('0 78742 01231 5')).toBe('078742012315')
    expect(normalizeCode('0078742012315')).toBe('078742012315')
    expect(normalizeCode('5000112637922')).toBe('5000112637922')
  })
})

describe('parseSize', () => {
  it('reads common label sizes', () => {
    expect(parseSize('16 oz (1 lb) 453g')).toEqual({ qty: 16, unit: 'oz' })
    expect(parseSize('32 FL OZ (946 mL)')).toEqual({ qty: 32, unit: 'fl oz' })
    expect(parseSize('5 lbs')).toEqual({ qty: 5, unit: 'lb' })
    expect(parseSize('12 ct')).toEqual({ qty: 12, unit: 'each' })
    expect(parseSize('1 dozen')).toEqual({ qty: 12, unit: 'each' })
    expect(parseSize('500 g')).toEqual({ qty: 500, unit: 'g' })
    expect(parseSize('1,5 l')).toEqual({ qty: 1.5, unit: 'l' })
    expect(parseSize('family size')).toBeNull()
  })
})
