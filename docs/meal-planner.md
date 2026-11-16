# Meal planner

An optional module that plans a week of breakfasts, lunches and dinners from
the recipe box, within a weekly grocery budget, and turns the week into a
priced shopping list. It is off until an admin turns it on.

## Setting it up

1. Run `supabase/migrations/20261116000000_meal_planner.sql`,
   `20261117000000_pantry.sql`, `20261118000000_kroger.sql` and
   `20261119000000_cooking_history.sql`, the same way as the other migrations (see
   [supabase.md](supabase.md)). They only add to the `plico` schema; recipes
   and accounts are untouched.
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

## Store prices from Kroger (optional)

Stores in the Kroger family (Kroger, Fry's, Smith's, King Soopers, Ralphs,
Fred Meyer and others) publish product prices through Kroger's free
developer API. To use them:

1. Make a free account at [developer.kroger.com](https://developer.kroger.com)
   and register an application for the **Production** environment with the
   **Products** API. Copy its client ID and client secret.
2. In the Supabase dashboard, under **Edge Functions → Secrets**, add
   `KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET`.
3. Deploy the function:
   `supabase functions deploy kroger --no-verify-jwt`. (It checks the caller
   itself: only meal planners can look prices up. Its one open action,
   `status`, only says whether Kroger accepts the keys.)
4. On the planner's **Prices** tab, find your store by ZIP code.

Then **Find at the store** on any unpriced ingredient searches that store and
makes the grocery item from the product you pick, with its size and price.
**Match items to store products** walks through existing items one at a
time, and **Refresh store prices** reprices every linked item in one go.
Sale prices are used until their end date. A receipt price from the last 45
days is kept over the store's price, since it's what you actually paid.

The keys stay in Supabase: the browser only ever talks to the function.

## The pantry and barcodes

The **Pantry** tab keeps what's on hand: an amount, where it's kept (pantry,
fridge, freezer) and an optional use-by date, one row per lot. The planner
uses it in two ways: the shopping list only buys what the pantry is short of,
and when building a week it prefers recipes that use what's on hand, most of
all anything expiring within four days. Food in the pantry counts as already
paid for.

Ways to fill it:

- **Scan to add.** Opens the phone's camera and reads the product barcode.
  Chrome on Android uses the browser's own barcode reader; everything else,
  including every browser on iPhone, uses the [ZXing](https://github.com/zxing-js/library)
  library, loaded only when the scanner opens. The camera needs the site to be
  served over HTTPS, and the browser asks permission the first time. A typed
  number works too.
- **The first scan of a product** looks it up in [Open Food Facts](https://world.openfoodfacts.org),
  a free, open product database, for its name, brand and size. You then say
  which grocery item it is (or make a new one, with a plain name such as
  "black beans" so recipes can find it). The barcode is remembered, with its
  size, so the next scan of that product goes straight to "how many".
- **Price paid** on a scan updates the item's price, scaled to its usual
  package size, and marks it as a receipt price.
- **From the shopping list:** tick what you bought, then **Put ticked items in
  the pantry**. Each line goes in once.

**Use some**, **Edit** and **Used up** keep amounts current by hand, and
**Count the pantry** lists every lot with a box for what's really there, so a
quick walk along the shelves puts the counts right. Only changed amounts are
saved; 0 removes a lot.

## Cooking

The **✓** on a planned meal marks it cooked and takes its ingredients out of
the pantry. A sheet first shows what will come out of which lot, oldest
use-by date first, converted into the units each lot is kept in, and what the
pantry was short of. Change how many times the recipe was made, untick
anything you didn't use, then confirm. The change is made in the database in
one step (`plico.pantry_take`), so it can't half-happen.

A cooked meal is kept when the week is rebuilt and drops off the shopping
list, since it has already taken what it needed. **Undo** puts everything
back (`plico.pantry_return`), recreating any lot that ran out with its
location and use-by date.

## Price history

Every time an item's price, or the package it's priced for, changes, a
database trigger records it in `price_history`, with where the price came
from (the store, a receipt, or typed in). Editing an item shows its history
and how much it has moved per unit since the first record.

## Data

| Table | Holds |
|---|---|
| `planner_settings` | Single row: budget, household size, week start day, meals and sections, ignored ingredient names |
| `grocery_items` | Name, aisle, package size and unit, price, conversions, staple flag, other names |
| `meal_plans` | One row per week (keyed by its first day): budget, people, the meals as JSON, ticked shopping lines, extra lines, lines put in the pantry |
| `barcodes` | A scanned product: code, grocery item, product name, brand and size |
| `pantry` | What's on hand: grocery item, amount and unit, where it's kept, use-by date |
| `price_history` | Each price an item has had: price, package, source, when. Written only by a trigger |

`planner_settings.kroger_location_id` is the chosen store; each grocery
item's `kroger_*` columns hold its linked product and that product's latest
regular and sale prices.

`settings.planner_enabled` is the on/off switch. `plico.can_plan()` is true
for editors and admins while it's on; every planner policy uses it.

The planning arithmetic lives in `src/lib/planner.ts`, `src/lib/units.ts` and
`src/lib/ingredients.ts`, with tests in `src/lib/planner.test.ts`.
