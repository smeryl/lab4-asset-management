// =====================================================================
// Lab 4 System - main.js
// Single-page app: auth, role-based navigation, and all workflow screens.
// All state transitions call Supabase RPC functions defined in schema.sql,
// so business rules are enforced server-side even if this JS is bypassed.
// =====================================================================

const state = {
  session: null,
  profile: null,
  route: "dashboard",
  authMode: "login", // 'login' | 'signup'
};

const app = document.getElementById("app");

// ---------------------------------------------------------------------
// Bootstrapping
// ---------------------------------------------------------------------
async function init() {
  const { data } = await supabaseClient.auth.getSession();
  state.session = data.session;
  if (state.session) await loadProfile();
  render();

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    if (session) {
      await loadProfile();
    } else {
      state.profile = null;
    }
    render();
  });
}

async function loadProfile() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", state.session.user.id)
    .single();
  if (!error) state.profile = data;
}

function toast(msg, type = "") {
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ---------------------------------------------------------------------
// Render router
// ---------------------------------------------------------------------
function render() {
  app.innerHTML = "";
  if (!state.session) {
    renderAuth();
  } else if (!state.profile) {
    app.innerHTML = `<div class="denied"><h2>Loading profile...</h2></div>`;
  } else {
    renderShell();
  }
}

// ---------------------------------------------------------------------
// AUTH SCREENS
// ---------------------------------------------------------------------
function renderAuth() {
  const wrap = document.createElement("div");
  wrap.className = "auth-wrap";

  if (state.authMode === "login") {
    wrap.innerHTML = `
      <div class="auth-card">
        <h1>Lab Asset & Service Management</h1>
        <p class="sub">Sign in to continue</p>
        <label>Email</label>
        <input type="email" id="login-email" placeholder="you@example.com" />
        <label>Password</label>
        <input type="password" id="login-password" placeholder="••••••••" />
        <button id="login-btn">Sign In</button>
        <div id="auth-error"></div>
        <div class="switch-link">No account? <a id="go-signup">Create one</a></div>
      </div>`;
  } else {
    wrap.innerHTML = `
      <div class="auth-card">
        <h1>Create an Account</h1>
        <p class="sub">Register as a Requester / Viewer. Admin can promote staff/admin roles.</p>
        <label>Full Name</label>
        <input type="text" id="su-name" placeholder="Juan Dela Cruz" />
        <label>Email</label>
        <input type="email" id="su-email" placeholder="you@example.com" />
        <label>Password</label>
        <input type="password" id="su-password" placeholder="At least 6 characters" />
        <button id="signup-btn">Create Account</button>
        <div id="auth-error"></div>
        <div class="switch-link">Have an account? <a id="go-login">Sign in</a></div>
      </div>`;
  }

  app.appendChild(wrap);

  if (state.authMode === "login") {
    document.getElementById("go-signup").onclick = () => { state.authMode = "signup"; render(); };
    document.getElementById("login-btn").onclick = doLogin;
  } else {
    document.getElementById("go-login").onclick = () => { state.authMode = "login"; render(); };
    document.getElementById("signup-btn").onclick = doSignup;
  }
}

async function doLogin() {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) showAuthError(error.message);
}

async function doSignup() {
  const full_name = document.getElementById("su-name").value.trim();
  const email = document.getElementById("su-email").value.trim();
  const password = document.getElementById("su-password").value;
  const { error } = await supabaseClient.auth.signUp({
    email, password,
    options: { data: { full_name, role: "requester" } },
  });
  if (error) { showAuthError(error.message); return; }
  toast("Account created. You can now sign in.", "success");
  state.authMode = "login";
  render();
}

function showAuthError(msg) {
  const box = document.getElementById("auth-error");
  box.innerHTML = `<div class="error-box">${msg}</div>`;
}

async function doLogout() {
  await supabaseClient.auth.signOut();
  state.route = "dashboard";
}

// ---------------------------------------------------------------------
// APP SHELL (topbar + role-based sidebar + content)
// ---------------------------------------------------------------------
const NAV_BY_ROLE = {
  admin: [
    { key: "dashboard", label: "Dashboard" },
    { key: "equipment", label: "Equipment" },
    { key: "approvals", label: "Approvals" },
    { key: "release-return", label: "Release / Return" },
    { key: "maintenance", label: "Maintenance" },
    { key: "users", label: "User Management" },
    { key: "audit", label: "Audit Logs" },
  ],
  staff: [
    { key: "dashboard", label: "Dashboard" },
    { key: "equipment", label: "Equipment" },
    { key: "my-requests", label: "My Requests" },
    { key: "release-return", label: "Release / Return" },
    { key: "maintenance", label: "Maintenance" },
  ],
  requester: [
    { key: "dashboard", label: "Dashboard" },
    { key: "equipment", label: "Equipment" },
    { key: "my-requests", label: "My Requests" },
  ],
};

function renderShell() {
  const role = state.profile.role;
  const nav = NAV_BY_ROLE[role] || NAV_BY_ROLE.requester;

  const shell = document.createElement("div");
  shell.innerHTML = `
    <div class="topbar">
      <div class="brand">Lab Asset & Service Management<span>Role-Based Transaction & Approval</span></div>
      <div class="who">
        <span>${state.profile.full_name}</span>
        <span class="role-badge">${role}</span>
        <button class="logout" id="logout-btn">Log out</button>
      </div>
    </div>
    <div class="layout">
      <nav class="sidebar" id="sidebar"></nav>
      <main class="content" id="content"></main>
    </div>
  `;
  app.appendChild(shell);

  document.getElementById("logout-btn").onclick = doLogout;

  const sidebar = document.getElementById("sidebar");
  nav.forEach((item) => {
    const a = document.createElement("a");
    a.textContent = item.label;
    a.className = state.route === item.key ? "active" : "";
    a.onclick = () => { state.route = item.key; render(); };
    sidebar.appendChild(a);
  });

  // Guard: if current route isn't allowed for this role, bounce to dashboard
  const allowed = nav.some((n) => n.key === state.route);
  if (!allowed) state.route = "dashboard";

  const content = document.getElementById("content");
  renderRoute(content, role);
}

function renderRoute(content, role) {
  switch (state.route) {
    case "dashboard": return renderDashboard(content, role);
    case "equipment": return renderEquipment(content, role);
    case "my-requests": return renderMyRequests(content);
    case "approvals": return role === "admin" ? renderApprovals(content) : renderDenied(content);
    case "release-return": return (role === "admin" || role === "staff") ? renderReleaseReturn(content) : renderDenied(content);
    case "maintenance": return (role === "admin" || role === "staff") ? renderMaintenance(content) : renderDenied(content);
    case "users": return role === "admin" ? renderUsers(content) : renderDenied(content);
    case "audit": return role === "admin" ? renderAudit(content) : renderDenied(content);
    default: return renderDashboard(content, role);
  }
}

function renderDenied(content) {
  content.innerHTML = `<div class="denied"><h2>Access Denied</h2><p>You do not have permission to view this page.</p></div>`;
}

function badge(status) {
  return `<span class="badge badge-${status}">${status}</span>`;
}

// ---------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------
async function renderDashboard(content, role) {
  content.innerHTML = `<h2>Dashboard</h2><div class="grid-3" id="stats"></div><div class="card" id="recent"></div>`;

  const statsEl = document.getElementById("stats");
  const recentEl = document.getElementById("recent");

  const { count: availCount } = await supabaseClient
    .from("equipment").select("*", { count: "exact", head: true }).eq("status", "Available");

  let pendingQuery = supabaseClient.from("borrowing_transactions").select("*", { count: "exact", head: true }).eq("status", "Pending");
  if (role === "requester") pendingQuery = pendingQuery.eq("requester_id", state.session.user.id);
  const { count: pendingCount } = await pendingQuery;

  let activeQuery = supabaseClient.from("borrowing_transactions").select("*", { count: "exact", head: true }).in("status", ["Released", "Overdue"]);
  if (role === "requester") activeQuery = activeQuery.eq("requester_id", state.session.user.id);
  const { count: activeCount } = await activeQuery;

  statsEl.innerHTML = `
    <div class="stat"><div class="num">${availCount ?? 0}</div><div class="label">Available Equipment</div></div>
    <div class="stat"><div class="num">${pendingCount ?? 0}</div><div class="label">Pending Requests</div></div>
    <div class="stat"><div class="num">${activeCount ?? 0}</div><div class="label">Active Borrowings</div></div>
  `;

  let recentQuery = supabaseClient
    .from("borrowing_transactions")
    .select("id,status,request_date,equipment:equipment_id(name,code)")
    .order("request_date", { ascending: false })
    .limit(5);
  if (role === "requester") recentQuery = recentQuery.eq("requester_id", state.session.user.id);
  const { data: recent } = await recentQuery;

  recentEl.innerHTML = `<h3>Recent Requests</h3>` + (recent && recent.length
    ? `<table><thead><tr><th>ID</th><th>Equipment</th><th>Status</th><th>Date</th></tr></thead><tbody>
        ${recent.map(r => `<tr><td>#${r.id}</td><td>${r.equipment?.name ?? ""} (${r.equipment?.code ?? ""})</td><td>${badge(r.status)}</td><td>${new Date(r.request_date).toLocaleString()}</td></tr>`).join("")}
      </tbody></table>`
    : `<div class="empty">No requests yet.</div>`);
}

// ---------------------------------------------------------------------
// EQUIPMENT (view all roles; admin can add/edit)
// ---------------------------------------------------------------------
async function renderEquipment(content, role) {
  const { data: equipment, error } = await supabaseClient.from("equipment").select("*").order("id");
  const isAdmin = role === "admin";
  const isRequesterOrStaff = role === "requester" || role === "staff";

  content.innerHTML = `
    <div class="flex-between"><h2>Equipment</h2>${isAdmin ? `<button id="add-eq-btn">+ Add Equipment</button>` : ""}</div>
    <div class="card">
      ${error ? `<div class="empty">Error loading equipment.</div>` : `
      <table><thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${equipment.map(e => `
          <tr>
            <td>${e.code}</td><td>${e.name}</td><td>${e.category ?? "-"}</td><td>${badge(e.status)}</td>
            <td>
              ${isRequesterOrStaff && e.status === "Available" ? `<button class="small" data-request="${e.id}">Request</button>` : ""}
              ${isAdmin ? `<button class="small secondary" data-edit="${e.id}">Edit</button>` : ""}
            </td>
          </tr>`).join("")}
      </tbody></table>`}
    </div>
  `;

  if (isAdmin) {
    document.getElementById("add-eq-btn").onclick = () => openEquipmentModal();
    content.querySelectorAll("[data-edit]").forEach(btn => {
      btn.onclick = () => openEquipmentModal(equipment.find(e => e.id == btn.dataset.edit));
    });
  }
  content.querySelectorAll("[data-request]").forEach(btn => {
    btn.onclick = () => openRequestModal(parseInt(btn.dataset.request));
  });
}

function openEquipmentModal(existing) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <h3>${existing ? "Edit Equipment" : "Add Equipment"}</h3>
      <label class="muted">Code</label><input id="m-code" value="${existing?.code ?? ""}" />
      <label class="muted">Name</label><input id="m-name" value="${existing?.name ?? ""}" />
      <label class="muted">Category</label><input id="m-cat" value="${existing?.category ?? ""}" />
      <label class="muted">Status</label>
      <select id="m-status">
        ${["Available","Borrowed","Maintenance","Damaged"].map(s => `<option ${existing?.status===s?"selected":""}>${s}</option>`).join("")}
      </select>
      <div class="modal-actions">
        <button class="secondary" id="m-cancel">Cancel</button>
        <button id="m-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  document.getElementById("m-cancel").onclick = () => backdrop.remove();
  document.getElementById("m-save").onclick = async () => {
    const payload = {
      code: document.getElementById("m-code").value.trim(),
      name: document.getElementById("m-name").value.trim(),
      category: document.getElementById("m-cat").value.trim(),
      status: document.getElementById("m-status").value,
    };
    const q = existing
      ? supabaseClient.from("equipment").update(payload).eq("id", existing.id)
      : supabaseClient.from("equipment").insert(payload);
    const { error } = await q;
    if (error) { toast(error.message, "error"); return; }
    toast("Equipment saved", "success");
    backdrop.remove();
    render();
  };
}

function openRequestModal(equipmentId) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <h3>Submit Borrowing Request</h3>
      <label class="muted">Purpose</label>
      <textarea id="m-purpose" placeholder="e.g. For CS elective project demo"></textarea>
      <div class="modal-actions">
        <button class="secondary" id="m-cancel">Cancel</button>
        <button id="m-submit">Submit</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  document.getElementById("m-cancel").onclick = () => backdrop.remove();
  document.getElementById("m-submit").onclick = async () => {
    const purpose = document.getElementById("m-purpose").value.trim();
    const { error } = await supabaseClient.rpc("create_borrowing_request", {
      p_equipment_id: equipmentId, p_purpose: purpose,
    });
    if (error) { toast(error.message, "error"); return; }
    toast("Request submitted (Pending)", "success");
    backdrop.remove();
    render();
  };
}

// ---------------------------------------------------------------------
// MY REQUESTS (requester + staff)
// ---------------------------------------------------------------------
async function renderMyRequests(content) {
  const { data, error } = await supabaseClient
    .from("borrowing_transactions")
    .select("id,status,request_date,purpose,remarks,damaged,equipment:equipment_id(name,code)")
    .eq("requester_id", state.session.user.id)
    .order("request_date", { ascending: false });

  content.innerHTML = `<h2>My Requests</h2><div class="card">
    ${error ? `<div class="empty">Error loading requests.</div>` :
      (!data.length ? `<div class="empty">You have no requests yet. Go to Equipment to submit one.</div>` :
      `<table><thead><tr><th>ID</th><th>Equipment</th><th>Status</th><th>Requested</th><th>Remarks</th></tr></thead>
      <tbody>${data.map(r => `
        <tr><td>#${r.id}</td><td>${r.equipment?.name} (${r.equipment?.code})</td><td>${badge(r.status)}</td>
        <td>${new Date(r.request_date).toLocaleString()}</td><td>${r.remarks ?? "-"}</td></tr>`).join("")}
      </tbody></table>`)}
  </div>`;
}

// ---------------------------------------------------------------------
// APPROVALS (admin only) — BR-A4-02, BR-A4-03
// ---------------------------------------------------------------------
async function renderApprovals(content) {
  const { data, error } = await supabaseClient
    .from("borrowing_transactions")
    .select("id,status,request_date,purpose,requester:requester_id(full_name,email),equipment:equipment_id(name,code)")
    .eq("status", "Pending")
    .order("request_date");

  content.innerHTML = `<h2>Pending Approvals</h2><div class="card">
    ${error ? `<div class="empty">Error loading requests.</div>` :
      (!data.length ? `<div class="empty">No pending requests.</div>` :
      `<table><thead><tr><th>ID</th><th>Requester</th><th>Equipment</th><th>Purpose</th><th>Date</th><th></th></tr></thead>
      <tbody>${data.map(r => `
        <tr>
          <td>#${r.id}</td><td>${r.requester?.full_name}</td><td>${r.equipment?.name} (${r.equipment?.code})</td>
          <td>${r.purpose ?? "-"}</td><td>${new Date(r.request_date).toLocaleDateString()}</td>
          <td>
            <button class="small" data-approve="${r.id}">Approve</button>
            <button class="small danger" data-reject="${r.id}">Reject</button>
          </td>
        </tr>`).join("")}
      </tbody></table>`)}
  </div>`;

  content.querySelectorAll("[data-approve]").forEach(btn => {
    btn.onclick = async () => {
      const { error } = await supabaseClient.rpc("approve_borrowing_request", { p_transaction_id: parseInt(btn.dataset.approve) });
      if (error) { toast(error.message, "error"); return; }
      toast("Request approved", "success");
      render();
    };
  });
  content.querySelectorAll("[data-reject]").forEach(btn => {
    btn.onclick = async () => {
      const reason = prompt("Reason for rejection (optional):") || null;
      const { error } = await supabaseClient.rpc("reject_borrowing_request", { p_transaction_id: parseInt(btn.dataset.reject), p_remarks: reason });
      if (error) { toast(error.message, "error"); return; }
      toast("Request rejected", "success");
      render();
    };
  });
}

// ---------------------------------------------------------------------
// RELEASE / RETURN (staff + admin) — BR-A4-04..08
// ---------------------------------------------------------------------
async function renderReleaseReturn(content) {
  const { data: approved } = await supabaseClient
    .from("borrowing_transactions")
    .select("id,equipment:equipment_id(name,code),requester:requester_id(full_name)")
    .eq("status", "Approved");

  const { data: released } = await supabaseClient
    .from("borrowing_transactions")
    .select("id,equipment:equipment_id(name,code),requester:requester_id(full_name),released_at")
    .in("status", ["Released", "Overdue"]);

  content.innerHTML = `
    <h2>Release / Return</h2>
    <div class="card">
      <h3>Approved — Ready for Release</h3>
      ${!approved || !approved.length ? `<div class="empty">Nothing to release.</div>` :
        `<table><thead><tr><th>ID</th><th>Equipment</th><th>Requester</th><th></th></tr></thead>
        <tbody>${approved.map(r => `
          <tr><td>#${r.id}</td><td>${r.equipment?.name} (${r.equipment?.code})</td><td>${r.requester?.full_name}</td>
          <td><button class="small" data-release="${r.id}">Release</button></td></tr>`).join("")}
        </tbody></table>`}
    </div>
    <div class="card">
      <h3>Released — Awaiting Return</h3>
      ${!released || !released.length ? `<div class="empty">Nothing currently out.</div>` :
        `<table><thead><tr><th>ID</th><th>Equipment</th><th>Requester</th><th>Released</th><th></th></tr></thead>
        <tbody>${released.map(r => `
          <tr><td>#${r.id}</td><td>${r.equipment?.name} (${r.equipment?.code})</td><td>${r.requester?.full_name}</td>
          <td>${new Date(r.released_at).toLocaleDateString()}</td>
          <td><button class="small" data-return="${r.id}">Process Return</button></td></tr>`).join("")}
        </tbody></table>`}
    </div>
  `;

  content.querySelectorAll("[data-release]").forEach(btn => {
    btn.onclick = async () => {
      const { error } = await supabaseClient.rpc("release_equipment", { p_transaction_id: parseInt(btn.dataset.release) });
      if (error) { toast(error.message, "error"); return; }
      toast("Equipment released", "success");
      render();
    };
  });
  content.querySelectorAll("[data-return]").forEach(btn => {
    btn.onclick = () => openReturnModal(parseInt(btn.dataset.return));
  });
}

function openReturnModal(transactionId) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <h3>Process Return</h3>
      <label class="muted"><input type="checkbox" id="m-damaged" /> Equipment returned damaged</label>
      <label class="muted" style="margin-top:10px;">Remarks</label>
      <textarea id="m-remarks" placeholder="Condition notes..."></textarea>
      <div class="modal-actions">
        <button class="secondary" id="m-cancel">Cancel</button>
        <button id="m-confirm">Confirm Return</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  document.getElementById("m-cancel").onclick = () => backdrop.remove();
  document.getElementById("m-confirm").onclick = async () => {
    const damaged = document.getElementById("m-damaged").checked;
    const remarks = document.getElementById("m-remarks").value.trim();
    const { error } = await supabaseClient.rpc("process_return", {
      p_transaction_id: transactionId, p_damaged: damaged, p_remarks: remarks || null,
    });
    if (error) { toast(error.message, "error"); return; }
    toast("Return processed", "success");
    backdrop.remove();
    render();
  };
}

// ---------------------------------------------------------------------
// MAINTENANCE (staff submits, admin/staff completes)
// ---------------------------------------------------------------------
async function renderMaintenance(content) {
  const { data: equipment } = await supabaseClient.from("equipment").select("id,name,code,status").order("name");
  const { data: requests } = await supabaseClient
    .from("maintenance_requests")
    .select("id,status,issue_description,created_at,equipment:equipment_id(name,code)")
    .order("created_at", { ascending: false });

  content.innerHTML = `
    <div class="flex-between"><h2>Maintenance</h2><button id="add-maint-btn">+ Submit Maintenance Request</button></div>
    <div class="card">
      ${!requests || !requests.length ? `<div class="empty">No maintenance requests yet.</div>` :
        `<table><thead><tr><th>ID</th><th>Equipment</th><th>Issue</th><th>Status</th><th>Date</th><th></th></tr></thead>
        <tbody>${requests.map(r => `
          <tr><td>#${r.id}</td><td>${r.equipment?.name} (${r.equipment?.code})</td><td>${r.issue_description}</td>
          <td>${badge(r.status.replace(" ",""))}</td><td>${new Date(r.created_at).toLocaleDateString()}</td>
          <td>${r.status !== "Completed" ? `<button class="small" data-complete="${r.id}">Mark Completed</button>` : ""}</td></tr>`).join("")}
        </tbody></table>`}
    </div>
  `;

  document.getElementById("add-maint-btn").onclick = () => openMaintenanceModal(equipment ?? []);
  content.querySelectorAll("[data-complete]").forEach(btn => {
    btn.onclick = async () => {
      const { error } = await supabaseClient.rpc("complete_maintenance", { p_request_id: parseInt(btn.dataset.complete) });
      if (error) { toast(error.message, "error"); return; }
      toast("Maintenance completed; equipment set to Available", "success");
      render();
    };
  });
}

function openMaintenanceModal(equipment) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <h3>Submit Maintenance Request</h3>
      <label class="muted">Equipment</label>
      <select id="m-equipment">
        ${equipment.map(e => `<option value="${e.id}">${e.name} (${e.code}) - ${e.status}</option>`).join("")}
      </select>
      <label class="muted" style="margin-top:10px;">Issue Description</label>
      <textarea id="m-issue" placeholder="Describe the issue..."></textarea>
      <div class="modal-actions">
        <button class="secondary" id="m-cancel">Cancel</button>
        <button id="m-submit">Submit</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  document.getElementById("m-cancel").onclick = () => backdrop.remove();
  document.getElementById("m-submit").onclick = async () => {
    const equipment_id = parseInt(document.getElementById("m-equipment").value);
    const issue = document.getElementById("m-issue").value.trim();
    if (!issue) { toast("Please describe the issue", "error"); return; }
    const { error } = await supabaseClient.rpc("submit_maintenance_request", { p_equipment_id: equipment_id, p_issue: issue });
    if (error) { toast(error.message, "error"); return; }
    toast("Maintenance request submitted; equipment set to Maintenance", "success");
    backdrop.remove();
    render();
  };
}

// ---------------------------------------------------------------------
// USER MANAGEMENT (admin only)
// ---------------------------------------------------------------------
async function renderUsers(content) {
  const { data: users, error } = await supabaseClient.from("profiles").select("*").order("full_name");

  content.innerHTML = `<h2>User Management</h2><div class="card">
    ${error ? `<div class="empty">Error loading users.</div>` :
      `<table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
      <tbody>${users.map(u => `
        <tr><td>${u.full_name}</td><td>${u.email}</td><td><span class="role-badge" style="background:#33415c;">${u.role}</span></td>
        <td>
          <select data-role-select="${u.id}">
            ${["requester","staff","admin"].map(r => `<option value="${r}" ${u.role===r?"selected":""}>${r}</option>`).join("")}
          </select>
        </td></tr>`).join("")}
      </tbody></table>`}
  </div>`;

  content.querySelectorAll("[data-role-select]").forEach(sel => {
    sel.onchange = async () => {
      const { error } = await supabaseClient.from("profiles").update({ role: sel.value }).eq("id", sel.dataset.roleSelect);
      if (error) { toast(error.message, "error"); return; }
      await supabaseClient.rpc("log_audit", {
        p_action: "ROLE_CHANGED", p_module: "Users", p_record_id: sel.dataset.roleSelect, p_description: `Role changed to ${sel.value}`,
      }).catch(() => {}); // best-effort; log_audit is also called by RPCs for transactional actions
      toast("Role updated", "success");
    };
  });
}

// ---------------------------------------------------------------------
// AUDIT LOGS (admin only) — BR-A4-10
// ---------------------------------------------------------------------
async function renderAudit(content) {
  const { data, error } = await supabaseClient
    .from("audit_logs")
    .select("id,action,module,record_id,description,created_at,user:user_id(full_name)")
    .order("created_at", { ascending: false })
    .limit(200);

  content.innerHTML = `<h2>Audit Logs</h2><div class="card">
    ${error ? `<div class="empty">Error loading audit logs.</div>` :
      (!data.length ? `<div class="empty">No audit entries yet.</div>` :
      `<table><thead><tr><th>Date</th><th>User</th><th>Action</th><th>Module</th><th>Record</th><th>Description</th></tr></thead>
      <tbody>${data.map(l => `
        <tr><td>${new Date(l.created_at).toLocaleString()}</td><td>${l.user?.full_name ?? "System"}</td>
        <td><strong>${l.action}</strong></td><td>${l.module}</td><td>${l.record_id ?? "-"}</td><td>${l.description ?? "-"}</td></tr>`).join("")}
      </tbody></table>`)}
  </div>`;
}

// ---------------------------------------------------------------------
init();
