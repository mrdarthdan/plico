-- Meal planner: an optional module, off until an admin turns it on.
--
-- One shared household per install: everyone who may plan sees the same
-- weekly plans, grocery prices and settings. Planning is open to editors and
-- admins while the module is on; viewers and signed-out visitors see nothing.

-- ---------------------------------------------------------------------------
-- Switch
-- ---------------------------------------------------------------------------

alter table plico.settings
  add column planner_enabled boolean not null default false;

grant update (planner_enabled) on plico.settings to authenticated;

-- Whether the caller may use the meal planner.
create function plico.can_plan()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select s.planner_enabled from plico.settings s where s.id = 1), false)
     and plico.is_editor();
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Single-row household settings for the planner.
create table plico.planner_settings (
  id              integer primary key default 1 check (id = 1),
  weekly_budget   numeric(10, 2) not null default 150
                    check (weekly_budget >= 0 and weekly_budget < 100000),
  household_size  integer not null default 4
                    check (household_size between 1 and 30),
  -- 0 = weeks start on Sunday, 1 = Monday
  week_starts_on  integer not null default 0 check (week_starts_on in (0, 1)),
  -- Which meals to plan and which recipe sections feed each one:
  -- {"breakfast": {"on": true, "sections": [1]}, "lunch": {...}, "dinner": {...}}
  -- An empty section list means "guess from the section names".
  slots           jsonb not null default
                    '{"breakfast":{"on":true,"sections":[]},
                      "lunch":{"on":true,"sections":[]},
                      "dinner":{"on":true,"sections":[]}}'::jsonb
                    check (jsonb_typeof(slots) = 'object'),
  -- Ingredient names that never go on a shopping list, e.g. "water".
  ignored         text[] not null default '{water,ice}',
  updated_at      timestamptz not null default now()
);

insert into plico.planner_settings (id) values (1);

-- Things you buy, with the package you buy them in and what it costs.
create table plico.grocery_items (
  id                bigint generated always as identity primary key,
  name              text not null unique check (char_length(name) between 1 and 120),
  category          text check (category is null or char_length(category) <= 40),
  -- One package: e.g. 5 lb of flour, 12 each of eggs, 14.5 oz of tomatoes.
  package_qty       numeric(12, 3) not null default 1 check (package_qty > 0),
  package_unit      text not null default 'each'
                      check (package_unit in ('each', 'oz', 'lb', 'g', 'kg',
                        'fl oz', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'pt', 'qt', 'gal')),
  -- Price of one package. Null until someone enters or looks it up.
  price             numeric(10, 2) check (price is null or price >= 0),
  price_source      text check (price_source is null
                      or price_source in ('manual', 'receipt', 'kroger')),
  price_updated_at  timestamptz,
  -- How a recipe unit maps onto this item's package unit when plain unit
  -- conversion can't, e.g. flour bought by the lb: {"cup": 0.28};
  -- garlic bought by the head: {"clove": 0.1}.
  conversions       jsonb not null default '{}'::jsonb
                      check (jsonb_typeof(conversions) = 'object'),
  -- Staples (salt, spices, oil) are assumed to be on hand and aren't costed
  -- per meal; they're listed so you can check.
  staple            boolean not null default false,
  -- Extra ingredient names that mean this item, e.g. "all purpose flour".
  aliases           text[] not null default '{}',
  upc               text check (upc is null or upc ~ '^[0-9]{6,14}$'),
  updated_at        timestamptz not null default now()
);

-- One row per planned week, keyed by the week's first day.
create table plico.meal_plans (
  week_start      date primary key,
  budget          numeric(10, 2) not null check (budget >= 0 and budget < 100000),
  household_size  integer not null check (household_size between 1 and 30),
  -- [{"day": 0-6, "slot": "breakfast"|"lunch"|"dinner", "recipe_id": "...",
  --   "batches": 1, "locked": false, "leftover": false, "note": null}]
  meals           jsonb not null default '[]'::jsonb
                    check (jsonb_typeof(meals) = 'array'),
  -- Shopping list lines ticked off, by line key.
  checked         text[] not null default '{}',
  -- Extra shopping-list lines: [{"label": "Paper towels", "cost": 6.5}]
  extras          jsonb not null default '[]'::jsonb
                    check (jsonb_typeof(extras) = 'array'),
  updated_at      timestamptz not null default now(),
  updated_by      uuid default auth.uid() references auth.users (id) on delete set null,
  constraint meal_plans_size check (
    octet_length(meals::text) + octet_length(extras::text) < 100000
  )
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function plico.planner_touch()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger planner_settings_touch before update on plico.planner_settings
  for each row execute function plico.planner_touch();
create trigger grocery_items_touch before update on plico.grocery_items
  for each row execute function plico.planner_touch();

create function plico.meal_plans_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger meal_plans_before_write before insert or update on plico.meal_plans
  for each row execute function plico.meal_plans_before_write();

-- ---------------------------------------------------------------------------
-- Row-level security: planners only, for everything.
-- ---------------------------------------------------------------------------

alter table plico.planner_settings enable row level security;
alter table plico.grocery_items    enable row level security;
alter table plico.meal_plans       enable row level security;

create policy "planner_settings: planners read"
  on plico.planner_settings for select to authenticated
  using ((select plico.can_plan()));
create policy "planner_settings: planners update"
  on plico.planner_settings for update to authenticated
  using ((select plico.can_plan())) with check ((select plico.can_plan()));

create policy "grocery_items: planners read"
  on plico.grocery_items for select to authenticated
  using ((select plico.can_plan()));
create policy "grocery_items: planners insert"
  on plico.grocery_items for insert to authenticated
  with check ((select plico.can_plan()));
create policy "grocery_items: planners update"
  on plico.grocery_items for update to authenticated
  using ((select plico.can_plan())) with check ((select plico.can_plan()));
create policy "grocery_items: planners delete"
  on plico.grocery_items for delete to authenticated
  using ((select plico.can_plan()));

create policy "meal_plans: planners read"
  on plico.meal_plans for select to authenticated
  using ((select plico.can_plan()));
create policy "meal_plans: planners insert"
  on plico.meal_plans for insert to authenticated
  with check ((select plico.can_plan()));
create policy "meal_plans: planners update"
  on plico.meal_plans for update to authenticated
  using ((select plico.can_plan())) with check ((select plico.can_plan()));
create policy "meal_plans: planners delete"
  on plico.meal_plans for delete to authenticated
  using ((select plico.can_plan()));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select on plico.planner_settings to authenticated;
grant update (weekly_budget, household_size, week_starts_on, slots, ignored)
  on plico.planner_settings to authenticated;
grant select, insert, update, delete on plico.grocery_items, plico.meal_plans
  to authenticated;

grant all on plico.planner_settings, plico.grocery_items, plico.meal_plans
  to service_role;
grant all on all sequences in schema plico to service_role;

revoke execute on function plico.can_plan() from public;
grant execute on function plico.can_plan() to anon, authenticated, service_role;
revoke execute on function plico.planner_touch(), plico.meal_plans_before_write() from public;
