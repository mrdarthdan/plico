-- Kroger prices for the meal planner. The prices themselves come from the
-- `kroger` edge function (supabase/functions/kroger), which holds the Kroger
-- API keys; these columns remember which store and products to ask about.

-- The store prices come from. Kroger calls it a location.
alter table plico.planner_settings
  add column kroger_location_id text check (kroger_location_id is null or kroger_location_id ~ '^[0-9A-Za-z]{1,20}$'),
  add column kroger_store text check (kroger_store is null or char_length(kroger_store) <= 200);

grant update (kroger_location_id, kroger_store) on plico.planner_settings to authenticated;

-- The Kroger product a grocery item is priced from, and its latest prices.
alter table plico.grocery_items
  add column kroger_product_id text check (kroger_product_id is null or kroger_product_id ~ '^[0-9]{1,20}$'),
  add column kroger_label      text check (kroger_label is null or char_length(kroger_label) <= 300),
  add column kroger_regular    numeric(10, 2) check (kroger_regular is null or kroger_regular >= 0),
  add column kroger_promo      numeric(10, 2) check (kroger_promo is null or kroger_promo >= 0),
  add column kroger_promo_ends date,
  add column kroger_checked_at timestamptz;
