-- Pantry: what the household has on hand, and barcodes that identify grocery
-- items when scanned. Part of the meal planner; same access rule (editors and
-- admins while the planner is on).

-- A barcode is a specific product (brand and size) of a grocery item. One
-- item can have many: different brands, different sizes.
create table plico.barcodes (
  -- UPC-A as 12 digits, EAN-13 as 13, UPC-E / EAN-8 as scanned.
  code             text primary key check (code ~ '^[0-9]{6,14}$'),
  grocery_item_id  bigint not null references plico.grocery_items (id) on delete cascade,
  product_name     text check (product_name is null or char_length(product_name) <= 200),
  brand            text check (brand is null or char_length(brand) <= 120),
  -- The size of this product, which may differ from the item's usual package.
  size_qty         numeric(12, 3) check (size_qty is null or size_qty > 0),
  size_unit        text check (size_unit is null or size_unit in ('each', 'oz', 'lb', 'g', 'kg',
                     'fl oz', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'pt', 'qt', 'gal')),
  created_at       timestamptz not null default now()
);

create index barcodes_item_idx on plico.barcodes (grocery_item_id);

-- One row per lot on hand: "3.5 lb of flour in the pantry", "12 eggs in the
-- fridge, use by Nov 30". An item can have several lots with different dates.
create table plico.pantry (
  id               bigint generated always as identity primary key,
  grocery_item_id  bigint not null references plico.grocery_items (id) on delete cascade,
  qty              numeric(12, 3) not null check (qty >= 0 and qty < 1000000),
  unit             text not null check (unit in ('each', 'oz', 'lb', 'g', 'kg',
                     'fl oz', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'pt', 'qt', 'gal')),
  location         text not null default 'Pantry' check (char_length(location) between 1 and 40),
  expires          date,
  added_at         timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index pantry_item_idx on plico.pantry (grocery_item_id);

create trigger pantry_touch before update on plico.pantry
  for each row execute function plico.planner_touch();

-- Shopping-list lines already put away into the pantry, so they aren't added twice.
alter table plico.meal_plans add column stocked text[] not null default '{}';

-- The single UPC column is replaced by plico.barcodes.
alter table plico.grocery_items drop column upc;

alter table plico.barcodes enable row level security;
alter table plico.pantry   enable row level security;

create policy "barcodes: planners read" on plico.barcodes for select to authenticated
  using ((select plico.can_plan()));
create policy "barcodes: planners insert" on plico.barcodes for insert to authenticated
  with check ((select plico.can_plan()));
create policy "barcodes: planners update" on plico.barcodes for update to authenticated
  using ((select plico.can_plan())) with check ((select plico.can_plan()));
create policy "barcodes: planners delete" on plico.barcodes for delete to authenticated
  using ((select plico.can_plan()));

create policy "pantry: planners read" on plico.pantry for select to authenticated
  using ((select plico.can_plan()));
create policy "pantry: planners insert" on plico.pantry for insert to authenticated
  with check ((select plico.can_plan()));
create policy "pantry: planners update" on plico.pantry for update to authenticated
  using ((select plico.can_plan())) with check ((select plico.can_plan()));
create policy "pantry: planners delete" on plico.pantry for delete to authenticated
  using ((select plico.can_plan()));

grant select, insert, update, delete on plico.barcodes, plico.pantry to authenticated;
grant all on plico.barcodes, plico.pantry to service_role;
grant all on all sequences in schema plico to service_role;
