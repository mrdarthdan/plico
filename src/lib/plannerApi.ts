// Database calls for the meal planner. As with the rest of the app, the
// database decides who may do what (see docs/meal-planner.md).

import { supabase } from './supabase'
import type { Barcode, GroceryItem, GroceryItemInput, MealPlan, PantryRow, PlannerSettings } from './types'

function fail(message: string): never {
  if (/row-level security|permission denied/i.test(message)) {
    throw new Error("This account can't use the meal planner. Ask an admin to make you an editor.")
  }
  if (/duplicate key|unique/i.test(message)) throw new Error('There is already an item with that name.')
  throw new Error(message)
}

const num = (v: unknown) => (v == null ? null : Number(v))

export async function loadPlannerSettings(): Promise<PlannerSettings> {
  const { data, error } = await supabase
    .from('planner_settings')
    .select('weekly_budget, household_size, week_starts_on, slots, ignored')
    .eq('id', 1)
    .maybeSingle()
  if (error) fail(error.message)
  if (!data) fail("This account can't use the meal planner. Ask an admin to make you an editor.")
  return { ...data, weekly_budget: Number(data.weekly_budget) } as PlannerSettings
}

export async function savePlannerSettings(s: PlannerSettings) {
  const { error } = await supabase.from('planner_settings').update(s).eq('id', 1)
  if (error) fail(error.message)
}

export async function setPlannerEnabled(on: boolean) {
  const { error } = await supabase.from('settings').update({ planner_enabled: on }).eq('id', 1)
  if (error) fail(error.message)
}

function toItem(row: Record<string, unknown>): GroceryItem {
  return {
    ...(row as unknown as GroceryItem),
    package_qty: Number(row.package_qty),
    price: num(row.price),
  }
}

export async function loadGroceryItems(): Promise<GroceryItem[]> {
  const { data, error } = await supabase.from('grocery_items').select('*').order('name')
  if (error) fail(error.message)
  return (data ?? []).map(toItem)
}

export async function saveGroceryItem(id: number | null, input: Partial<GroceryItemInput>): Promise<GroceryItem> {
  const row: Record<string, unknown> = { ...input }
  if ('price' in input) row.price_updated_at = new Date().toISOString()
  const q = id == null
    ? supabase.from('grocery_items').insert(row).select('*').single()
    : supabase.from('grocery_items').update(row).eq('id', id).select('*').single()
  const { data, error } = await q
  if (error) fail(error.message)
  return toItem(data)
}

export async function addGroceryItems(rows: Partial<GroceryItemInput>[]) {
  // Names that already exist are skipped rather than failing the whole batch.
  const { error } = await supabase.from('grocery_items').upsert(rows, { onConflict: 'name', ignoreDuplicates: true })
  if (error) fail(error.message)
}

export async function deleteGroceryItem(id: number) {
  const { error } = await supabase.from('grocery_items').delete().eq('id', id)
  if (error) fail(error.message)
}

export async function loadPlan(weekStart: string): Promise<MealPlan | null> {
  const { data, error } = await supabase
    .from('meal_plans')
    .select('week_start, budget, household_size, meals, checked, extras, stocked')
    .eq('week_start', weekStart)
    .maybeSingle()
  if (error) fail(error.message)
  return data ? ({ ...data, budget: Number(data.budget) } as MealPlan) : null
}

/** Recipe ids planned in the given weeks, for resting them a week. */
export async function recentRecipeIds(weekStarts: string[]): Promise<Set<string>> {
  const { data, error } = await supabase.from('meal_plans').select('meals').in('week_start', weekStarts)
  if (error) return new Set()
  const ids = new Set<string>()
  for (const row of (data ?? []) as Pick<MealPlan, 'meals'>[]) {
    for (const m of row.meals) if (m.recipe_id && !m.leftover) ids.add(m.recipe_id)
  }
  return ids
}

export async function savePlan(plan: MealPlan) {
  const { error } = await supabase.from('meal_plans').upsert(plan, { onConflict: 'week_start' })
  if (error) fail(error.message)
}

// ---- pantry ----

export async function loadPantry(): Promise<PantryRow[]> {
  const { data, error } = await supabase
    .from('pantry')
    .select('id, grocery_item_id, qty, unit, location, expires')
    .order('expires', { ascending: true, nullsFirst: false })
  if (error) fail(error.message)
  return (data ?? []).map((r: Record<string, unknown>) => ({ ...(r as unknown as PantryRow), qty: Number(r.qty) }))
}

export async function addPantry(rows: Omit<PantryRow, 'id'>[]) {
  if (!rows.length) return
  const { error } = await supabase.from('pantry').insert(rows)
  if (error) fail(error.message)
}

export async function updatePantry(id: number, patch: Partial<Omit<PantryRow, 'id'>>) {
  const { error } = await supabase.from('pantry').update(patch).eq('id', id)
  if (error) fail(error.message)
}

export async function deletePantry(id: number) {
  const { error } = await supabase.from('pantry').delete().eq('id', id)
  if (error) fail(error.message)
}

export async function loadBarcodes(): Promise<Barcode[]> {
  const { data, error } = await supabase
    .from('barcodes')
    .select('code, grocery_item_id, product_name, brand, size_qty, size_unit')
  if (error) fail(error.message)
  return (data ?? []).map((r: Record<string, unknown>) => ({ ...(r as unknown as Barcode), size_qty: num(r.size_qty) }))
}

export async function saveBarcode(b: Barcode) {
  const { error } = await supabase.from('barcodes').upsert(b, { onConflict: 'code' })
  if (error) fail(error.message)
}
