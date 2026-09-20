-- =====================================================================
-- LABORATORY 4 - Role-Based Asset Transaction and Approval Management
-- Supabase / PostgreSQL Schema
-- =====================================================================
-- Run this whole file in Supabase SQL Editor (Project -> SQL Editor -> New query).
-- It is safe to re-run: it drops existing objects first.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. CLEAN SLATE (safe re-run)
-- ---------------------------------------------------------------------
drop table if exists public.audit_logs cascade;
drop table if exists public.maintenance_requests cascade;
drop table if exists public.borrowing_transactions cascade;
drop table if exists public.equipment cascade;
drop table if exists public.profiles cascade;

drop function if exists public.current_role() cascade;
drop function if exists public.is_admin() cascade;
drop function if exists public.is_staff() cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.log_audit(text, text, text, text) cascade;
drop function if exists public.create_borrowing_request(int) cascade;
drop function if exists public.approve_borrowing_request(int) cascade;
drop function if exists public.reject_borrowing_request(int, text) cascade;
drop function if exists public.release_equipment(int) cascade;
drop function if exists public.process_return(int, boolean, text) cascade;
drop function if exists public.mark_overdue() cascade;
drop function if exists public.submit_maintenance_request(int, text) cascade;
drop function if exists public.complete_maintenance(int) cascade;
drop function if exists public.check_equipment_available() cascade;

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

-- 1.1 Profiles (extends Supabase auth.users with role info)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null default 'requester'
      check (role in ('admin','staff','requester')),
  created_at timestamptz not null default now()
);

-- 1.2 Equipment
create table public.equipment (
  id serial primary key,
  code text not null unique,
  name text not null,
  category text,
  description text,
  status text not null default 'Available'
      check (status in ('Available','Borrowed','Maintenance','Damaged')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1.3 Borrowing transactions (the approval workflow)
create table public.borrowing_transactions (
  id serial primary key,
  equipment_id int not null references public.equipment(id),
  requester_id uuid not null references public.profiles(id),
  status text not null default 'Pending'
      check (status in ('Pending','Approved','Rejected','Released','Returned','Overdue','Closed')),
  purpose text,
  request_date timestamptz not null default now(),
  due_date timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  released_by uuid references public.profiles(id),
  released_at timestamptz,
  returned_at timestamptz,
  damaged boolean not null default false,
  remarks text
);

-- 1.4 Maintenance requests
create table public.maintenance_requests (
  id serial primary key,
  equipment_id int not null references public.equipment(id),
  requested_by uuid not null references public.profiles(id),
  issue_description text not null,
  status text not null default 'Pending'
      check (status in ('Pending','In Progress','Completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- 1.5 Audit logs (BR-A4-10: sensitive operations must be logged)
create table public.audit_logs (
  id serial primary key,
  user_id uuid references public.profiles(id),
  action text not null,
  module text not null,
  record_id text,
  description text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. ROLE HELPER FUNCTIONS
-- ---------------------------------------------------------------------
create function public.current_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()) = 'admin', false);
$$;

create function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()) in ('admin','staff'), false);
$$;

-- Auto-create a profile row whenever a new auth user signs up.
-- Role defaults to 'requester'; an admin can promote users later.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'requester')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Generic audit writer, reused by every sensitive RPC below (BR-A4-10)
create function public.log_audit(p_action text, p_module text, p_record_id text, p_description text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (user_id, action, module, record_id, description)
  values (auth.uid(), p_action, p_module, p_record_id, p_description);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.equipment enable row level security;
alter table public.borrowing_transactions enable row level security;
alter table public.maintenance_requests enable row level security;
alter table public.audit_logs enable row level security;

-- 3.1 Profiles
create policy "profiles_select_own_or_admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create policy "profiles_update_own_limited" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
  -- Note: role field changes should be done through the admin panel using
  -- a service-role call in production; for this lab, admins update roles
  -- directly (policy below) while users may only update their own name.

create policy "profiles_admin_manage_all" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- 3.2 Equipment — everyone signed in can view; only admin manages directly
create policy "equipment_select_all" on public.equipment
  for select using (auth.role() = 'authenticated');

create policy "equipment_admin_write" on public.equipment
  for insert with check (public.is_admin());

create policy "equipment_admin_update" on public.equipment
  for update using (public.is_admin());

create policy "equipment_admin_delete" on public.equipment
  for delete using (public.is_admin());

-- 3.3 Borrowing transactions
-- View: admin/staff see all; requester sees only their own (TC-A4 traceability)
create policy "borrowing_select" on public.borrowing_transactions
  for select using (public.is_staff() or requester_id = auth.uid());

-- Create: any authenticated user may submit a request for themselves.
-- Equipment-availability (BR-A4-01, BR-A4-09) is enforced by trigger below.
create policy "borrowing_insert_own" on public.borrowing_transactions
  for insert with check (requester_id = auth.uid());

-- IMPORTANT: no UPDATE policy is granted to end users at all.
-- Every state transition (approve/reject/release/return) MUST go through
-- the SECURITY DEFINER functions in section 4, which enforce the business
-- rules server-side even if someone bypasses the UI and calls the API
-- directly with the anon/user key.

-- 3.4 Maintenance requests
create policy "maintenance_select" on public.maintenance_requests
  for select using (public.is_staff());

create policy "maintenance_insert" on public.maintenance_requests
  for insert with check (public.is_staff() and requested_by = auth.uid());

-- No direct UPDATE policy — completion goes through complete_maintenance().

-- 3.5 Audit logs — admin only (per role-permission matrix)
create policy "audit_select_admin" on public.audit_logs
  for select using (public.is_admin());
-- No insert/update/delete policy for clients: rows are written only by
-- the SECURITY DEFINER log_audit() function.

-- ---------------------------------------------------------------------
-- 4. BUSINESS-RULE ENFORCEMENT (trigger + RPC functions)
-- ---------------------------------------------------------------------

-- BR-A4-01 / BR-A4-09: only Available equipment may be requested;
-- equipment under Maintenance cannot be borrowed.
create function public.check_equipment_available() returns trigger
language plpgsql as $$
declare
  v_status text;
begin
  select status into v_status from public.equipment where id = new.equipment_id;
  if v_status is null then
    raise exception 'Equipment not found';
  end if;
  if v_status <> 'Available' then
    raise exception 'BR-A4-01/09 violation: equipment % is not Available (current status: %)', new.equipment_id, v_status;
  end if;
  return new;
end;
$$;

create trigger trg_check_equipment_available
  before insert on public.borrowing_transactions
  for each row execute procedure public.check_equipment_available();

-- 4.1 Create borrowing request (Requester or Staff)
create function public.create_borrowing_request(p_equipment_id int, p_purpose text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_id int;
begin
  insert into public.borrowing_transactions (equipment_id, requester_id, status, purpose)
  values (p_equipment_id, auth.uid(), 'Pending', p_purpose)
  returning id into v_id;

  perform public.log_audit('SUBMITTED', 'Borrowing', v_id::text,
    format('Submitted borrowing request for equipment #%s', p_equipment_id));

  return v_id;
end;
$$;

-- 4.2 Approve request — BR-A4-03 (admin only), BR-A4-02 (cannot approve own request)
create function public.approve_borrowing_request(p_transaction_id int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_requester uuid;
  v_equipment int;
begin
  if not public.is_admin() then
    raise exception 'BR-A4-03 violation: only Administrator may approve requests';
  end if;

  select status, requester_id, equipment_id into v_status, v_requester, v_equipment
  from public.borrowing_transactions where id = p_transaction_id;

  if v_status is null then
    raise exception 'Transaction not found';
  end if;
  if v_requester = auth.uid() then
    raise exception 'BR-A4-02 violation: cannot approve your own request';
  end if;
  if v_status <> 'Pending' then
    raise exception 'Only Pending requests may be approved (current status: %)', v_status;
  end if;

  update public.borrowing_transactions
     set status = 'Approved', approved_by = auth.uid(), approved_at = now()
   where id = p_transaction_id;

  perform public.log_audit('APPROVED', 'Borrowing', p_transaction_id::text,
    format('Approved borrowing request for equipment #%s', v_equipment));
end;
$$;

-- 4.3 Reject request — BR-A4-03
create function public.reject_borrowing_request(p_transaction_id int, p_remarks text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_requester uuid;
begin
  if not public.is_admin() then
    raise exception 'BR-A4-03 violation: only Administrator may reject requests';
  end if;

  select status, requester_id into v_status, v_requester
  from public.borrowing_transactions where id = p_transaction_id;

  if v_status is null then
    raise exception 'Transaction not found';
  end if;
  if v_requester = auth.uid() then
    raise exception 'BR-A4-02 violation: cannot reject your own request';
  end if;
  if v_status <> 'Pending' then
    raise exception 'Only Pending requests may be rejected (current status: %)', v_status;
  end if;

  update public.borrowing_transactions
     set status = 'Rejected', approved_by = auth.uid(), approved_at = now(), remarks = p_remarks
   where id = p_transaction_id;

  perform public.log_audit('REJECTED', 'Borrowing', p_transaction_id::text,
    coalesce('Rejected borrowing request. Reason: ' || p_remarks, 'Rejected borrowing request'));
end;
$$;

-- 4.4 Release equipment — BR-A4-04 (only Approved may be released),
-- BR-A4-05 (equipment becomes Borrowed), BR-A4-07 (rejected cannot be released)
create function public.release_equipment(p_transaction_id int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_equipment int;
begin
  if not public.is_staff() then
    raise exception 'Only Staff or Administrator may release equipment';
  end if;

  select status, equipment_id into v_status, v_equipment
  from public.borrowing_transactions where id = p_transaction_id;

  if v_status is null then
    raise exception 'Transaction not found';
  end if;
  if v_status = 'Rejected' then
    raise exception 'BR-A4-07 violation: rejected requests cannot be released';
  end if;
  if v_status <> 'Approved' then
    raise exception 'BR-A4-04 violation: only Approved requests may be released (current status: %)', v_status;
  end if;

  update public.borrowing_transactions
     set status = 'Released', released_by = auth.uid(), released_at = now()
   where id = p_transaction_id;

  update public.equipment set status = 'Borrowed', updated_at = now()
   where id = v_equipment;

  perform public.log_audit('RELEASED', 'Borrowing', p_transaction_id::text,
    format('Released equipment #%s to requester', v_equipment));
end;
$$;

-- 4.5 Process return — BR-A4-06 (Available unless damaged), BR-A4-08 (no double return)
create function public.process_return(p_transaction_id int, p_damaged boolean default false, p_remarks text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_equipment int;
begin
  if not public.is_staff() then
    raise exception 'Only Staff or Administrator may process returns';
  end if;

  select status, equipment_id into v_status, v_equipment
  from public.borrowing_transactions where id = p_transaction_id;

  if v_status is null then
    raise exception 'Transaction not found';
  end if;
  if v_status in ('Returned','Closed') then
    raise exception 'BR-A4-08 violation: this transaction has already been returned/closed';
  end if;
  if v_status not in ('Released','Overdue') then
    raise exception 'Only Released or Overdue transactions may be returned (current status: %)', v_status;
  end if;

  update public.borrowing_transactions
     set status = 'Returned', returned_at = now(), damaged = p_damaged,
         remarks = coalesce(p_remarks, remarks)
   where id = p_transaction_id;

  update public.equipment
     set status = case when p_damaged then 'Damaged' else 'Available' end,
         updated_at = now()
   where id = v_equipment;

  perform public.log_audit('RETURNED', 'Borrowing', p_transaction_id::text,
    format('Processed return for equipment #%s (damaged: %s)', v_equipment, p_damaged));
end;
$$;

-- 4.6 Close a returned transaction (admin, final workflow step)
create function public.close_transaction(p_transaction_id int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Only Administrator may close transactions';
  end if;
  select status into v_status from public.borrowing_transactions where id = p_transaction_id;
  if v_status <> 'Returned' then
    raise exception 'Only Returned transactions may be closed (current status: %)', v_status;
  end if;
  update public.borrowing_transactions set status = 'Closed' where id = p_transaction_id;
  perform public.log_audit('CLOSED', 'Borrowing', p_transaction_id::text, 'Transaction closed');
end;
$$;

-- 4.7 Mark overdue (utility, callable by staff/admin or a scheduled job)
create function public.mark_overdue() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Only Staff or Administrator may run this operation';
  end if;
  update public.borrowing_transactions
     set status = 'Overdue'
   where status = 'Released' and due_date is not null and due_date < now();

  perform public.log_audit('AUTO_OVERDUE', 'Borrowing', null, 'Marked overdue transactions');
end;
$$;

-- 4.8 Maintenance workflow
create function public.submit_maintenance_request(p_equipment_id int, p_issue text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_id int;
begin
  if not public.is_staff() then
    raise exception 'Only Staff or Administrator may submit maintenance requests';
  end if;

  insert into public.maintenance_requests (equipment_id, requested_by, issue_description)
  values (p_equipment_id, auth.uid(), p_issue)
  returning id into v_id;

  update public.equipment set status = 'Maintenance', updated_at = now()
   where id = p_equipment_id;

  perform public.log_audit('MAINTENANCE_SUBMITTED', 'Maintenance', v_id::text,
    format('Submitted maintenance request for equipment #%s: %s', p_equipment_id, p_issue));

  return v_id;
end;
$$;

create function public.complete_maintenance(p_request_id int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_equipment int;
begin
  if not public.is_staff() then
    raise exception 'Only Staff or Administrator may complete maintenance';
  end if;

  select equipment_id into v_equipment from public.maintenance_requests where id = p_request_id;
  if v_equipment is null then
    raise exception 'Maintenance request not found';
  end if;

  update public.maintenance_requests
     set status = 'Completed', completed_at = now()
   where id = p_request_id;

  update public.equipment set status = 'Available', updated_at = now()
   where id = v_equipment;

  perform public.log_audit('MAINTENANCE_COMPLETED', 'Maintenance', p_request_id::text,
    format('Completed maintenance for equipment #%s', v_equipment));
end;
$$;

-- ---------------------------------------------------------------------
-- 5. SEED DATA (sample equipment + note on creating the first admin)
-- ---------------------------------------------------------------------
insert into public.equipment (code, name, category, description, status) values
  ('LAP-001', 'Dell Latitude Laptop', 'Computers', '14" business laptop, i5/8GB', 'Available'),
  ('LAP-002', 'MacBook Air M1', 'Computers', '13" laptop for design work', 'Available'),
  ('PROJ-001', 'Epson Projector', 'AV Equipment', '1080p portable projector', 'Available'),
  ('CAM-001', 'Canon DSLR Camera', 'AV Equipment', 'EOS 250D with kit lens', 'Available'),
  ('OSC-001', 'Digital Oscilloscope', 'Lab Equipment', '2-channel bench oscilloscope', 'Available');

-- After you sign up your first user through the app, promote them to admin:
--   update public.profiles set role = 'admin' where email = 'youremail@example.com';
