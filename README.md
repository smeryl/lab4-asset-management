# Laboratory 4 — Role-Based Asset Transaction and Approval Management

Systems Analysis and Design | Section A

A role-based extension of the Laboratory Asset and Service Management System, adding
authentication, a borrowing approval workflow, business-rule enforcement, and a full
audit trail. Built with **GitHub Pages** (static frontend) + **Supabase** (Postgres,
Auth, Row Level Security).

---

## 1. Architecture

```
Browser (GitHub Pages static site)
   │  supabase-js client (anon key — safe to expose)
   ▼
Supabase
   ├─ Auth            → email/password login, issues JWT with user id
   ├─ Postgres tables  → profiles, equipment, borrowing_transactions,
   │                      maintenance_requests, audit_logs
   ├─ Row Level Security → authorization enforced at the DATABASE level,
   │                        not just hidden UI buttons
   └─ RPC functions (SECURITY DEFINER) → every state transition
        (approve / reject / release / return / maintenance) runs through
        a Postgres function that re-checks the business rules and writes
        the audit log row, so the rules hold even if someone calls the
        API directly and skips the UI.
```

This satisfies the lab's objective: **"Verify that authorization is enforced at both
interface and database levels."** The frontend hides buttons a role shouldn't see, and
the database refuses the operation even if a user forges a request around the UI.

## 2. Repository layout

```
lab4-system/
├── database/
│   └── schema.sql          # Tables, RLS policies, RPC functions, seed data
├── public/                 # This is what you deploy to GitHub Pages
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── supabaseClient.js   # <-- put your Supabase URL + anon key here
│       └── main.js             # All app logic (auth, routing, screens)
├── docs/
│   ├── ERD.md
│   ├── UseCaseDiagram.md
│   ├── RolePermissionMatrix.md
│   ├── WorkflowDiagram.md
│   ├── BusinessRules.md
│   └── TestResults.md
└── README.md
```

## 3. Setup — Supabase

1. Create a free project at https://supabase.com.
2. Go to **SQL Editor → New query**, paste the entire contents of
   `database/schema.sql`, and run it. This creates all tables, RLS policies,
   RPC functions, an auth trigger that auto-creates a `profiles` row on
   signup, and 5 sample equipment rows.
3. Go to **Project Settings → API** and copy:
   - **Project URL**
   - **anon public key**
4. Paste them into `public/js/supabaseClient.js`:
   ```js
   const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
   const SUPABASE_ANON_KEY = "eyJhbGciOi...";
   ```
5. (Recommended) In **Authentication → Providers → Email**, you can turn off
   "Confirm email" for faster classroom testing.

### Creating your first Administrator

Every new signup becomes a `requester` by default (see role-permission matrix).
To get your first admin account:
1. Sign up normally through the app with the account you want to be admin.
2. In Supabase **SQL Editor**, run:
   ```sql
   update public.profiles set role = 'admin' where email = 'youremail@example.com';
   ```
3. Log out and back in (or refresh) — the sidebar now shows admin-only menus.
4. As admin, you can promote other users to `staff` or `admin` from the
   **User Management** screen.

## 4. Setup — GitHub + GitHub Pages

1. Create a new GitHub repository (e.g. `lab4-asset-management`) and push this
   whole folder to it.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source: Deploy from a branch**,
   **Branch: main**, **Folder: /public** (or move the contents of `public/`
   to the repo root and select `/root` — either works, just be consistent).
4. Save. GitHub gives you a live URL such as
   `https://<username>.github.io/lab4-asset-management/`.
5. Open it — you should see the login screen.

```bash
git init
git add .
git commit -m "Lab 4: role-based asset transaction and approval management"
git branch -M main
git remote add origin https://github.com/<username>/lab4-asset-management.git
git push -u origin main
```

## 5. How each objective is met

| Objective | Where |
|---|---|
| Multiple user roles and access restrictions | `profiles.role` + RLS policies + role-based sidebar in `main.js` |
| Borrowing-request approval workflow | `borrowing_transactions.status` + `approve_borrowing_request` / `reject_borrowing_request` RPCs |
| Business rules enforced across states | `database/schema.sql` §4 (trigger + RPC functions), see `docs/BusinessRules.md` |
| Audit trail for critical actions | `audit_logs` table, written by `log_audit()` inside every sensitive RPC |
| Authorization at UI **and** DB level | Sidebar hides routes per role (UI) **and** RLS + `is_admin()`/`is_staff()` checks inside RPCs (DB) |

## 6. Test accounts (create these after deploying)

| Role | How to get it |
|---|---|
| Requester | Sign up normally |
| Staff | Sign up, then have an admin change role to `staff` in User Management |
| Administrator | Sign up, then run the SQL promotion command in section 3 |

## 7. Submission checklist

1. GitHub repository URL
2. Live GitHub Pages URL
3. `docs/ERD.md` and `docs/UseCaseDiagram.md` (Mermaid diagrams — render on GitHub automatically)
4. `docs/RolePermissionMatrix.md`
5. `docs/WorkflowDiagram.md`
6. `docs/BusinessRules.md`
7. Audit-log screenshot — log in as admin, go to **Audit Logs**, screenshot the table
8. `docs/TestResults.md` — fill in the Actual Result / Pass column after you run TC-A4-01 to TC-A4-10
