export type Role = 'viewer' | 'editor' | 'admin'

export interface Item {
  /** null means "no amount", e.g. "salt, to taste"; such items are not scaled */
  qty: number | null
  unit: string
  item: string
  /** The recipe scales by this item's amount (e.g. turkey weight) instead of servings. One per recipe. */
  size?: boolean
  /** Stays the same whatever the size (e.g. "1 onion for the cavity"). */
  fixed?: boolean
}
export interface Group {
  name: string
  items: Item[]
}
export interface Step {
  title: string
  text: string
  /** timer length; 0 for none. For a recipe with a size item, the length at its base size. */
  seconds: number
  /** Seconds added to the timer per unit of size above the base (taken off below it). */
  per_unit?: number
}

export interface Recipe {
  id: string
  title: string
  section_id: number
  serves: number | null
  time: string | null
  description: string | null
  ingredients: Group[]
  steps: Step[]
  notes: string[]
  tags: string[]
  source_url: string | null
  added: string
  contributor: string | null
}

/** The columns an editor may set. */
export type RecipeInput = Omit<Recipe, 'id' | 'added'>

export interface Section {
  id: number
  name: string
  sort: number
}
export interface Settings {
  site_name: string
  tagline: string | null
  public_read: boolean
  /** The meal planner module is turned on. */
  planner_enabled?: boolean
}

// ---- meal planner ----

export type Slot = 'breakfast' | 'lunch' | 'dinner'

export interface SlotConfig {
  on: boolean
  /** Section ids that feed this meal; empty means guess from section names. */
  sections: number[]
}

export interface PlannerSettings {
  weekly_budget: number
  household_size: number
  /** 0 = Sunday, 1 = Monday */
  week_starts_on: number
  slots: Record<Slot, SlotConfig>
  /** Ingredient names that never go on a shopping list. */
  ignored: string[]
  /** The Kroger-family store prices come from, if one is chosen. */
  kroger_location_id: string | null
  kroger_store: string | null
}

export interface GroceryItem {
  id: number
  name: string
  category: string | null
  package_qty: number
  package_unit: string
  price: number | null
  price_source: 'manual' | 'receipt' | 'kroger' | null
  price_updated_at: string | null
  conversions: Record<string, number>
  staple: boolean
  aliases: string[]
  /** The Kroger product this item is priced from, and its latest prices there. */
  kroger_product_id: string | null
  kroger_label: string | null
  kroger_regular: number | null
  kroger_promo: number | null
  kroger_promo_ends: string | null
  kroger_checked_at: string | null
}

/** A scanned product: one brand and size of a grocery item. */
export interface Barcode {
  code: string
  grocery_item_id: number
  product_name: string | null
  brand: string | null
  size_qty: number | null
  size_unit: string | null
}

/** One lot on hand. */
export interface PantryRow {
  id: number
  grocery_item_id: number
  qty: number
  unit: string
  location: string
  expires: string | null
}

export type GroceryItemInput = Omit<GroceryItem, 'id' | 'price_updated_at'>

export interface PlannedMeal {
  /** 0-6 from the first day of the week */
  day: number
  slot: Slot
  recipe_id: string | null
  /** How many times the recipe is made; 0 for leftovers. */
  batches: number
  /** Kept as is when the week is rebuilt. */
  locked: boolean
  /** Eats the previous dinner's leftovers; costs nothing. */
  leftover: boolean
  /** Free text in place of a recipe, e.g. "Eating out". */
  note: string | null
  /** Marked as cooked; its ingredients were taken out of the pantry. */
  cooked?: boolean
  /** What cooking it took from the pantry, to put back if it's undone. */
  used?: { lot: number; qty: number; item: number; unit: string; location: string; expires: string | null }[]
}

export interface MealPlan {
  week_start: string
  budget: number
  household_size: number
  meals: PlannedMeal[]
  checked: string[]
  extras: { label: string; cost: number | null }[]
  /** Shopping-list lines already put away into the pantry. */
  stocked: string[]
}
export interface Profile {
  user_id: string
  display_name: string | null
  role: Role
}
export interface Member extends Profile {
  email: string
  created_at: string
}

export interface RecipeBoxData {
  settings: Settings
  sections: Section[]
  recipes: Recipe[]
  /** true when the database did not respond and this is the last saved copy */
  fromCache: boolean
}
