-- Meu Financeiro — schema Supabase
-- Rode este arquivo inteiro no SQL Editor do seu projeto Supabase.
-- Cada tabela tem RLS habilitado: cada usuário só enxerga e altera as próprias linhas.

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  type text not null check (type in ('expense','income')),
  amount numeric(12,2) not null check (amount > 0),
  category text not null,
  payment text not null,
  description text default '',
  created_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  position int not null default 0,
  unique (user_id, name)
);

create table if not exists payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  position int not null default 0,
  unique (user_id, name)
);

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category text not null,
  limit_amount numeric(12,2) not null,
  unique (user_id, category)
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  amount numeric(12,2) not null,
  category text not null,
  payment text not null,
  day int not null default 1,
  active boolean not null default true,
  last_launched_month text
);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  target numeric(12,2) not null,
  current numeric(12,2) not null default 0
);

create table if not exists user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  cdi_rate numeric(6,2) not null default 13.90,
  theme text not null default 'system'
);

alter table transactions enable row level security;
alter table categories enable row level security;
alter table payment_methods enable row level security;
alter table budgets enable row level security;
alter table subscriptions enable row level security;
alter table goals enable row level security;
alter table user_settings enable row level security;

create policy "owner full access" on transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner full access" on categories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner full access" on payment_methods for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner full access" on budgets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner full access" on subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner full access" on goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner full access" on user_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
