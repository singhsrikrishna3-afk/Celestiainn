-- Celestia Inn LLP — booking engine schema (Supabase / PostgreSQL)
-- Run once in the Supabase SQL editor, then edit the rates in the seed at the bottom.

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Properties: one row per bookable stay. Rates live here, NOT in the frontend,
-- so the server is always the authority on price.
-- ---------------------------------------------------------------------------
create table if not exists properties (
  id                   text         primary key,
  name                 text         not null,
  location             text,
  active               boolean      not null default true,
  base_rate_inr        integer      not null,            -- per night, covers base_guests
  base_guests          integer      not null default 2,
  extra_guest_rate_inr integer      not null default 0,  -- per extra guest, per night
  max_guests           integer      not null default 4,
  min_nights           integer      not null default 1,
  max_nights           integer      not null default 21,
  max_advance_days     integer      not null default 365,
  tax_percent          numeric(5,2) not null default 12.00,
  created_at           timestamptz  not null default now()
);

-- ---------------------------------------------------------------------------
-- Bookings. stay_dates is a half-open range '[)' so a guest checking out on
-- the 15th frees the 15th for the next arrival — correct hotel semantics.
-- ---------------------------------------------------------------------------
create table if not exists bookings (
  id                  uuid        primary key default gen_random_uuid(),
  reference           text        not null unique,
  property_id         text        not null references properties(id),

  guest_name          text        not null,
  guest_email         text        not null,
  guest_phone         text        not null,
  guest_notes         text,

  check_in            date        not null,
  check_out           date        not null,
  guests              integer     not null,
  nights              integer     generated always as (check_out - check_in) stored,
  stay_dates          daterange   generated always as (daterange(check_in, check_out, '[)')) stored,

  rate_per_night_inr  integer     not null,
  subtotal_inr        integer     not null,
  tax_inr             integer     not null,
  total_inr           integer     not null,
  amount_paid_inr     integer     not null default 0,

  status              text        not null default 'pending',
  razorpay_order_id   text        unique,
  razorpay_payment_id text,
  hold_expires_at     timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint chk_status check (status in ('pending','paid','failed','expired','cancelled')),
  constraint chk_dates  check (check_out > check_in),
  constraint chk_guests check (guests >= 1)
);

-- THE double-booking guard. Postgres refuses, at the storage layer, any two
-- overlapping stays for the same property while they hold inventory. Two guests
-- paying for the same nights at the same instant is physically impossible:
-- the second transaction raises SQLSTATE 23P01 and the API returns 409.
alter table bookings drop constraint if exists bookings_no_overlap;
alter table bookings add constraint bookings_no_overlap
  exclude using gist (property_id with =, stay_dates with &&)
  where (status in ('pending','paid'));

create index if not exists bookings_property_dates_idx
  on bookings using gist (property_id, stay_dates);
create index if not exists bookings_status_hold_idx
  on bookings (status, hold_expires_at);
create index if not exists bookings_email_idx on bookings (guest_email);

-- Keep updated_at honest.
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists bookings_touch on bookings;
create trigger bookings_touch before update on bookings
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security. The API uses the service_role key, which bypasses RLS.
-- Enabling it with no read policy means a leaked anon key exposes no guest
-- names, emails, phone numbers or payment ids.
-- ---------------------------------------------------------------------------
alter table bookings   enable row level security;
alter table properties enable row level security;

drop policy if exists properties_public_read on properties;
create policy properties_public_read on properties for select using (active);

-- ---------------------------------------------------------------------------
-- SEED — ⚠️ THE RATES BELOW ARE PLACEHOLDERS. Replace with real THP pricing.
-- GST note: 12% applies to tariffs up to ₹7,500/night; use 18.00 above that.
-- ---------------------------------------------------------------------------
insert into properties
  (id, name, location, base_rate_inr, base_guests, extra_guest_rate_inr,
   max_guests, min_nights, max_nights, tax_percent)
values
  ('thp', 'THP — The Higher Plane',
   'Shangarh, Sainj Valley, Kullu District, Himachal Pradesh',
   4500, 2, 1200, 6, 1, 21, 12.00)
on conflict (id) do nothing;
