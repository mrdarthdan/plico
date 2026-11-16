# Meal planner

An optional module that plans a week of breakfasts, lunches and dinners from
the recipe box, within a weekly grocery budget, and turns the week into a
priced shopping list. It is off until an admin turns it on.

## Setting it up

1. Run `supabase/migrations/20261116000000_meal_planner.sql` the same way as
   the other migrations (see [supabase.md](supabase.md)). It only adds to the
   `plico` schema; recipes and accounts are untouched.
2. Sign in as an admin, open **Admin → Meal planner**, and tick
   **Turn on the meal planner**.
3. Set the household size, the usual weekly budget, and which recipe sections
   feed breakfast, lunch and dinner. With no sections picked, the planner
   guesses from section names (a "Breakfast" section feeds breakfast, "Main
   Dishes" and "Soups" feed lunch and dinner).

**Meal planner** then appears in the account bar for editors and admins.

## Who can use it

There is one shared household per install. Every editor and admin sees and
changes the same plans, prices and settings. Viewers and signed-out visitors
can't read any of it; the database enforces this, as with recipes. Only admins
can turn the module on or off.

## How it works

**Prices.** Each grocery item records the package you buy (5 lb of flour, 12
eggs, a 14.5 oz can) and what that package costs. Recipe ingredients are
matched to items by name: notes in brackets, preparation words and plurals are
ignored, so "garlic cloves, minced" matches an item called "garlic". An item's
*also called* names catch anything the matching misses.

When a recipe measures an item differently from how it's sold (cups of flour,
bought by the pound), the item needs a conversion: 1 cup = 0.28 lb. Weight
converts to weight and volume to volume without one.

**Staples** such as salt, spices and oil count as already on hand. They're
listed on the shopping list for checking but not costed.

**The shopping list** adds up every planned meal's ingredients per item and
buys whole packages: two recipes using 3 eggs each need one dozen. Anything
without an item, a price or a conversion is flagged and left out of the total,
so the Prices tab lists those, most used first.

**Building a week.** For each meal it scores the eligible recipes on cost
against the budget, favorites (yours), variety within the week, rest for
recipes used in the past two weeks, and some chance, and picks the best. A
dinner that makes at least another full round of servings becomes the next
day's lunch. If the week's shopping comes out over budget, it rebuilds,
leaning harder on cost each time. Meals you choose by hand are locked and kept
when you rebuild.

## Data

| Table | Holds |
|---|---|
| `planner_settings` | Single row: budget, household size, week start day, meals and sections, ignored ingredient names |
| `grocery_items` | Name, aisle, package size and unit, price, conversions, staple flag, other names, UPC |
| `meal_plans` | One row per week (keyed by its first day): budget, people, the meals as JSON, ticked shopping lines, extra lines |

`settings.planner_enabled` is the on/off switch. `plico.can_plan()` is true
for editors and admins while it's on; every planner policy uses it.

The planning arithmetic lives in `src/lib/planner.ts`, `src/lib/units.ts` and
`src/lib/ingredients.ts`, with tests in `src/lib/planner.test.ts`.
