-- Access-rule checks. On a plain Postgres 15+: run local_stub.sql (fakes the Supabase
-- roles and auth schema, plus the three test accounts), then the migration,
-- then seed.sql, then this file. Each block says what to expect.
\set ON_ERROR_STOP off
\echo == anon reads (expect 2 recipes)
set role anon; select count(*) from plico.recipes;
\echo == anon insert (expect permission denied)
insert into plico.sections(name) values ('x');
\echo == anon bootstrap (expect denied)
select plico.bootstrap_admin('view@example.com');
reset role;
\echo == viewer
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; set role authenticated;
select (plico.ensure_profile()).role;
\echo viewer insert recipe (expect RLS violation)
insert into plico.recipes(id,title,section_id) values ('v','V',1);
\echo viewer self-promote attempts (expect denied x3)
update plico.profiles set role='admin';
select plico.set_role('00000000-0000-0000-0000-000000000003','admin');
select plico.bootstrap_admin('view@example.com');
select * from plico.list_members();
\echo viewer update/delete recipes (expect 0 rows)
update plico.recipes set title='hack'; delete from plico.recipes;
reset role;
\echo == bootstrap admin via postgres
select plico.bootstrap_admin('ADMIN@example.com');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; set role authenticated;
select plico.my_role();
select plico.set_display_name('Chef Admin');
select plico.set_role('00000000-0000-0000-0000-000000000003','editor');
select email, role from plico.list_members();
\echo demote last admin (expect error)
select plico.set_role('00000000-0000-0000-0000-000000000001','viewer');
insert into plico.sections(name,sort) values ('Drinks',60) returning id;
update plico.settings set public_read=false, site_name='Test';
\echo admin tries to set updated_at column directly (expect denied)
update plico.settings set id=2;
\echo admin insert: created_by is forced to the caller (expect ...0001), blank credit defaults to display name
insert into plico.recipes(id,title,section_id,created_by,contributor) values ('admin-dish','A',1,'00000000-0000-0000-0000-000000000003','  ') returning created_by, contributor;
reset role;
\echo == now-editor
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; set role authenticated;
insert into plico.recipes(id,title,section_id) values ('ed-dish','E',1) returning created_by, contributor;
\echo editor update: slug and created_by frozen, credit editable (expect ed-dish, ...0003, From Nana)
update plico.recipes set id='renamed', created_by=null, contributor='From Nana', title='E2' where id='ed-dish' returning id, created_by, contributor, title;
\echo editor manage sections/settings (expect RLS fail / 0 rows)
insert into plico.sections(name) values ('nope');
update plico.settings set site_name='hacked'; select site_name from plico.settings;
\echo editor sees only own profile (expect 1)
select count(*) from plico.profiles;
reset role;
\echo == anon with public_read=false (expect 0, 0)
set request.jwt.claim.sub=''; set role anon; select count(*) from plico.recipes; select count(*) from plico.sections; select site_name from plico.settings;
reset role;
\echo == bad data (expect check violations)
insert into plico.recipes(id,title,section_id) values ('Bad Slug','x',1);
insert into plico.recipes(id,title,section_id,steps) values ('ok','x',1,'{}');
\echo == favorites
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; set role authenticated;
insert into plico.favorites(recipe_id) values ('weeknight-chili') returning user_id, recipe_id;
\echo favorite for someone else (expect RLS violation)
insert into plico.favorites(user_id, recipe_id) values ('00000000-0000-0000-0000-000000000001','weeknight-chili');
\echo favorite a recipe that does not exist (expect foreign key violation)
insert into plico.favorites(recipe_id) values ('no-such-recipe');
reset role;
\echo another user sees none of them, and cannot remove them (expect 0, then 1 left)
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; set role authenticated;
select count(*) from plico.favorites; delete from plico.favorites;
reset role; select count(*) from plico.favorites;
\echo signed out (expect permission denied)
set request.jwt.claim.sub=''; set role anon; select count(*) from plico.favorites;
reset role;
\echo == meal planner (run after 20261116000000_meal_planner.sql)
\echo planner off: even the admin sees no planner rows (expect 0, then RLS violation)
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; set role authenticated;
select count(*) from plico.planner_settings;
insert into plico.grocery_items(name) values ('flour');
\echo admin turns it on (expect true)
update plico.settings set planner_enabled = true returning planner_enabled;
insert into plico.grocery_items(name, package_qty, package_unit, price) values ('flour', 5, 'lb', 3.98) returning name;
insert into plico.meal_plans(week_start, budget, household_size) values ('2026-11-15', 150, 4) returning updated_by;
reset role;
\echo editor (user 3 was promoted above) shares the household plan (expect 1, 1, 1 row updated)
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; set role authenticated;
select count(*) from plico.meal_plans; select count(*) from plico.grocery_items;
update plico.planner_settings set weekly_budget = 175;
\echo editor cannot turn the planner off (expect 0 rows)
update plico.settings set planner_enabled = false; 
reset role;
\echo viewer sees nothing and writes nothing (expect 0, 0, RLS violation)
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; set role authenticated;
select plico.ensure_profile();
select count(*) from plico.meal_plans; select count(*) from plico.grocery_items;
insert into plico.meal_plans(week_start, budget, household_size) values ('2026-11-22', 1, 1);
reset role;
\echo signed out (expect permission denied)
set request.jwt.claim.sub=''; set role anon; select count(*) from plico.meal_plans;
reset role;
\echo bad data (expect check violations)
insert into plico.grocery_items(name, package_unit) values ('x', 'bushel');
insert into plico.meal_plans(week_start, budget, household_size, meals) values ('2026-11-29', 1, 1, '{}');
\echo == pantry (run after 20261117000000_pantry.sql)
\echo editor stocks the pantry and links a barcode (expect 1 row each)
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; set role authenticated;
insert into plico.pantry(grocery_item_id, qty, unit, expires) select id, 4.5, 'lb', '2027-01-01' from plico.grocery_items where name = 'flour' returning qty, unit;
insert into plico.barcodes(code, grocery_item_id, size_qty, size_unit) select '078742012315', id, 5, 'lb' from plico.grocery_items where name = 'flour' returning code;
reset role;
\echo viewer sees neither (expect 0, 0)
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; set role authenticated;
select count(*) from plico.pantry; select count(*) from plico.barcodes;
reset role;
\echo bad data (expect check violations)
insert into plico.pantry(grocery_item_id, qty, unit) select id, -1, 'lb' from plico.grocery_items limit 1;
insert into plico.barcodes(code, grocery_item_id) select 'abc', id from plico.grocery_items limit 1;
\echo deleting the item removes its stock and barcodes (expect 0, 0)
delete from plico.grocery_items where name = 'flour';
select count(*) from plico.pantry; select count(*) from plico.barcodes;
\echo == kroger (run after 20261118000000_kroger.sql)
\echo editor picks a store and links an item (expect 1 row each)
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; set role authenticated;
update plico.planner_settings set kroger_location_id = '66000622', kroger_store = 'Fry''s Marketplace' returning kroger_location_id;
insert into plico.grocery_items(name, kroger_product_id, kroger_regular, kroger_promo) values ('oats', '0001111085012', 4.49, 3.99) returning kroger_product_id;
\echo bad product id (expect check violation)
update plico.grocery_items set kroger_product_id = 'abc' where name = 'oats';
reset role;
\echo == cooking and history (run after 20261119000000_cooking_history.sql)
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; set role authenticated;
insert into plico.grocery_items(name, package_qty, package_unit, price, price_source) values ('rice', 2, 'lb', 2.50, 'manual');
update plico.grocery_items set price = 2.75, price_source = 'kroger' where name = 'rice';
update plico.grocery_items set category = 'Pantry' where name = 'rice';
\echo history: two rows, the category change adds none (expect 2.50, 2.75)
select h.price from plico.price_history h join plico.grocery_items g on g.id = h.grocery_item_id where g.name = 'rice' order by h.id;
\echo editor cannot write history directly (expect RLS violation or permission denied)
insert into plico.price_history(grocery_item_id, price, package_qty, package_unit) select id, 0.01, 1, 'lb' from plico.grocery_items where name = 'rice';
insert into plico.pantry(grocery_item_id, qty, unit, expires) select id, 2, 'lb', '2026-12-01' from plico.grocery_items where name = 'rice';
insert into plico.pantry(grocery_item_id, qty, unit) select id, 1, 'lb' from plico.grocery_items where name = 'rice';
\echo take 2.5 lb across two lots: first lot used up, second left with 0.5 (expect 1 row, 0.500)
select plico.pantry_take((select jsonb_agg(jsonb_build_object('lot', id, 'qty', q)) from (select id, case when expires is not null then 2 else 0.5 end q from plico.pantry p where grocery_item_id = (select id from plico.grocery_items where name = 'rice')) t));
select qty from plico.pantry where grocery_item_id = (select id from plico.grocery_items where name = 'rice');
\echo negative take refused (expect error)
select plico.pantry_take('[{"lot": 1, "qty": -5}]');
\echo give back: the used-up lot is recreated with its date (expect 2 rows: 2.000 with 2026-12-01, 1.000)
select plico.pantry_return(jsonb_build_array(
  jsonb_build_object('lot', 999999, 'qty', 2, 'item', (select id from plico.grocery_items where name = 'rice'), 'unit', 'lb', 'location', 'Pantry', 'expires', '2026-12-01'),
  jsonb_build_object('lot', (select id from plico.pantry where grocery_item_id = (select id from plico.grocery_items where name = 'rice')), 'qty', 0.5)));
select qty, expires from plico.pantry where grocery_item_id = (select id from plico.grocery_items where name = 'rice') order by qty desc;
reset role;
\echo viewer cannot take from the pantry or read history (expect error, 0)
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; set role authenticated;
select plico.pantry_take('[]');
select count(*) from plico.price_history;
reset role;
