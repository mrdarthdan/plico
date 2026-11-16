-- Meal planner, part 4: taking a cooked meal's ingredients out of the pantry,
-- and remembering every price a grocery item has had.

-- ---------------------------------------------------------------------------
-- Pantry: take and give back, all or nothing
-- ---------------------------------------------------------------------------

-- Takes amounts out of pantry lots: [{"lot": 12, "qty": 1.5}, ...], each qty
-- in that lot's own unit. Lots that reach zero are removed. Runs with the
-- caller's rights, so row-level security still applies.
create function plico.pantry_take(p_take jsonb)
returns void
language plpgsql set search_path = ''
as $$
declare
  r jsonb;
begin
  if not plico.can_plan() then
    raise exception 'Only meal planners can change the pantry' using errcode = '42501';
  end if;
  if jsonb_typeof(p_take) <> 'array' then
    raise exception 'Expected a list' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_take) loop
    if (r->>'qty')::numeric < 0 then
      raise exception 'Amounts taken must not be negative' using errcode = '22023';
    end if;
    update plico.pantry
       set qty = greatest(0, qty - (r->>'qty')::numeric)
     where id = (r->>'lot')::bigint;
  end loop;
  delete from plico.pantry
   where qty <= 0.0005
     and id in (select (x->>'lot')::bigint from jsonb_array_elements(p_take) x);
end;
$$;

-- Puts amounts back, to undo pantry_take: [{"lot": 12, "qty": 1.5, "item": 3,
-- "unit": "lb", "location": "Pantry", "expires": null}, ...]. A lot that was
-- used up is recreated from the saved details.
create function plico.pantry_return(p_return jsonb)
returns void
language plpgsql set search_path = ''
as $$
declare
  r jsonb;
begin
  if not plico.can_plan() then
    raise exception 'Only meal planners can change the pantry' using errcode = '42501';
  end if;
  for r in select * from jsonb_array_elements(p_return) loop
    if (r->>'qty')::numeric <= 0 then
      continue;
    end if;
    update plico.pantry set qty = qty + (r->>'qty')::numeric where id = (r->>'lot')::bigint;
    if not found and exists (select 1 from plico.grocery_items g where g.id = (r->>'item')::bigint) then
      insert into plico.pantry (grocery_item_id, qty, unit, location, expires)
      values ((r->>'item')::bigint, (r->>'qty')::numeric, r->>'unit',
              coalesce(nullif(r->>'location', ''), 'Pantry'), (r->>'expires')::date);
    end if;
  end loop;
end;
$$;

revoke execute on function plico.pantry_take(jsonb), plico.pantry_return(jsonb) from public;
grant execute on function plico.pantry_take(jsonb), plico.pantry_return(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Price history
-- ---------------------------------------------------------------------------

-- One row each time an item's price (or the package it's priced for) changes.
create table plico.price_history (
  id               bigint generated always as identity primary key,
  grocery_item_id  bigint not null references plico.grocery_items (id) on delete cascade,
  price            numeric(10, 2) not null,
  package_qty      numeric(12, 3) not null,
  package_unit     text not null,
  source           text,
  recorded_at      timestamptz not null default now()
);

create index price_history_item_idx on plico.price_history (grocery_item_id, recorded_at desc);

-- Written only by this trigger, so clients can read history but not invent it.
create function plico.grocery_items_price_history()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.price is not null and (
       tg_op = 'INSERT'
       or new.price is distinct from old.price
       or new.package_qty is distinct from old.package_qty
       or new.package_unit is distinct from old.package_unit) then
    insert into plico.price_history (grocery_item_id, price, package_qty, package_unit, source)
    values (new.id, new.price, new.package_qty, new.package_unit, new.price_source);
  end if;
  return new;
end;
$$;

create trigger grocery_items_price_history after insert or update on plico.grocery_items
  for each row execute function plico.grocery_items_price_history();

revoke execute on function plico.grocery_items_price_history() from public;

-- Prices already set before this migration start the history.
insert into plico.price_history (grocery_item_id, price, package_qty, package_unit, source, recorded_at)
select id, price, package_qty, package_unit, price_source, coalesce(price_updated_at, updated_at)
from plico.grocery_items
where price is not null;

alter table plico.price_history enable row level security;

create policy "price_history: planners read" on plico.price_history for select to authenticated
  using ((select plico.can_plan()));

grant select on plico.price_history to authenticated;
grant all on plico.price_history to service_role;
grant all on all sequences in schema plico to service_role;
