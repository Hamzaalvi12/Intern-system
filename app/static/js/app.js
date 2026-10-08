/**
 * Full Stack Zone (FSZ) - Enterprise Client Engine
 * Handles State, JWT Authentication, Role-based Routing, and Realtime Modals
 */

const API_BASE = '';
let currentUser = null;
let currentToken = localStorage.getItem('internhub_token') || null;
let adminMessagesCache = [];
let internMessagesCache = [];
let internTasksCache = [];
let adminInternsCache = [];
let adminAttendanceCache = [];
let loginLockoutInterval = null;
let adminLoginLockoutInterval = null;

// ==================== CORE UTILITIES ====================

async function api(endpoint, method = 'GET', data = null) {
  const headers = {};
  if (currentToken) {
    headers['Authorization'] = `Bearer ${currentToken}`;
  }

  const options = { method, headers };
  if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    if (data instanceof FormData) {
      options.body = data;
    } else {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(data);
    }
  }

  try {
    const res = await fetch(endpoint, options);
    const json = await res.json();
    return { ok: res.ok, status: res.status, data: json };
  } catch (err) {
    console.error('API Network Error:', err);
    return { ok: false, status: 0, data: { error: 'Network error or server unreachable.' } };
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icon = type === 'success' ? '✅' : type === 'error' ? '⚠️' : 'ℹ️';
  toast.innerHTML = `<span style="font-size:1.1rem;">${icon}</span> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('active');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

// ==================== AUTHENTICATION ====================

function switchAuthTab(tab) {
  const tabLogin = document.getElementById('tab-btn-login');
  const tabRegister = document.getElementById('tab-btn-register');
  const panelLogin = document.getElementById('auth-login-panel');
  const panelRegister = document.getElementById('auth-register-panel');

  if (tab === 'login') {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    panelLogin.style.display = 'block';
    panelRegister.style.display = 'none';
  } else {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    panelLogin.style.display = 'none';
    panelRegister.style.display = 'block';
  }
}

function quickFillCredentials(role) {
  const emailInput = document.getElementById('login-email');
  const passInput = document.getElementById('login-password');
  if (!emailInput || !passInput) return;

  switchAuthTab('login');
  if (role === 'intern') {
    emailInput.value = 'alex.intern@example.com';
    passInput.value = 'Password123!';
  } else if (role === 'alumni') {
    emailInput.value = 'david.pending@example.com';
    passInput.value = 'Password123!';
  }

  [emailInput, passInput].forEach(inp => {
    inp.style.transition = 'box-shadow 0.25s ease';
    inp.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.4)';
    setTimeout(() => { inp.style.boxShadow = ''; }, 700);
  });
  showToast(`Auto-filled ${role === 'alumni' ? 'alumni intern' : 'active intern'} credentials.`, 'info');
}

function quickFillAdminCredentials(role) {
  const emailInput = document.getElementById('admin-login-email');
  const passInput = document.getElementById('admin-login-password');
  if (!emailInput || !passInput) return;

  if (role === 'superadmin') {
    emailInput.value = 'superadmin@internhub.com';
    passInput.value = 'Password123!';
  } else if (role === 'admin') {
    emailInput.value = 'admin@internhub.com';
    passInput.value = 'Password123!';
  }

  [emailInput, passInput].forEach(inp => {
    inp.style.transition = 'box-shadow 0.25s ease';
    inp.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.4)';
    setTimeout(() => { inp.style.boxShadow = ''; }, 700);
  });
  showToast(`Auto-filled ${role.replace('_', ' ')} credentials.`, 'info');
}

async function quickLogin(email) {
  document.getElementById('login-email').value = email;
  document.getElementById('login-password').value = 'Password123!';
  switchAuthTab('login');
  await handleLogin(new Event('submit'));
}

function startLoginLockoutTimer(totalSeconds, isModal = false) {
  const intervalKey = isModal ? 'adminLoginLockoutInterval' : 'loginLockoutInterval';
  if (window[intervalKey]) clearInterval(window[intervalKey]);

  const bannerId = isModal ? 'admin-login-lockout-banner' : 'login-lockout-banner';
  const warningId = isModal ? 'admin-login-attempt-warning' : 'login-attempt-warning';
  const btnId = isModal ? 'btn-submit-admin-login' : 'btn-submit-login';

  const banner = document.getElementById(bannerId);
  const warning = document.getElementById(warningId);
  const btn = document.getElementById(btnId);

  if (warning) warning.style.display = 'none';
  if (btn) btn.disabled = true;
  if (!banner) return;

  banner.style.display = 'block';

  const lockMins = isModal ? 10 : 30;
  const attemptCount = isModal ? 5 : 3;
  let remaining = totalSeconds || (isModal ? 600 : 1800);

  function updateDisplay() {
    if (remaining <= 0) {
      clearInterval(window[intervalKey]);
      window[intervalKey] = null;
      banner.style.display = 'none';
      if (btn) {
        btn.disabled = false;
        btn.textContent = isModal ? '🔐 Sign In to Admin Workspace' : 'Sign In to Intern Portal →';
      }
      showToast(`${lockMins}-minute lockout expired. You may attempt to sign in now.`, 'info');
      return;
    }
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const timeFormatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    banner.innerHTML = `
      <div style="display:flex; align-items:center; gap:0.5rem; font-weight:700; color:#b91c1c; margin-bottom:0.25rem;">
        <span>⏳</span> Account Locked (${attemptCount} Failed Attempts)
      </div>
      <div style="font-size:0.83rem; color:#991b1b; line-height:1.4;">
        Too many consecutive failed login attempts. Security lock active. Please wait <strong>${timeFormatted}</strong> before trying again.
      </div>
    `;
    if (btn) btn.textContent = `⏳ Locked (${timeFormatted})`;
    remaining--;
  }

  updateDisplay();
  window[intervalKey] = setInterval(updateDisplay, 1000);
}

function showLoginAttemptsWarning(attemptsLeft, isModal = false) {
  const warningId = isModal ? 'admin-login-attempt-warning' : 'login-attempt-warning';
  const warning = document.getElementById(warningId);
  if (!warning) return;
  warning.style.display = 'block';
  const lockMins = isModal ? 10 : 30;
  warning.innerHTML = `⚠️ <strong>Invalid Password:</strong> You have <strong>${attemptsLeft}</strong> attempt${attemptsLeft > 1 ? 's' : ''} remaining before your account is locked for ${lockMins} minutes.`;
}

async function handleLogin(e) {
  if (e && e.preventDefault) e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!email || !password) {
    showToast('Please enter both email and password.', 'error');
    return;
  }

  const btn = document.getElementById('btn-submit-login');
  btn.disabled = true;
  btn.textContent = 'Authenticating...';

  // Strict portal boundary: intern accounts ONLY can log in here
  const res = await api('/api/auth/login', 'POST', { email, password, portal: 'intern' });
  btn.disabled = false;
  btn.textContent = 'Sign In to Intern Portal →';

  if (!res.ok) {
    // 1. Account Locked due to 3 failed attempts
    if (res.data && res.data.account_locked) {
      startLoginLockoutTimer(res.data.remaining_seconds, false);
      showToast(res.data.error, 'error');
      return;
    }

    // 2. Attempts remaining warning
    if (res.data && res.data.attempts_left !== undefined) {
      showLoginAttemptsWarning(res.data.attempts_left, false);
    }

    // Check if administrator tried to log in on intern portal
    if (res.status === 403 && res.data.portal_error) {
      showToast(res.data.error, 'error');
      setTimeout(() => {
        if (confirm('🔒 Access Notice:\n' + res.data.error + '\n\nWould you like to open the Admin Portal login?')) {
          openAdminLoginModal();
          const adminEmail = document.getElementById('admin-login-email');
          const adminPass = document.getElementById('admin-login-password');
          if (adminEmail) adminEmail.value = email;
          if (adminPass) adminPass.value = password;
        }
      }, 350);
      return;
    }

    // Check if pending intern approval
    if (res.status === 403 && res.data.account_status === 'pending') {
      showToast('Account Pending: Your registration is currently awaiting administrator review.', 'error');
      alert('🔒 Access Blocked: Your intern account request is currently PENDING approval by an administrator. You will be able to log in once an admin reviews and approves your application.');
    } else {
      showToast(res.data.error || 'Authentication failed.', 'error');
    }
    return;
  }

  // Clear any lockout warnings
  const lockoutEl = document.getElementById('login-lockout-banner');
  const warningEl = document.getElementById('login-attempt-warning');
  if (lockoutEl) lockoutEl.style.display = 'none';
  if (warningEl) warningEl.style.display = 'none';

  currentToken = res.data.access_token;
  localStorage.setItem('internhub_token', currentToken);
  currentUser = res.data.user;

  showToast(`Welcome back, ${currentUser.full_name}!`, 'success');
  renderDashboard();
}

async function handleRegister(e) {
  e.preventDefault();
  const selectedDays = Array.from(document.querySelectorAll('input[name="reg-working-day"]:checked')).map(cb => cb.value);
  const payload = {
    full_name: document.getElementById('reg-fullname').value.trim(),
    email: document.getElementById('reg-email').value.trim(),
    password: document.getElementById('reg-password').value,
    phone: document.getElementById('reg-phone').value.trim(),
    department: document.getElementById('reg-department').value.trim(),
    university: document.getElementById('reg-university').value.trim(),
    start_date: document.getElementById('reg-start-date').value || null,
    end_date: document.getElementById('reg-end-date').value || null,
    bio: document.getElementById('reg-bio').value.trim(),
    working_days: selectedDays.length > 0 ? selectedDays : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  };

  const btn = document.getElementById('btn-submit-register');
  btn.disabled = true;
  btn.textContent = 'Submitting Application...';

  const res = await api('/api/auth/register', 'POST', payload);
  btn.disabled = false;
  btn.textContent = 'Submit Registration Request';

  if (!res.ok) {
    showToast(res.data.error || 'Registration failed.', 'error');
    return;
  }

  showToast('Application submitted! Your account is pending administrator approval.', 'success');
  alert('🎉 Application Received!\n\nYour intern account has been submitted with status: PENDING.\nAn administrator must approve your application before you can sign in.');
  
  document.getElementById('form-register').reset();
  switchAuthTab('login');
  document.getElementById('login-email').value = payload.email;
}

function logout() {
  currentToken = null;
  currentUser = null;
  localStorage.removeItem('internhub_token');
  showToast('You have signed out successfully.', 'info');
  renderGuestView();
}

async function checkSession() {
  const dismissLoader = () => {
    document.documentElement.classList.remove('has-session');
    const loader = document.getElementById('session-loader');
    if (loader) loader.style.display = 'none';
  };

  if (!currentToken) {
    dismissLoader();
    renderGuestView();
    return;
  }

  try {
    const res = await api('/api/auth/me');
    if (res.ok && res.data && res.data.user) {
      currentUser = res.data.user;
      renderDashboard();
    } else {
      logout();
    }
  } catch (err) {
    logout();
  } finally {
    dismissLoader();
  }
}

function openAdminLoginModal() {
  document.getElementById('form-admin-login').reset();
  if (!window.adminLoginLockoutInterval) {
    const warning = document.getElementById('admin-login-attempt-warning');
    const banner = document.getElementById('admin-login-lockout-banner');
    if (warning) warning.style.display = 'none';
    if (banner) banner.style.display = 'none';
    const btn = document.getElementById('btn-submit-admin-login');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔐 Sign In to Admin Workspace';
    }
  }
  openModal('modal-admin-login');
}

async function handleAdminLogin(e) {
  if (e && e.preventDefault) e.preventDefault();
  const email = document.getElementById('admin-login-email').value.trim();
  const password = document.getElementById('admin-login-password').value;

  if (!email || !password) {
    showToast('Please enter both administrator email and password.', 'error');
    return;
  }

  const btn = document.getElementById('btn-submit-admin-login');
  btn.disabled = true;
  btn.textContent = 'Authenticating...';

  // Strict portal boundary: administrative accounts ONLY
  const res = await api('/api/auth/login', 'POST', { email, password, portal: 'admin' });
  btn.disabled = false;
  btn.textContent = '🔐 Sign In to Admin Workspace';

  if (!res.ok) {
    // 1. Account Locked due to 3 failed attempts
    if (res.data && res.data.account_locked) {
      startLoginLockoutTimer(res.data.remaining_seconds, true);
      showToast(res.data.error, 'error');
      return;
    }

    // 2. Attempts remaining warning
    if (res.data && res.data.attempts_left !== undefined) {
      showLoginAttemptsWarning(res.data.attempts_left, true);
    }

    // Check if intern tried to log in on admin portal
    if (res.status === 403 && res.data.portal_error) {
      showToast(res.data.error, 'error');
      alert('🔒 Access Denied:\n\n' + res.data.error);
      closeModal('modal-admin-login');
      const internEmail = document.getElementById('login-email');
      const internPass = document.getElementById('login-password');
      if (internEmail) internEmail.value = email;
      if (internPass) internPass.value = password;
      return;
    }

    showToast(res.data.error || 'Authentication failed.', 'error');
    return;
  }

  // Clear any admin lockout warnings
  const adminLockoutEl = document.getElementById('admin-login-lockout-banner');
  const adminWarningEl = document.getElementById('admin-login-attempt-warning');
  if (adminLockoutEl) adminLockoutEl.style.display = 'none';
  if (adminWarningEl) adminWarningEl.style.display = 'none';

  currentToken = res.data.access_token;
  localStorage.setItem('internhub_token', currentToken);
  currentUser = res.data.user;

  closeModal('modal-admin-login');
  showToast(`Welcome, ${currentUser.full_name}! (${currentUser.role.replace('_', ' ')})`, 'success');
  renderDashboard();
}

function openEditProfileModal() {
  if (!currentUser) return;
  document.getElementById('profile-full-name').value = currentUser.full_name || '';
  document.getElementById('profile-email').value = currentUser.email || '';
  document.getElementById('profile-phone').value = currentUser.phone || '';
  
  const deptGroup = document.getElementById('group-profile-department');
  const deptInput = document.getElementById('profile-department');
  if (deptGroup && deptInput) {
    if (['admin', 'super_admin'].includes(currentUser.role)) {
      deptGroup.style.display = 'block';
      deptInput.value = currentUser.department || '';
    } else {
      deptGroup.style.display = 'none';
    }
  }

  const roleBadge = document.getElementById('profile-role-badge');
  if (roleBadge) {
    if (currentUser.role === 'super_admin') {
      roleBadge.className = 'badge badge-super_admin';
      roleBadge.textContent = '👑 Super Administrator';
    } else if (currentUser.role === 'admin') {
      roleBadge.className = 'badge badge-admin';
      roleBadge.textContent = '🛡️ Administrator';
    } else {
      roleBadge.className = 'badge badge-intern';
      roleBadge.textContent = '🎓 Intern';
    }
  }

  openModal('modal-edit-profile');
}

async function handleSaveProfile(e) {
  e.preventDefault();
  const full_name = document.getElementById('profile-full-name').value.trim();
  const email = document.getElementById('profile-email').value.trim().toLowerCase();
  const phone = document.getElementById('profile-phone').value.trim();
  const deptInput = document.getElementById('profile-department');
  const department = deptInput ? deptInput.value.trim() : '';

  if (!full_name) {
    showToast('Full name is required.', 'error');
    return;
  }
  if (!email) {
    showToast('A valid email address is required.', 'error');
    return;
  }

  const btn = document.getElementById('btn-submit-edit-profile');
  btn.disabled = true;
  btn.textContent = 'Saving Changes...';

  const res = await api('/api/auth/profile', 'PUT', {
    full_name,
    email,
    phone,
    department
  });

  btn.disabled = false;
  btn.textContent = '💾 Save Profile Changes';

  if (res.ok) {
    currentUser = res.data.user;
    localStorage.setItem('internhub_user', JSON.stringify(currentUser));
    localStorage.setItem('internhub_user_name', currentUser.full_name);
    localStorage.setItem('internhub_user_role', currentUser.role);
    if (res.data.access_token) {
      currentToken = res.data.access_token;
      localStorage.setItem('internhub_token', currentToken);
    }

    // Refresh navbar displays
    const navName = document.getElementById('nav-user-name');
    if (navName) navName.textContent = currentUser.full_name;
    const navAvatar = document.getElementById('nav-avatar');
    if (navAvatar) navAvatar.textContent = getInitials(currentUser.full_name);

    showToast(res.data.message || 'Profile updated successfully!', 'success');
    closeModal('modal-edit-profile');

    // If on admin view, refresh admin overview or sub-admins if open
    if (currentUser.role === 'super_admin') {
      loadSuperAdminAdmins();
    }
  } else {
    showToast(res.data.error || 'Failed to update profile.', 'error');
  }
}

function openChangePasswordModal() {
  document.getElementById('form-change-password').reset();
  openModal('modal-change-password');
}

async function handleChangePassword(e) {
  e.preventDefault();
  const current_password = document.getElementById('cp-current-password').value;
  const new_password = document.getElementById('cp-new-password').value;
  const confirm_password = document.getElementById('cp-confirm-password').value;

  if (new_password.length < 6) {
    showToast('New password must be at least 6 characters long.', 'error');
    return;
  }

  if (new_password !== confirm_password) {
    showToast('New passwords do not match. Please re-enter.', 'error');
    return;
  }

  const btn = document.getElementById('btn-submit-change-password');
  btn.disabled = true;
  btn.textContent = 'Updating...';

  const res = await api('/api/auth/change-password', 'POST', {
    current_password,
    new_password
  });

  btn.disabled = false;
  btn.textContent = 'Save New Password';

  if (res.ok) {
    showToast('Your password has been updated successfully!', 'success');
    closeModal('modal-change-password');
  } else {
    showToast(res.data.error || 'Failed to update password.', 'error');
  }
}

function renderGuestView() {
  document.documentElement.classList.remove('has-session');
  const loader = document.getElementById('session-loader');
  if (loader) loader.style.display = 'none';

  document.getElementById('view-auth').style.display = 'flex';
  document.getElementById('view-admin-dashboard').style.display = 'none';
  document.getElementById('view-intern-dashboard').style.display = 'none';
  document.getElementById('nav-user-container').style.display = 'none';

  const topAdminBtn = document.getElementById('btn-top-admin-login');
  if (topAdminBtn) topAdminBtn.style.display = 'inline-flex';
}

function renderDashboard() {
  document.documentElement.classList.remove('has-session');
  const loader = document.getElementById('session-loader');
  if (loader) loader.style.display = 'none';

  document.getElementById('view-auth').style.display = 'none';
  document.getElementById('nav-user-container').style.display = 'flex';
  document.getElementById('nav-user-name').textContent = currentUser.full_name;
  
  const topAdminBtn = document.getElementById('btn-top-admin-login');
  if (topAdminBtn) topAdminBtn.style.display = 'none';

  const roleTag = document.getElementById('nav-user-role');
  roleTag.textContent = currentUser.role.replace('_', ' ');
  roleTag.className = `user-role-tag badge badge-${currentUser.role}`;

  document.getElementById('nav-avatar').textContent = (currentUser.full_name || 'U').charAt(0).toUpperCase();

  const lettersNavBtn = document.getElementById('btn-nav-letters-page');
  if (currentUser.role === 'admin' || currentUser.role === 'super_admin') {
    if (lettersNavBtn) lettersNavBtn.style.display = 'inline-flex';
    document.getElementById('view-admin-dashboard').style.display = 'block';
    document.getElementById('view-intern-dashboard').style.display = 'none';
    initAdminDashboard();
  } else if (currentUser.role === 'intern') {
    if (lettersNavBtn) lettersNavBtn.style.display = 'none';
    document.getElementById('view-admin-dashboard').style.display = 'none';
    document.getElementById('view-intern-dashboard').style.display = 'block';
    initInternDashboard();
  }
}

// ==================== ADMIN DASHBOARD ====================

function initAdminDashboard() {
  const isSuper = currentUser.role === 'super_admin';
  document.getElementById('admin-welcome-title').textContent = isSuper
    ? 'Super Admin Executive Portal'
    : 'Administrator Operations Portal';

  // Enable Admin account creation for all administrators (pending peer approval)
  document.getElementById('btn-open-create-admin').style.display = 'inline-flex';
  document.getElementById('tab-admin-admins').style.display = isSuper ? 'inline-flex' : 'none';

  loadAdminOverview();
  switchAdminTab('interns');
}

function switchAdminTab(tab, triggerLoad = true) {
  const tabs = ['interns', 'tasks', 'letters', 'attendance', 'messages', 'admins', 'schedules', 'passwords'];
  tabs.forEach(t => {
    const btn = document.getElementById(`tab-admin-${t}`);
    const panel = document.getElementById(`admin-panel-${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
  });

  if (!triggerLoad) return;

  if (tab === 'interns') loadInterns();
  else if (tab === 'tasks') loadAdminTasks();
  else if (tab === 'letters') loadAdminLetters();
  else if (tab === 'attendance') loadAdminAttendance();
  else if (tab === 'messages') loadAdminMessages();
  else if (tab === 'admins') loadSuperAdminAdmins();
  else if (tab === 'schedules') loadAdminSchedules();
  else if (tab === 'passwords') loadAdminPasswordManager();
}

function openAdminTabSection(tab) {
  switchAdminTab(tab, true);
  const panel = document.getElementById(`admin-panel-${tab}`);
  if (panel) {
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function loadAdminOverview() {
  const [internsRes, tasksRes, lettersRes, messagesRes] = await Promise.all([
    api('/api/interns?status=all'),
    api('/api/tasks'),
    api('/api/letters'),
    api('/api/messages')
  ]);

  if (internsRes.ok) {
    const counts = internsRes.data.counts || {};
    const totalElem = document.getElementById('metric-total-interns');
    if (totalElem) totalElem.textContent = counts.total || 0;

    const activeElem = document.getElementById('metric-active-interns');
    if (activeElem) activeElem.textContent = counts.active || 0;

    const completedElem = document.getElementById('metric-completed-interns');
    if (completedElem) completedElem.textContent = counts.completed || 0;

    const pendingElem = document.getElementById('metric-pending-approvals');
    if (pendingElem) pendingElem.textContent = counts.pending || 0;

    // Update segmented chip counts
    const chipAll = document.getElementById('count-chip-all');
    if (chipAll) chipAll.textContent = counts.total || 0;

    const chipActive = document.getElementById('count-chip-active');
    if (chipActive) chipActive.textContent = counts.active || 0;

    const chipCompleted = document.getElementById('count-chip-completed');
    if (chipCompleted) chipCompleted.textContent = counts.completed || 0;

    const chipPending = document.getElementById('count-chip-pending');
    if (chipPending) chipPending.textContent = counts.pending || 0;

    const chipRejected = document.getElementById('count-chip-rejected');
    if (chipRejected) chipRejected.textContent = counts.rejected || 0;
  }

  if (tasksRes.ok) {
    const activeTasks = (tasksRes.data.tasks || []).filter(t => t.assigned_to_id && t.status !== 'completed');
    document.getElementById('metric-active-tasks').textContent = activeTasks.length;
  }

  if (lettersRes.ok) {
    document.getElementById('metric-letters-issued').textContent = lettersRes.data.total;
  }

  // Super Admin: Update Sub-Admin badge count (sub-admins only)
  if (currentUser && currentUser.role === 'super_admin') {
    const adminsRes = await api('/api/auth/admins');
    if (adminsRes.ok) {
      const badge = document.getElementById('badge-admin-count');
      if (badge) {
        const subAdmins = (adminsRes.data.admins || []).filter(a => a.role === 'admin');
        const count = subAdmins.length;
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
      }
    }
  }

  if (messagesRes.ok) {
    const msgs = messagesRes.data.messages || [];
    // Count unseen / unresponded inquiries where no administrator has replied yet
    const unanswered = msgs.filter(m => {
      const hasAdminReply = (m.replies || []).some(r => r.sender_role === 'admin' || r.sender_role === 'super_admin');
      return !hasAdminReply;
    });
    const unansweredCount = unanswered.length;

    const metricElem = document.getElementById('metric-unanswered-messages');
    if (metricElem) {
      metricElem.textContent = unansweredCount;
      metricElem.style.color = unansweredCount > 0 ? '#0284c7' : 'var(--text-muted)';
    }

    const subElem = document.getElementById('metric-messages-sub');
    if (subElem) {
      if (unansweredCount === 0) {
        subElem.textContent = 'All inquiries answered';
        subElem.style.color = 'var(--text-muted)';
      } else if (unansweredCount === 1) {
        subElem.textContent = '1 inquiry awaiting reply';
        subElem.style.color = '#0284c7';
      } else {
        subElem.textContent = `${unansweredCount} inquiries awaiting reply`;
        subElem.style.color = '#0284c7';
      }
    }

    const badgeElem = document.getElementById('badge-admin-messages');
    if (badgeElem) {
      if (unansweredCount > 0) {
        badgeElem.textContent = unansweredCount;
        badgeElem.style.display = 'inline-flex';
      } else {
        badgeElem.style.display = 'none';
      }
    }
  }
}

// ----------------- Segmented Lifecycle Filtering -----------------

function setInternFilter(status) {
  const filterInput = document.getElementById('filter-intern-status');
  if (filterInput) filterInput.value = status;

  const chips = ['all', 'active', 'completed', 'pending', 'rejected'];
  chips.forEach(s => {
    const chip = document.getElementById(`chip-filter-${s}`);
    if (chip) chip.classList.toggle('active', s === status);
  });

  loadInterns();
}

function filterInternsByStatus(status) {
  // Switch to interns tab without triggering the old load to avoid racing requests
  switchAdminTab('interns', false);

  const filterInput = document.getElementById('filter-intern-status');
  if (filterInput) filterInput.value = status;

  const searchInput = document.getElementById('search-interns');
  if (searchInput) searchInput.value = '';

  const chips = ['all', 'active', 'completed', 'pending', 'rejected'];
  chips.forEach(s => {
    const chip = document.getElementById(`chip-filter-${s}`);
    if (chip) chip.classList.toggle('active', s === status);
  });

  // Single authoritative load
  loadInterns();

  // Smooth scroll to directory panel
  const panel = document.getElementById('admin-panel-interns');
  if (panel) {
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function filterTasksByActive() {
  const sel = document.getElementById('filter-task-status');
  if (sel) sel.value = 'active';
  switchAdminTab('tasks', true);

  const panel = document.getElementById('admin-panel-tasks');
  if (panel) {
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Helper: Initials & Avatar Palette
function getInitials(name) {
  if (!name) return 'IN';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #4f46e5, #6366f1)',
  'linear-gradient(135deg, #059669, #10b981)',
  'linear-gradient(135deg, #7c3aed, #9333ea)',
  'linear-gradient(135deg, #0284c7, #38bdf8)',
  'linear-gradient(135deg, #ea580c, #f97316)',
  'linear-gradient(135deg, #db2777, #f43f5e)'
];

function getAvatarGradient(id) {
  return AVATAR_GRADIENTS[(id || 0) % AVATAR_GRADIENTS.length];
}

let reqSeqInterns = 0;
async function loadInterns() {
  const thisSeq = ++reqSeqInterns;
  const status = document.getElementById('filter-intern-status').value || 'all';
  const search = document.getElementById('search-interns').value.trim();
  const tbody = document.getElementById('tbody-interns');

  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 2.5rem; color: var(--text-muted);"><div class="spinner-small" style="margin:0 auto 0.75rem auto;"></div>Loading intern directory...</td></tr>';

  let url = `/api/interns?status=${encodeURIComponent(status)}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;

  const res = await api(url);
  if (thisSeq !== reqSeqInterns) return; // Discard stale request
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 2.5rem; color:var(--danger);">${res.data.error}</td></tr>`;
    return;
  }

  // 1. Dedicated Pending Administrator Requests (Clean separation from Interns)
  const pendingAdminsContainer = document.getElementById('pending-admins-container');
  const tbodyPendingAdmins = document.getElementById('tbody-pending-admins');
  const badgePendingAdmins = document.getElementById('badge-pending-admins-count');
  const internsTableHeader = document.getElementById('interns-table-header');

  if (status === 'pending') {
    const pendingAdmins = res.data.pending_admins || [];
    if (pendingAdmins.length > 0) {
      if (pendingAdminsContainer) pendingAdminsContainer.style.display = 'block';
      if (badgePendingAdmins) badgePendingAdmins.textContent = `${pendingAdmins.length} Request${pendingAdmins.length > 1 ? 's' : ''}`;
      if (tbodyPendingAdmins) {
        tbodyPendingAdmins.innerHTML = pendingAdmins.map(a => {
          const isCreator = currentUser && a.created_by_id && currentUser.id === a.created_by_id;
          const isSuper = currentUser && currentUser.role === 'super_admin';
          let actBtn = '';
          if (!isSuper && isCreator) {
            actBtn = `
              <span class="badge badge-pending" style="font-size:0.72rem; padding:0.35rem 0.55rem;" title="Account created by you. Requires another administrator's peer review or Super Admin approval.">
                ⏳ Awaiting Peer / Super Admin
              </span>
              <button type="button" class="btn btn-danger btn-xs" onclick="openRejectModal(${a.id}, '${escapeHtml(a.full_name)}')">✕ Cancel</button>
            `;
          } else {
            actBtn = `
              <button type="button" class="btn btn-success btn-xs" onclick="approveIntern(${a.id}, '${escapeHtml(a.full_name)}')">✓ Approve Admin</button>
              <button type="button" class="btn btn-danger btn-xs" onclick="openRejectModal(${a.id}, '${escapeHtml(a.full_name)}')">✕ Reject</button>
            `;
          }
          return `
            <tr>
              <td>
                <div style="font-weight:700; color:var(--text-main);">${escapeHtml(a.full_name)}</div>
                <div style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(a.email)}</div>
              </td>
              <td>${escapeHtml(a.department || 'Administration')}</td>
              <td>${escapeHtml(a.phone || '—')}</td>
              <td>
                <span class="badge" style="background:rgba(99, 102, 241, 0.12); color:#4f46e5; font-size:0.75rem;">
                  👤 ${escapeHtml(a.created_by_name || 'Administrator')}
                </span>
              </td>
              <td><span class="badge badge-pending"><span class="badge-dot dot-pending"></span>Pending</span></td>
              <td style="text-align: right; white-space: nowrap;">${actBtn}</td>
            </tr>
          `;
        }).join('');
      }
    } else {
      if (pendingAdminsContainer) pendingAdminsContainer.style.display = 'none';
    }

    if (internsTableHeader) internsTableHeader.style.display = 'block';
  } else {
    if (pendingAdminsContainer) pendingAdminsContainer.style.display = 'none';
    if (internsTableHeader) internsTableHeader.style.display = 'none';
  }

  // 2. Pure Intern Directory Records
  const interns = res.data.interns || [];
  adminInternsCache = interns;
  if (interns.length === 0) {
    const statusText = status === 'all' ? 'enrolled' : status;
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding: 3rem 1rem;">
          <div style="font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.8;">👥</div>
          <div style="font-weight: 700; color: var(--text-main); font-size: 1rem;">No interns found</div>
          <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">
            No intern candidates matched the current filter (${statusText}).
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = interns.map(intern => {
    let statusBadge = '';
    let actionButtons = '';

    if (intern.status === 'pending') {
      statusBadge = '<span class="badge badge-pending"><span class="badge-dot dot-pending"></span>Pending</span>';
      actionButtons = `
        <button type="button" class="btn btn-success btn-xs" onclick="approveIntern(${intern.id}, '${escapeHtml(intern.full_name)}')">
          ✓ Approve
        </button>
        <button type="button" class="btn btn-danger btn-xs" onclick="openRejectModal(${intern.id}, '${escapeHtml(intern.full_name)}')">
          ✕ Reject
        </button>
      `;
    } else if (intern.status === 'completed') {
      statusBadge = '<span class="badge badge-completed"><span class="badge-dot dot-completed"></span>Alumni</span>';
      actionButtons = `
        <button type="button" class="btn btn-secondary btn-xs" onclick="prefillLetterForIntern(${intern.id})" title="Issue or view letter">
          📜 Letter
        </button>
        <button type="button" class="btn btn-secondary btn-xs" onclick="reactivateIntern(${intern.id}, '${escapeHtml(intern.full_name)}')" title="Return alumni back to active internship">
          🔄 Reactivate
        </button>
      `;
    } else if (intern.status === 'approved') {
      statusBadge = '<span class="badge badge-approved"><span class="badge-dot dot-approved"></span>Active</span>';
      actionButtons = `
        <button type="button" class="btn btn-purple btn-xs" onclick="openCompleteModal(${intern.id}, '${escapeHtml(intern.full_name)}', '${escapeHtml(intern.email)}', '${escapeHtml(intern.department || '')}')" title="Graduate this active intern to Alumni">
          🎓 Complete
        </button>
        <button type="button" class="btn btn-secondary btn-xs" onclick="prefillTaskForIntern(${intern.id})" title="Assign new task">
          ➕ Task
        </button>
        <button type="button" class="btn btn-secondary btn-xs" onclick="prefillLetterForIntern(${intern.id})" title="Issue completion letter">
          📜 Letter
        </button>
      `;
    } else {
      const rejTitle = intern.rejection_reason ? ` title="Reason: ${escapeHtml(intern.rejection_reason)}"` : '';
      statusBadge = `<span class="badge badge-rejected"${rejTitle}><span class="badge-dot dot-rejected"></span>Rejected</span>`;
      actionButtons = `
        <button type="button" class="btn btn-secondary btn-xs" onclick="approveIntern(${intern.id}, '${escapeHtml(intern.full_name)}')">
          ✓ Re-Approve
        </button>
        <button type="button" class="btn btn-danger btn-xs" onclick="deleteRejectedUser(${intern.id}, '${escapeHtml(intern.full_name)}', '${intern.role}')" title="Permanently delete rejected record">
          🗑️ Delete
        </button>
      `;
    }

    // Super Admin exclusive: Allow permanently deleting active, completed, or pending interns
    if (currentUser && currentUser.role === 'super_admin' && intern.role === 'intern' && intern.status !== 'rejected') {
      actionButtons += `
        <button type="button" class="btn btn-danger btn-xs" onclick="deleteIntern(${intern.id}, '${escapeHtml(intern.full_name)}')" title="Permanently delete intern ${escapeHtml(intern.full_name)}">
          🗑️ Delete
        </button>
      `;
    }

    // Mini task progress bar calculation
    const totalT = intern.total_tasks || 0;
    const compT = intern.completed_tasks || 0;
    const pct = totalT > 0 ? Math.round((compT / totalT) * 100) : 0;
    const initials = getInitials(intern.full_name);
    const gradBg = getAvatarGradient(intern.id);

    return `
      <tr>
        <td>
          <div class="intern-profile-cell">
            <div class="intern-avatar" style="background: ${gradBg}; cursor: pointer;" onclick="openInternDetailsModal(${intern.id})" title="View complete deliverables and projects done by ${escapeHtml(intern.full_name)}">
              ${initials}
            </div>
            <div>
              <button type="button" class="intern-name-btn" onclick="openInternDetailsModal(${intern.id})" title="Click to view tasks, deliverables, and projects for ${escapeHtml(intern.full_name)}">
                <span>${escapeHtml(intern.full_name)}</span>
                <span class="intern-name-view-badge">👁️ Projects</span>
              </button>
              <div class="intern-email">${escapeHtml(intern.email)}</div>
              <div style="display:inline-flex; align-items:center; gap:4px; font-family:'Space Mono', monospace; font-size:0.70rem; font-weight:700; color:#0284c7; background:rgba(2,132,199,0.08); border:1px solid rgba(2,132,199,0.25); padding:1px 6px; border-radius:4px; margin-top:2px;">
                ID: ${escapeHtml(intern.credential_id || ('BTC-2026-' + intern.id))}
              </div>
              ${intern.phone ? `<div class="intern-phone">📞 ${escapeHtml(intern.phone)}</div>` : ''}
              ${intern.role === 'admin' ? `<div style="font-size: 0.72rem; color: #b45309; font-weight: 600; margin-top: 2px;">🛡️ Administrator Provisioning Request ${intern.created_by_name ? `(Created by ${escapeHtml(intern.created_by_name)})` : ''}</div>` : ''}
            </div>
          </div>
        </td>
        <td>
          <span class="track-tag">${escapeHtml(intern.department || (intern.role === 'admin' ? 'Operations / Admin' : 'General Track'))}</span>
        </td>
        <td>
          <span class="uni-text">${escapeHtml(intern.university || (intern.role === 'admin' ? 'Staff Member' : 'N/A'))}</span>
        </td>
        <td>${statusBadge}</td>
        <td>
          <div class="task-progress-cell">
            <div class="progress-bar-track">
              <div class="progress-bar-thumb" style="width: ${pct}%;"></div>
            </div>
            <div class="task-progress-text">
              <strong>${compT}</strong> / ${totalT} <span style="color:var(--text-muted); font-size:0.72rem;">(${pct}%)</span>
            </div>
          </div>
        </td>
        <td>
          <button type="button" class="attendance-tag" onclick="jumpToInternAttendance(${intern.id}, '${escapeHtml(intern.full_name).replace(/'/g, "\\'")}')" style="cursor:pointer; border:1px solid #cbd5e1; background:#f8fafc; font-family:inherit;" title="View all historical attendance logs for ${escapeHtml(intern.full_name)}">
            ⏱️ <strong>${intern.attendance_days || 0}</strong>d ↗
          </button>
        </td>
        <td>
          ${intern.letters_count > 0 
            ? `<span class="badge badge-completed" title="Certified completion document issued">📜 Conferred (${intern.letters_count})</span>` 
            : '<span style="color:var(--text-faint); font-size: 0.85rem;">—</span>'}
        </td>
        <td style="text-align: right; white-space: nowrap;">
          <div class="intern-action-group" style="justify-content: flex-end;">
            ${actionButtons}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ----------------- Intern Lifecycle Transitions -----------------

function openCompleteModal(internId, name, email, department) {
  document.getElementById('complete-intern-id').value = internId;
  document.getElementById('complete-intern-name').textContent = name;
  document.getElementById('complete-intern-detail').textContent = `${email} • ${department || 'General Track'}`;
  document.getElementById('complete-end-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('complete-notes').value = '';
  openModal('modal-complete-internship');
}

async function handleConfirmCompleteInternship(e) {
  e.preventDefault();
  const id = document.getElementById('complete-intern-id').value;
  const completionDate = document.getElementById('complete-end-date').value;
  const notes = document.getElementById('complete-notes').value.trim();

  const btn = document.getElementById('btn-confirm-complete');
  btn.disabled = true;
  btn.textContent = 'Graduating candidate...';

  const res = await api(`/api/interns/${id}/complete`, 'PATCH', {
    completion_date: completionDate,
    notes: notes
  });

  btn.disabled = false;
  btn.textContent = '🎓 Graduate to Alumni';

  if (res.ok) {
    closeModal('modal-complete-internship');
    showToast(`Intern successfully graduated to Completed / Alumni status!`, 'success');
    loadInterns();
    loadAdminOverview();
  } else {
    showToast(res.data.error || 'Failed to complete internship.', 'error');
  }
}

async function reactivateIntern(internId, name) {
  if (!confirm(`Reactivate ${name} back to Active in Program status?`)) return;
  const res = await api(`/api/interns/${internId}/reactivate`, 'PATCH');
  if (res.ok) {
    showToast(`${name} has been reactivated to Active in Program!`, 'success');
    loadInterns();
    loadAdminOverview();
  } else {
    showToast(res.data.error || 'Failed to reactivate intern.', 'error');
  }
}

async function approveIntern(internId, name) {
  const res = await api(`/api/interns/${internId}/approve`, 'PATCH');
  if (res.ok) {
    showToast(res.data.message || `Account for "${name}" has been approved!`, 'success');
    loadInterns();
    loadAdminOverview();
    loadSuperAdminAdmins();
  } else {
    showToast(res.data.error || 'Failed to approve account.', 'error');
  }
}

function openRejectModal(internId, name) {
  document.getElementById('reject-intern-id').value = internId;
  document.getElementById('reject-intern-name').textContent = name;
  document.getElementById('reject-reason').value = '';
  openModal('modal-reject-intern');
}

async function handleConfirmReject(e) {
  e.preventDefault();
  const id = document.getElementById('reject-intern-id').value;
  const reason = document.getElementById('reject-reason').value.trim();

  const res = await api(`/api/interns/${id}/reject`, 'PATCH', { reason });
  closeModal('modal-reject-intern');

  if (res.ok) {
    showToast('Application marked as rejected.', 'info');
    loadInterns();
    loadAdminOverview();
    loadSuperAdminAdmins();
  } else {
    showToast(res.data.error || 'Failed to reject application.', 'error');
  }
}

// ----------------- Intern Detail & Project Showcase -----------------

function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) {
    return dateStr;
  }
}

let activeInternDetailsId = null;

function prefillTaskFromDetails() {
  if (!activeInternDetailsId) return;
  const targetId = activeInternDetailsId;
  closeModal('modal-intern-details');
  prefillTaskForIntern(targetId);
}

async function openInternDetailsModal(internId) {
  activeInternDetailsId = internId;
  const headerEl = document.getElementById('intern-modal-header-info');
  const kpisEl = document.getElementById('intern-modal-kpis');
  const tasksEl = document.getElementById('intern-modal-tasks-container');
  const lettersSectionEl = document.getElementById('intern-modal-letters-section');
  const lettersContainerEl = document.getElementById('intern-modal-letters-container');
  const assignBtn = document.getElementById('btn-modal-assign-task');

  // Loading state
  headerEl.innerHTML = '<div style="display:flex; align-items:center; gap:0.75rem; color:var(--text-muted); padding: 0.5rem 0;"><div class="spinner-small"></div> Loading profile & projects...</div>';
  kpisEl.innerHTML = '';
  tasksEl.innerHTML = '<div style="text-align:center; padding:2rem; color:var(--text-muted);"><div class="spinner-small" style="margin:0 auto 0.5rem auto;"></div>Retrieving completed tasks and deliverables...</div>';
  lettersSectionEl.style.display = 'none';
  lettersContainerEl.innerHTML = '';
  if (assignBtn) assignBtn.style.display = 'inline-flex';

  openModal('modal-intern-details');

  const res = await api(`/api/interns/${internId}`);
  if (!res.ok) {
    tasksEl.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--danger);">${res.data.error || 'Failed to load intern details.'}</div>`;
    return;
  }

  const { intern, tasks, attendance, letters } = res.data;
  const initials = getInitials(intern.full_name);
  const gradBg = getAvatarGradient(intern.id);

  // Status badge
  let statusBadge = '';
  if (intern.status === 'approved') statusBadge = '<span class="badge badge-approved"><span class="badge-dot dot-approved"></span>Active Intern</span>';
  else if (intern.status === 'completed') statusBadge = '<span class="badge badge-completed"><span class="badge-dot dot-completed"></span>Alumni Graduate</span>';
  else if (intern.status === 'pending') statusBadge = '<span class="badge badge-pending"><span class="badge-dot dot-pending"></span>Pending Approval</span>';
  else statusBadge = '<span class="badge badge-rejected"><span class="badge-dot dot-rejected"></span>Rejected</span>';

  // If intern is not active, hide assign task button
  if (assignBtn) {
    assignBtn.style.display = intern.status === 'approved' ? 'inline-flex' : 'none';
  }

  // Header info
  headerEl.innerHTML = `
    <div class="intern-avatar" style="background: ${gradBg}; width: 54px; height: 54px; font-size: 1.3rem; flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.12);">
      ${initials}
    </div>
    <div style="flex: 1; min-width: 0;">
      <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
        <h3 style="margin: 0; font-size: 1.25rem; font-weight: 800; color: var(--text-main);">${escapeHtml(intern.full_name)}</h3>
        <span style="font-family:'Space Mono', monospace; font-size:0.75rem; font-weight:700; color:#0284c7; background:rgba(2,132,199,0.1); border:1px solid rgba(2,132,199,0.3); padding:2px 8px; border-radius:5px;">
          ID: ${escapeHtml(intern.credential_id || ('BTC-2026-' + intern.id))}
        </span>
        ${statusBadge}
        ${intern.role === 'admin' ? '<span class="badge" style="background:rgba(245, 158, 11, 0.15); color:#b45309; font-weight:700;">🛡️ Administrator</span>' : ''}
      </div>
      <div style="display: flex; gap: 0.85rem; flex-wrap: wrap; margin-top: 0.35rem; font-size: 0.84rem; color: var(--text-secondary);">
        <span>📧 ${escapeHtml(intern.email)}</span>
        ${intern.phone ? `<span>📞 ${escapeHtml(intern.phone)}</span>` : ''}
        <span>🏛️ ${escapeHtml(intern.university || (intern.role === 'admin' ? 'Staff Member' : 'Not Specified'))}</span>
        <span>🏷️ <strong style="color:var(--primary);">${escapeHtml(intern.department || (intern.role === 'admin' ? 'Operations' : 'General Track'))}</strong></span>
      </div>
    </div>
  `;

  // Calculate metrics
  const totalTasks = tasks ? tasks.length : 0;
  const completedTasks = tasks ? tasks.filter(t => t.status === 'completed').length : 0;
  const pct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const attendanceDays = attendance ? attendance.length : 0;

  kpisEl.innerHTML = `
    <div class="intern-detail-kpi-grid">
      <div class="intern-detail-kpi-box">
        <div class="kpi-num" style="color: var(--primary);">${totalTasks}</div>
        <div class="kpi-label">Total Assigned Tasks</div>
      </div>
      <div class="intern-detail-kpi-box">
        <div class="kpi-num" style="color: var(--success);">${completedTasks}</div>
        <div class="kpi-label">Completed Deliverables</div>
      </div>
      <div class="intern-detail-kpi-box">
        <div class="kpi-num" style="color: var(--accent);">${pct}%</div>
        <div class="kpi-label">Completion Velocity</div>
      </div>
      <div class="intern-detail-kpi-box">
        <div class="kpi-num" style="color: #6366f1;">${attendanceDays}d</div>
        <div class="kpi-label">Days Present</div>
      </div>
    </div>
  `;

  // Render Tasks / Projects
  if (!tasks || tasks.length === 0) {
    tasksEl.innerHTML = `
      <div style="text-align: center; padding: 2.5rem 1rem; background: var(--bg-hover); border-radius: 12px; border: 1px dashed var(--border-subtle);">
        <div style="font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.8;">📂</div>
        <div style="font-weight: 700; color: var(--text-main); font-size: 1rem;">No tasks assigned yet</div>
        <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">
          This intern has not been assigned any tasks or projects yet.
        </div>
        ${intern.status === 'approved' ? `
          <button type="button" class="btn btn-primary btn-sm" style="margin-top: 1rem;" onclick="prefillTaskFromDetails()">
            ➕ Assign First Task Now
          </button>
        ` : ''}
      </div>
    `;
  } else {
    tasksEl.innerHTML = tasks.map((task, idx) => {
      let tStatusBadge = '';
      if (task.status === 'completed') {
        tStatusBadge = '<span class="badge badge-completed" style="background:rgba(16,185,129,0.12); color:#059669; border:1px solid rgba(16,185,129,0.3); font-weight:700;"><span class="badge-dot dot-completed"></span>Completed</span>';
      } else if (task.status === 'in_progress' || task.status === 'in-progress') {
        tStatusBadge = '<span class="badge badge-in-progress" style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; font-weight:700;"><span class="badge-dot dot-in-progress"></span>In Progress</span>';
      } else {
        tStatusBadge = '<span class="badge badge-pending" style="background:#fffbeb; color:#b45309; border:1px solid #fde68a; font-weight:700;"><span class="badge-dot dot-pending"></span>Pending</span>';
      }

      let priorityColor = '#334155';
      if (task.priority === 'urgent') priorityColor = 'var(--danger)';
      else if (task.priority === 'high') priorityColor = '#ea580c';
      else if (task.priority === 'low') priorityColor = '#2563eb';

      const hasDeliverables = !!(task.intern_notes || task.github_repo || task.attachment_path);

      return `
        <div class="intern-task-card">
          <div class="task-card-header">
            <div style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;">
              <span style="font-weight: 800; color: var(--primary); font-size: 0.95rem;">#${idx + 1}</span>
              <strong style="color: var(--text-main); font-size: 1rem;">${escapeHtml(task.title)}</strong>
              ${tStatusBadge}
              <span style="font-size: 0.74rem; font-weight: 800; color: ${priorityColor}; text-transform: uppercase; letter-spacing: 0.6px; margin-left: 0.15rem;">
                ${escapeHtml(task.priority || 'medium')} priority
              </span>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">
              ${task.due_date ? `📅 Due: <strong>${formatDisplayDate(task.due_date)}</strong>` : 'No due date'}
            </div>
          </div>

          ${task.description ? `
            <div style="font-size: 0.88rem; color: var(--text-secondary); margin-bottom: 0.75rem; line-height: 1.5; white-space: pre-line;">
              ${escapeHtml(task.description)}
            </div>
          ` : ''}

          ${task.admin_attachment_path ? `
            <div style="margin-bottom: 0.75rem; background: rgba(99, 102, 241, 0.06); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 8px; padding: 0.55rem 0.8rem; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;">
              <div style="display: flex; align-items: center; gap: 0.5rem; overflow: hidden;">
                <span style="font-size: 1rem;">📎</span>
                <div style="overflow: hidden;">
                  <span style="font-size: 0.72rem; color: var(--primary); text-transform: uppercase; font-weight: 700; display: block;">Task Brief Attachment:</span>
                  <span style="font-weight: 600; font-size: 0.82rem; color: var(--text-main); text-overflow: ellipsis; white-space: nowrap; overflow: hidden; display: block;">${escapeHtml(task.admin_attachment_filename || 'Attachment File')}</span>
                </div>
              </div>
              <a href="${task.admin_attachment_path}" target="_blank" download class="btn btn-secondary btn-xs" style="flex-shrink: 0; text-decoration: none;">Download</a>
            </div>
          ` : ''}

          <!-- Deliverables & Submissions Section -->
          ${hasDeliverables ? `
            <div class="intern-task-deliverable-box">
              <div class="deliverable-box-title">
                <span>🚀</span> Intern Deliverables &amp; Project Work:
              </div>

              ${task.intern_notes ? `
                <div style="font-size: 0.85rem; color: var(--text-main); margin-bottom: 0.6rem; line-height: 1.5; background: #fff; padding: 0.6rem 0.8rem; border-radius: 6px; border: 1px solid var(--border-subtle);">
                  <strong style="font-size: 0.78rem; text-transform: uppercase; color: var(--text-muted); display: block; margin-bottom: 0.2rem;">Intern Notes / Brief:</strong>
                  ${escapeHtml(task.intern_notes)}
                </div>
              ` : ''}

              <div style="display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center;">
                ${task.github_repo ? `
                  <a href="${escapeHtml(task.github_repo)}" target="_blank" rel="noopener noreferrer" class="deliverable-link-chip" title="View Source Code Repository">
                    <span>🐙</span> GitHub / Project URL
                    <span style="font-size: 0.72rem; opacity: 0.8;">↗</span>
                  </a>
                ` : ''}

                ${task.attachment_path ? `
                  <a href="${task.attachment_path}" target="_blank" download rel="noopener noreferrer" class="deliverable-link-chip" title="Download or view attached file">
                    <span>📎</span> ${escapeHtml(task.attachment_filename || 'Attached Deliverable')}
                    <span style="font-size: 0.72rem; opacity: 0.8;">⬇</span>
                  </a>
                ` : ''}
              </div>
              <div style="margin-top: 0.65rem;">
                <button type="button" class="btn-progress-history" onclick="viewTaskProgressHistoryModal(${task.id})" title="View all daily progress reports for this task">
                  📜 Daily Progress Reports (${task.progress_count || (task.progress_updates ? task.progress_updates.length : 0)})
                </button>
              </div>
            </div>
          ` : `
            <div style="font-size: 0.8rem; color: var(--text-faint); font-style: italic; margin-top: 0.4rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
              <span>⏳ No deliverables or notes submitted yet by intern.</span>
              <button type="button" class="btn-progress-history" onclick="viewTaskProgressHistoryModal(${task.id})" title="Check progress reports">
                📜 Progress Log (${task.progress_count || (task.progress_updates ? task.progress_updates.length : 0)})
              </button>
            </div>
          `}

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.75rem; font-size: 0.78rem; color: var(--text-muted); flex-wrap: wrap; gap: 0.5rem;">
            <div>Assigned by: <strong>${escapeHtml(task.created_by_name || 'Admin')}</strong></div>
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              ${task.completed_at ? `<span style="color:#059669; font-weight:600;">✅ Completed on: ${formatDisplayDate(task.completed_at)}</span>` : `<span>Created: ${formatDisplayDate(task.created_at)}</span>`}
              ${task.status === 'completed' ? `
                <button type="button" class="btn btn-outline-primary btn-xs" onclick="openExtendTaskModal(${task.id}, '${escapeHtml(task.title).replace(/'/g, "\\'")}', '${task.due_date || ''}', ${intern.id}, '${escapeHtml(intern.full_name).replace(/'/g, "\\'")}')" style="font-size:0.75rem; padding:2px 8px; font-weight:700; background:#eef2ff; color:#4338ca; border:1px solid #c7d2fe;" title="Extend due date and change status back to In Progress">
                  🔄 Extend Deadline &amp; Reopen
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Letters Section
  if (letters && letters.length > 0) {
    lettersSectionEl.style.display = 'block';
    lettersContainerEl.innerHTML = letters.map(letItem => `
      <div style="background: var(--bg-hover); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.85rem 1rem; display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
        <div>
          <div style="font-weight: 700; color: var(--text-main); font-size: 0.92rem;">📜 ${escapeHtml(letItem.title || 'Internship Letter')}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.2rem;">
            Ref: <code>${escapeHtml(letItem.letter_number || letItem.reference_no || '')}</code> • Conferred: ${formatDisplayDate(letItem.issue_date)} • Track: ${escapeHtml(letItem.department || 'General')}
          </div>
        </div>
        <div style="display: flex; gap: 0.4rem; align-items: center;">
          <button type="button" class="btn btn-secondary btn-xs" onclick='openPreviewCertificate(${JSON.stringify(letItem).replace(/'/g, "&apos;")})'>
            👁️ View
          </button>
          <a href="/certificate/${letItem.letter_number}" target="_blank" class="btn btn-primary btn-xs">
            🖨️ Print
          </a>
          ${letItem.document_filename ? `
            <a href="/api/letters/${letItem.id}/download" class="btn btn-secondary btn-xs" download="${escapeHtml(letItem.document_filename)}" title="Download attached PDF/Word file: ${escapeHtml(letItem.document_filename)}">
              📄 Doc
            </a>
          ` : ''}
        </div>
      </div>
    `).join('');
  } else {
    lettersSectionEl.style.display = 'none';
  }
}

// ----------------- Task Delegation (Admin) -----------------

async function populateApprovedInternsDropdown(selectId, selectedId = null, allowAlumni = false) {
  const select = document.getElementById(selectId);
  select.innerHTML = '<option value="">Select an intern...</option>';

  const res = await api('/api/interns?status=all');
  if (res.ok) {
    const candidates = res.data.interns.filter(i => i.status === 'approved' || (allowAlumni && i.status === 'completed'));
    candidates.forEach(intern => {
      const opt = document.createElement('option');
      opt.value = intern.id;
      const alumniLabel = intern.status === 'completed' ? ' [🎓 Alumni]' : '';
      opt.textContent = `${intern.full_name} (${intern.email}) [${intern.department || 'General Track'}]${alumniLabel}`;
      opt.dataset.dept = intern.department || 'Software Engineering';
      opt.dataset.start = intern.start_date || '';
      opt.dataset.end = intern.end_date || '';
      if (selectedId && intern.id === selectedId) opt.selected = true;
      select.appendChild(opt);
    });
  }
}

async function openCreateTaskModal() {
  await populateApprovedInternsDropdown('task-assignee');
  document.getElementById('form-create-task').reset();
  const fileInput = document.getElementById('create-task-file');
  if (fileInput) fileInput.value = '';
  const display = document.getElementById('create-task-filename-display');
  if (display) display.textContent = 'No file selected';
  openModal('modal-create-task');
}

function handleCreateTaskFileChange(input) {
  const display = document.getElementById('create-task-filename-display');
  if (!display) return;
  if (input.files && input.files[0]) {
    const file = input.files[0];
    const sizeKB = (file.size / 1024).toFixed(1);
    display.innerHTML = `<span style="color:var(--primary); font-weight:600;">📎 ${escapeHtml(file.name)}</span> <span style="color:var(--text-muted); font-size:0.75rem;">(${sizeKB} KB)</span>`;
  } else {
    display.textContent = 'No file selected';
  }
}

function prefillTaskForIntern(internId) {
  openCreateTaskModal().then(() => {
    document.getElementById('task-assignee').value = internId;
  });
}

async function handleCreateTask(e) {
  e.preventDefault();
  const title = document.getElementById('task-title').value.trim();
  const assigned_to_id = parseInt(document.getElementById('task-assignee').value);
  const priority = document.getElementById('task-priority').value;
  const due_date = document.getElementById('task-due-date').value || '';
  const description = document.getElementById('task-description').value.trim();
  const fileInput = document.getElementById('create-task-file');

  const btn = document.getElementById('btn-submit-task');
  btn.disabled = true;
  btn.textContent = 'Assigning...';

  let res;
  if (fileInput && fileInput.files && fileInput.files[0]) {
    const formData = new FormData();
    formData.append('title', title);
    formData.append('assigned_to_id', assigned_to_id);
    formData.append('priority', priority);
    if (due_date) formData.append('due_date', due_date);
    if (description) formData.append('description', description);
    formData.append('attachment', fileInput.files[0]);
    res = await api('/api/tasks', 'POST', formData);
  } else {
    const payload = {
      title,
      assigned_to_id,
      priority,
      due_date: due_date || null,
      description
    };
    res = await api('/api/tasks', 'POST', payload);
  }

  btn.disabled = false;
  btn.textContent = 'Assign Task';

  if (res.ok) {
    showToast('Task created and assigned successfully!', 'success');
    closeModal('modal-create-task');
    if (fileInput) fileInput.value = '';
    const fnDisplay = document.getElementById('create-task-filename-display');
    if (fnDisplay) fnDisplay.textContent = 'No file selected';
    loadAdminTasks();
    loadAdminOverview();
  } else {
    showToast(res.data.error || 'Failed to create task.', 'error');
  }
}

let reqSeqTasks = 0;
async function loadAdminTasks() {
  const thisSeq = ++reqSeqTasks;
  const statusFilter = document.getElementById('filter-task-status').value;
  const tbody = document.getElementById('tbody-admin-tasks');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 2rem;"><div class="spinner-small" style="margin: 0 auto 0.5rem auto;"></div>Loading tasks...</td></tr>';

  let url = '/api/tasks';
  if (statusFilter) url += `?status=${encodeURIComponent(statusFilter)}`;

  const res = await api(url);
  if (thisSeq !== reqSeqTasks) return; // Discard stale response
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--danger);">${res.data.error}</td></tr>`;
    return;
  }

  const tasks = res.data.tasks;
  if (tasks.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">No tasks found. Click "Assign Task" to create one.</td></tr>';
    return;
  }

  tbody.innerHTML = tasks.map(task => {
    return `
      <tr>
        <td style="max-width: 250px;">
          <div style="font-weight:700; color:var(--text-main);">${escapeHtml(task.title)}</div>
          <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:0.2rem;">${escapeHtml(task.description || 'No description provided')}</div>
          ${task.admin_attachment_path ? `
            <div style="margin-top:0.4rem;">
              <a href="${task.admin_attachment_path}" target="_blank" download class="badge" style="display:inline-flex; align-items:center; gap:0.25rem; text-decoration:none; padding:0.22rem 0.55rem; font-size:0.72rem; background:#f5f3ff; color:#6d28d9; border:1px solid #ddd6fe;" title="Download Task Brief: ${escapeHtml(task.admin_attachment_filename)}">
                📎 Brief: ${escapeHtml(task.admin_attachment_filename || 'Attachment')}
              </a>
            </div>
          ` : ''}
        </td>
        <td>
          <div style="font-weight:600;">${escapeHtml(task.assigned_to_name || 'N/A')}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(task.assigned_to_email || '')}</div>
        </td>
        <td><span class="badge badge-${task.priority}">${task.priority}</span></td>
        <td>${task.due_date ? task.due_date : '<span style="color:var(--text-muted);">None</span>'}</td>
        <td><span class="badge badge-${task.status}">${task.status.replace('_', ' ')}</span></td>
        <td style="max-width: 240px; font-size:0.85rem; color:var(--text-secondary);">
          <div>${task.intern_notes ? `<div style="background:#f8fafc; border:1px solid #e2e8f0; border-left:3px solid #4f46e5; padding:0.45rem 0.65rem; border-radius:6px; font-size:0.82rem; color:#1e293b; margin-bottom:0.35rem; line-height:1.4;">${escapeHtml(task.intern_notes)}</div>` : '<span style="color:var(--text-muted); font-size:0.8rem;">No notes yet</span>'}</div>
          ${task.github_repo ? `
            <div style="margin-top:0.35rem;">
              <a href="${escapeHtml(task.github_repo)}" target="_blank" rel="noopener noreferrer" class="badge" style="display:inline-flex; align-items:center; gap:0.25rem; text-decoration:none; padding:0.25rem 0.6rem; font-size:0.75rem; background:#ecfdf5; color:#047857; border:1px solid #a7f3d0;" title="Open Project Link: ${escapeHtml(task.github_repo)}">
                🐙 Project Link ↗
              </a>
            </div>
          ` : ''}
          ${task.attachment_path ? `
            <div style="margin-top:0.35rem;">
              <a href="${task.attachment_path}" target="_blank" download class="badge" style="display:inline-flex; align-items:center; gap:0.25rem; text-decoration:none; padding:0.25rem 0.6rem; font-size:0.75rem; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe;" title="Download deliverable: ${escapeHtml(task.attachment_filename)}">
                📎 ${escapeHtml(task.attachment_filename || 'Download File')}
              </a>
            </div>
          ` : ''}
          <div style="margin-top:0.45rem;">
            <button type="button" class="btn-progress-history" onclick="viewTaskProgressHistoryModal(${task.id})" title="View complete daily progress history for this task">
              📜 Daily Progress Log (${task.progress_count || (task.progress_updates ? task.progress_updates.length : 0)})
            </button>
          </div>
        </td>
        <td style="text-align: right; white-space: nowrap;">
          ${task.status === 'completed' ? `
            <button class="btn btn-secondary btn-xs" onclick="openExtendTaskModal(${task.id}, '${escapeHtml(task.title).replace(/'/g, "\\'")}', '${task.due_date || ''}', ${task.assigned_to_id}, '${escapeHtml(task.assigned_to_name || 'Intern').replace(/'/g, "\\'")}')" style="margin-right:0.35rem;" title="Extend due date and reopen task as In Progress">
              🔄 Extend &amp; Reopen
            </button>
          ` : ''}
          <button class="btn btn-danger btn-xs" onclick="deleteTask(${task.id}, '${escapeHtml(task.title)}')">
            🗑️ Delete
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function openExtendTaskModal(taskId, title, currentDue, internId, internName) {
  const modal = document.getElementById('modal-extend-task');
  if (!modal) return;
  document.getElementById('extend-task-id').value = taskId;
  document.getElementById('extend-task-intern-id').value = internId || '';
  document.getElementById('extend-task-title').textContent = title;
  document.getElementById('extend-task-intern-name').textContent = internName || 'Intern';
  document.getElementById('extend-task-current-due').textContent = currentDue ? `Current Due Date: ${formatDisplayDate(currentDue)}` : 'Current Due Date: None';

  // Default to 7 days from today
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 7);
  document.getElementById('extend-task-new-date').value = targetDate.toISOString().split('T')[0];
  document.getElementById('extend-task-reason').value = '';

  openModal('modal-extend-task');
}

async function handleConfirmExtendTask(e) {
  e.preventDefault();
  const taskId = document.getElementById('extend-task-id').value;
  const newDate = document.getElementById('extend-task-new-date').value;
  const reason = document.getElementById('extend-task-reason').value.trim();

  const btn = document.getElementById('btn-submit-extend-task');
  btn.disabled = true;
  btn.textContent = 'Updating...';

  const res = await api(`/api/tasks/${taskId}/extend`, 'POST', {
    due_date: newDate,
    reason: reason
  });

  btn.disabled = false;
  btn.textContent = '🔄 Extend & Reopen Task';

  if (res.ok) {
    showToast(res.data.message || 'Task deadline extended and reopened as In Progress!', 'success');
    closeModal('modal-extend-task');
    if (activeInternDetailsId) {
      openInternDetailsModal(activeInternDetailsId);
    }
    loadAdminTasks();
    loadAdminOverview();
  } else {
    showToast(res.data.error || 'Failed to extend task deadline.', 'error');
  }
}

async function deleteTask(taskId, title) {
  if (!confirm(`Delete task "${title}"?`)) return;

  const res = await api(`/api/tasks/${taskId}`, 'DELETE');
  if (res.ok) {
    showToast('Task deleted successfully.', 'info');
    loadAdminTasks();
    loadAdminOverview();
  } else {
    showToast(res.data.error || 'Failed to delete task.', 'error');
  }
}

// ----------------- Internship Letters (Accomplishments) -----------------

let currentInternExistingLetter = null;

async function openIssueLetterModal() {
  await populateApprovedInternsDropdown('letter-intern', null, true);
  document.getElementById('form-issue-letter').reset();
  
  // Reset existing letter alert & update flag
  currentInternExistingLetter = null;
  const alertBox = document.getElementById('letter-existing-alert');
  if (alertBox) alertBox.style.display = 'none';
  const updateExistingInput = document.getElementById('letter-update-existing');
  if (updateExistingInput) updateExistingInput.value = 'false';
  const existingIdInput = document.getElementById('letter-existing-id');
  if (existingIdInput) existingIdInput.value = '';
  const btn = document.getElementById('btn-submit-letter');
  if (btn) btn.textContent = 'Generate & Issue Letter';
  const title = document.getElementById('modal-letter-title');
  if (title) title.textContent = 'Issue Accomplishment Letter & Certificate';

  // Set default dates
  const todayStr = new Date().toISOString().split('T')[0];
  document.getElementById('letter-completion-date').value = todayStr;
  const autoComp = document.getElementById('letter-auto-complete');
  if (autoComp) autoComp.checked = true;
  
  openModal('modal-issue-letter');
}

function prefillLetterForIntern(internId) {
  openIssueLetterModal().then(() => {
    const sel = document.getElementById('letter-intern');
    sel.value = internId;
    handleLetterInternSelect(sel);
  });
}

let currentPreviewLetterCode = '';

async function handleLetterInternSelect(selectElem) {
  const opt = selectElem.selectedOptions[0];
  const internId = selectElem.value;

  if (opt) {
    if (opt.dataset.dept) document.getElementById('letter-department').value = opt.dataset.dept;
    if (opt.dataset.start) document.getElementById('letter-start-date').value = opt.dataset.start;
    if (opt.dataset.end) document.getElementById('letter-completion-date').value = opt.dataset.end;
  }

  const alertBox = document.getElementById('letter-existing-alert');
  const updateExistingInput = document.getElementById('letter-update-existing');
  const existingIdInput = document.getElementById('letter-existing-id');
  const btn = document.getElementById('btn-submit-letter');
  const title = document.getElementById('modal-letter-title');
  const btnPrintDirect = document.getElementById('btn-print-existing-direct');

  if (!internId) {
    if (alertBox) alertBox.style.display = 'none';
    if (updateExistingInput) updateExistingInput.value = 'false';
    if (existingIdInput) existingIdInput.value = '';
    if (btnPrintDirect) btnPrintDirect.style.display = 'none';
    if (btn) btn.textContent = 'Generate & Issue Letter';
    if (title) title.textContent = 'Issue Accomplishment Letter & Certificate';
    currentInternExistingLetter = null;
    return;
  }

  // Check if letter already exists for this intern
  try {
    const res = await api(`/api/letters/check-intern/${internId}`);
    if (res.ok && res.data.has_letter && res.data.letter) {
      currentInternExistingLetter = res.data.letter;
      const letter = res.data.letter;
      if (alertBox) {
        alertBox.style.display = 'block';
        const codeSpan = document.getElementById('existing-letter-code');
        if (codeSpan) codeSpan.textContent = letter.letter_number;
      }
      if (updateExistingInput) updateExistingInput.value = 'true';
      if (existingIdInput) existingIdInput.value = letter.id;
      if (btn) btn.textContent = '🔄 Update Existing Certificate';
      if (title) title.textContent = `Update Certificate (${letter.letter_number})`;
      if (btnPrintDirect) btnPrintDirect.style.display = 'inline-flex';

      // Pre-fill fields with current certificate values
      if (letter.start_date) document.getElementById('letter-start-date').value = letter.start_date;
      if (letter.completion_date) document.getElementById('letter-completion-date').value = letter.completion_date;
      if (letter.department) document.getElementById('letter-department').value = letter.department;
      if (letter.performance_rating) document.getElementById('letter-rating').value = letter.performance_rating;
      if (letter.remarks) document.getElementById('letter-remarks').value = letter.remarks;

      // Dynamic certificate fields
      if (document.getElementById('letter-guardian-name')) document.getElementById('letter-guardian-name').value = letter.guardian_name || '';
      if (document.getElementById('letter-cnic-no')) document.getElementById('letter-cnic-no').value = letter.cnic_no || '';
      if (document.getElementById('letter-duration')) document.getElementById('letter-duration').value = letter.duration_text || 'TWO Months';
      if (document.getElementById('letter-projects')) document.getElementById('letter-projects').value = letter.projects_detail || 'Frontend & Backend: Tailwind CSS, JavaScript, Bootstrap, React.js, Next .js, Node. js ,';
      if (document.getElementById('letter-org-name')) document.getElementById('letter-org-name').value = letter.organization_name || 'DevWork Studio';
      if (document.getElementById('letter-sub-title')) document.getElementById('letter-sub-title').value = letter.sub_title || 'Software Engineering Skill Development Platform';
      if (document.getElementById('letter-auth-by')) document.getElementById('letter-auth-by').value = letter.authorized_by || 'DevWork Studio';
      if (document.getElementById('letter-signatory')) document.getElementById('letter-signatory').value = letter.signatory_title || 'Admin Maheen';
      if (document.getElementById('letter-show-stamp')) document.getElementById('letter-show-stamp').checked = (letter.show_stamp !== false);
      if (document.getElementById('letter-issue-date') && letter.issue_date) document.getElementById('letter-issue-date').value = letter.issue_date;
    } else {
      currentInternExistingLetter = null;
      if (alertBox) alertBox.style.display = 'none';
      if (updateExistingInput) updateExistingInput.value = 'false';
      if (existingIdInput) existingIdInput.value = '';
      if (btnPrintDirect) btnPrintDirect.style.display = 'none';
      if (btn) btn.textContent = 'Generate & Issue Letter';
      if (title) title.textContent = 'Issue Accomplishment Letter & Certificate';

      // Set clean defaults for new certificate
      if (document.getElementById('letter-guardian-name')) document.getElementById('letter-guardian-name').value = '';
      if (document.getElementById('letter-cnic-no')) document.getElementById('letter-cnic-no').value = '';
      if (document.getElementById('letter-duration')) document.getElementById('letter-duration').value = 'TWO Months';
      if (document.getElementById('letter-projects')) document.getElementById('letter-projects').value = 'Frontend & Backend: Tailwind CSS, JavaScript, Bootstrap, React.js, Next .js, Node. js ,';
      if (document.getElementById('letter-org-name')) document.getElementById('letter-org-name').value = 'DevWork Studio';
      if (document.getElementById('letter-sub-title')) document.getElementById('letter-sub-title').value = 'Software Engineering Skill Development Platform';
      if (document.getElementById('letter-auth-by')) document.getElementById('letter-auth-by').value = 'DevWork Studio';
      if (document.getElementById('letter-signatory')) document.getElementById('letter-signatory').value = 'Admin Maheen';
      if (document.getElementById('letter-show-stamp')) document.getElementById('letter-show-stamp').checked = true;
      if (document.getElementById('letter-issue-date')) document.getElementById('letter-issue-date').value = new Date().toISOString().split('T')[0];
    }
  } catch (err) {
    console.error('Error checking existing letter:', err);
  }
}

function reloadExistingLetterData() {
  if (currentInternExistingLetter) {
    const l = currentInternExistingLetter;
    if (l.start_date) document.getElementById('letter-start-date').value = l.start_date;
    if (l.completion_date) document.getElementById('letter-completion-date').value = l.completion_date;
    if (l.department) document.getElementById('letter-department').value = l.department;
    if (l.performance_rating) document.getElementById('letter-rating').value = l.performance_rating;
    if (l.remarks) document.getElementById('letter-remarks').value = l.remarks;
    if (document.getElementById('letter-guardian-name')) document.getElementById('letter-guardian-name').value = l.guardian_name || '';
    if (document.getElementById('letter-cnic-no')) document.getElementById('letter-cnic-no').value = l.cnic_no || '';
    if (document.getElementById('letter-duration')) document.getElementById('letter-duration').value = l.duration_text || 'TWO Months';
    if (document.getElementById('letter-projects')) document.getElementById('letter-projects').value = l.projects_detail || 'Frontend & Backend: Tailwind CSS, JavaScript, Bootstrap, React.js, Next .js, Node. js ,';
    if (document.getElementById('letter-org-name')) document.getElementById('letter-org-name').value = l.organization_name || 'DevWork Studio';
    if (document.getElementById('letter-sub-title')) document.getElementById('letter-sub-title').value = l.sub_title || 'Software Engineering Skill Development Platform';
    if (document.getElementById('letter-auth-by')) document.getElementById('letter-auth-by').value = l.authorized_by || 'DevWork Studio';
    if (document.getElementById('letter-signatory')) document.getElementById('letter-signatory').value = l.signatory_title || 'Admin Maheen';
    if (document.getElementById('letter-show-stamp')) document.getElementById('letter-show-stamp').checked = (l.show_stamp !== false);
    if (document.getElementById('letter-issue-date') && l.issue_date) document.getElementById('letter-issue-date').value = l.issue_date;
    showToast('Reset form to current issued certificate details.', 'info');
  }
}

function openCurrentExistingLetterPrint() {
  if (currentInternExistingLetter) {
    openPreviewCertificate(currentInternExistingLetter);
  } else {
    previewCurrentFormCertificate();
  }
}

function previewCurrentFormCertificate() {
  const sel = document.getElementById('letter-intern');
  const opt = sel ? sel.selectedOptions[0] : null;
  let internName = 'Selected Intern';
  if (opt && opt.value) {
    internName = opt.textContent.split('(')[0].trim();
  }

  const startDate = document.getElementById('letter-start-date').value || '2026-05-01';
  const completionDate = document.getElementById('letter-completion-date').value || '2026-07-01';
  const dept = document.getElementById('letter-department').value.trim() || 'WEB DEVELOPMENT';
  const remarks = document.getElementById('letter-remarks').value.trim();

  const tempLetter = {
    id: currentInternExistingLetter ? currentInternExistingLetter.id : 0,
    letter_number: currentInternExistingLetter ? currentInternExistingLetter.letter_number : 'BTC-2026-0001',
    intern_name: internName,
    guardian_name: document.getElementById('letter-guardian-name')?.value.trim() || '',
    cnic_no: document.getElementById('letter-cnic-no')?.value.trim() || '',
    organization_name: document.getElementById('letter-org-name')?.value.trim() || 'DevWork Studio',
    sub_title: document.getElementById('letter-sub-title')?.value.trim() || 'Software Engineering Skill Development Platform',
    department: dept,
    duration_text: document.getElementById('letter-duration')?.value.trim() || 'TWO Months',
    start_date: startDate,
    completion_date: completionDate,
    projects_detail: document.getElementById('letter-projects')?.value.trim() || 'Frontend & Backend: Tailwind CSS, JavaScript, Bootstrap, React.js, Next .js, Node. js ,',
    commendation_text: remarks || `We commend ${internName} for dedication, creativity, and technical acumen demonstrated throughout the program. We wish continued success in all future endeavors .`,
    authorized_by: document.getElementById('letter-auth-by')?.value.trim() || 'DevWork Studio',
    signatory_title: document.getElementById('letter-signatory')?.value.trim() || 'Admin Maheen',
    show_stamp: document.getElementById('letter-show-stamp')?.checked ?? true,
    issue_date: document.getElementById('letter-issue-date')?.value || new Date().toISOString().split('T')[0],
    title: 'Certificate of Completion'
  };

  openPreviewCertificate(tempLetter);
}

async function openEditLetterModal(letter) {
  await populateApprovedInternsDropdown('letter-intern', letter.intern_id, true);
  document.getElementById('form-issue-letter').reset();

  const sel = document.getElementById('letter-intern');
  if (sel) sel.value = letter.intern_id;

  document.getElementById('letter-start-date').value = letter.start_date || '';
  document.getElementById('letter-completion-date').value = letter.completion_date || '';
  document.getElementById('letter-department').value = letter.department || '';
  document.getElementById('letter-rating').value = letter.performance_rating || 'Outstanding';
  document.getElementById('letter-remarks').value = letter.remarks || '';

  // Dynamic certificate fields
  if (document.getElementById('letter-guardian-name')) document.getElementById('letter-guardian-name').value = letter.guardian_name || '';
  if (document.getElementById('letter-cnic-no')) document.getElementById('letter-cnic-no').value = letter.cnic_no || '';
  if (document.getElementById('letter-duration')) document.getElementById('letter-duration').value = letter.duration_text || 'TWO Months';
  if (document.getElementById('letter-projects')) document.getElementById('letter-projects').value = letter.projects_detail || 'Frontend & Backend: Tailwind CSS, JavaScript, Bootstrap, React.js, Next .js, Node. js ,';
  if (document.getElementById('letter-org-name')) document.getElementById('letter-org-name').value = letter.organization_name || 'DevWork Studio';
  if (document.getElementById('letter-sub-title')) document.getElementById('letter-sub-title').value = letter.sub_title || 'Software Engineering Skill Development Platform';
  if (document.getElementById('letter-auth-by')) document.getElementById('letter-auth-by').value = letter.authorized_by || 'DevWork Studio';
  if (document.getElementById('letter-signatory')) document.getElementById('letter-signatory').value = letter.signatory_title || 'Admin Maheen';
  if (document.getElementById('letter-show-stamp')) document.getElementById('letter-show-stamp').checked = (letter.show_stamp !== false);
  if (document.getElementById('letter-issue-date') && letter.issue_date) document.getElementById('letter-issue-date').value = letter.issue_date;

  const updateExistingInput = document.getElementById('letter-update-existing');
  if (updateExistingInput) updateExistingInput.value = 'true';
  const existingIdInput = document.getElementById('letter-existing-id');
  if (existingIdInput) existingIdInput.value = letter.id;

  const alertBox = document.getElementById('letter-existing-alert');
  if (alertBox) {
    alertBox.style.display = 'block';
    const codeSpan = document.getElementById('existing-letter-code');
    if (codeSpan) codeSpan.textContent = letter.letter_number;
  }

  const btnPrintDirect = document.getElementById('btn-print-existing-direct');
  if (btnPrintDirect) btnPrintDirect.style.display = 'inline-flex';

  const btn = document.getElementById('btn-submit-letter');
  if (btn) btn.textContent = '🔄 Update Existing Certificate';

  const title = document.getElementById('modal-letter-title');
  if (title) title.textContent = `Update Certificate (${letter.letter_number})`;

  currentInternExistingLetter = letter;
  openModal('modal-issue-letter');
}

function executeConfirmedLetterUpdate() {
  closeModal('modal-confirm-update-letter');
  const updateExistingInput = document.getElementById('letter-update-existing');
  if (updateExistingInput) updateExistingInput.value = 'true';
  const alertBox = document.getElementById('letter-existing-alert');
  if (alertBox) alertBox.style.display = 'block';
  const btn = document.getElementById('btn-submit-letter');
  if (btn) btn.textContent = '🔄 Update Existing Certificate';

  // Submit the form
  const form = document.getElementById('form-issue-letter');
  if (form) {
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    } else {
      form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
  }
}

async function handleIssueLetter(e) {
  e.preventDefault();
  const fileInput = document.getElementById('letter-document-file');
  const file = fileInput && fileInput.files ? fileInput.files[0] : null;

  const updateExisting = document.getElementById('letter-update-existing') ?
    document.getElementById('letter-update-existing').value === 'true' : false;

  const btn = document.getElementById('btn-submit-letter');
  btn.disabled = true;
  btn.textContent = updateExisting ? 'Updating Certificate...' : 'Generating & Uploading...';

  const recipientInternId = document.getElementById('letter-intern').value;
  const completionDateVal = document.getElementById('letter-completion-date').value;
  const autoCompleteChecked = document.getElementById('letter-auto-complete') ? document.getElementById('letter-auto-complete').checked : false;

  const guardianName = document.getElementById('letter-guardian-name')?.value.trim() || '';
  const cnicNo = document.getElementById('letter-cnic-no')?.value.trim() || '';
  const durationText = document.getElementById('letter-duration')?.value.trim() || 'TWO Months';
  const projectsDetail = document.getElementById('letter-projects')?.value.trim() || '';
  const orgName = document.getElementById('letter-org-name')?.value.trim() || 'DevWork Studio';
  const subTitle = document.getElementById('letter-sub-title')?.value.trim() || 'Software Engineering Skill Development Platform';
  const authBy = document.getElementById('letter-auth-by')?.value.trim() || 'DevWork Studio';
  const signatoryTitle = document.getElementById('letter-signatory')?.value.trim() || 'Admin Maheen';
  const showStamp = document.getElementById('letter-show-stamp')?.checked ?? true;
  const issueDateVal = document.getElementById('letter-issue-date')?.value || '';

  let res;
  if (file) {
    const formData = new FormData();
    formData.append('intern_id', recipientInternId);
    formData.append('start_date', document.getElementById('letter-start-date').value);
    formData.append('completion_date', completionDateVal);
    formData.append('department', document.getElementById('letter-department').value.trim());
    formData.append('performance_rating', document.getElementById('letter-rating').value);
    formData.append('remarks', document.getElementById('letter-remarks').value.trim());
    formData.append('guardian_name', guardianName);
    formData.append('cnic_no', cnicNo);
    formData.append('duration_text', durationText);
    formData.append('projects_detail', projectsDetail);
    formData.append('organization_name', orgName);
    formData.append('sub_title', subTitle);
    formData.append('authorized_by', authBy);
    formData.append('signatory_title', signatoryTitle);
    formData.append('show_stamp', showStamp ? 'true' : 'false');
    if (issueDateVal) formData.append('issue_date', issueDateVal);
    formData.append('update_existing', updateExisting ? 'true' : 'false');
    formData.append('letter_file', file);

    const headers = {};
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;
    try {
      const resp = await fetch('/api/letters', {
        method: 'POST',
        headers,
        body: formData
      });
      const data = await resp.json().catch(() => ({}));
      res = { ok: resp.ok, status: resp.status, data };
    } catch (err) {
      res = { ok: false, status: 0, data: { error: 'Network error submitting letter.' } };
    }
  } else {
    const payload = {
      intern_id: parseInt(recipientInternId),
      start_date: document.getElementById('letter-start-date').value,
      completion_date: completionDateVal,
      department: document.getElementById('letter-department').value.trim(),
      performance_rating: document.getElementById('letter-rating').value,
      remarks: document.getElementById('letter-remarks').value.trim(),
      guardian_name: guardianName,
      cnic_no: cnicNo,
      duration_text: durationText,
      projects_detail: projectsDetail,
      organization_name: orgName,
      sub_title: subTitle,
      authorized_by: authBy,
      signatory_title: signatoryTitle,
      show_stamp: showStamp,
      issue_date: issueDateVal,
      update_existing: updateExisting
    };
    res = await api('/api/letters', 'POST', payload);
  }

  btn.disabled = false;
  btn.textContent = updateExisting ? '🔄 Update Existing Certificate' : 'Generate & Issue Letter';

  // Handle 409 Conflict: Certificate already exists -> prompt confirmation modal
  if (res.status === 409 || (res.data && res.data.already_exists)) {
    const existData = res.data.existing_letter || {};
    const code = res.data.letter_number || existData.letter_number || 'BTC-2026-XXXX';
    const dept = existData.department || document.getElementById('letter-department').value;
    const dateIssued = existData.issue_date || 'Previously';

    const msgElem = document.getElementById('confirm-update-letter-msg');
    if (msgElem) {
      msgElem.innerHTML = `A completion certificate (<strong style="font-family:monospace; color:var(--primary);">${escapeHtml(code)}</strong>) has already been issued for this intern.<br><br><strong>Do you want to update it?</strong> Updating will modify the existing certificate without creating a duplicate.`;
    }
    const codeElem = document.getElementById('confirm-update-letter-code');
    if (codeElem) codeElem.textContent = code;
    const deptElem = document.getElementById('confirm-update-letter-dept');
    if (deptElem) deptElem.textContent = dept;
    const dateElem = document.getElementById('confirm-update-letter-date');
    if (dateElem) dateElem.textContent = dateIssued;

    // Show alert in the form as well
    const alertBox = document.getElementById('letter-existing-alert');
    if (alertBox) {
      alertBox.style.display = 'block';
      const codeSpan = document.getElementById('existing-letter-code');
      if (codeSpan) codeSpan.textContent = code;
    }
    const updateInput = document.getElementById('letter-update-existing');
    if (updateInput) updateInput.value = 'true';

    openModal('modal-confirm-update-letter');
    return;
  }

  if (res.ok) {
    if (autoCompleteChecked && recipientInternId) {
      await api(`/api/interns/${recipientInternId}/complete`, 'PATCH', {
        completion_date: completionDateVal,
        notes: `Graduated automatically upon issuance of credential ${res.data.letter.letter_number}`
      });
    }

    const isUpdated = res.data.updated || updateExisting;
    const letterCode = res.data.letter ? res.data.letter.letter_number : '';
    showToast(isUpdated ? `Certificate ${letterCode} updated successfully!` : `Internship Letter ${letterCode} issued!`, 'success');
    closeModal('modal-issue-letter');
    document.getElementById('form-issue-letter').reset();
    const updateExistingInput = document.getElementById('letter-update-existing');
    if (updateExistingInput) updateExistingInput.value = 'false';
    const alertBox = document.getElementById('letter-existing-alert');
    if (alertBox) alertBox.style.display = 'none';

    loadAdminLetters();
    loadAdminOverview();
    loadInterns();
    if (res.data.letter) {
      openPreviewCertificate(res.data.letter);
    }
  } else {
    showToast(res.data.error || 'Failed to issue letter.', 'error');
  }
}

let reqSeqLetters = 0;
async function loadAdminLetters() {
  const thisSeq = ++reqSeqLetters;
  const tbody = document.getElementById('tbody-admin-letters');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 2rem;"><div class="spinner-small" style="margin: 0 auto 0.5rem auto;"></div>Loading letters...</td></tr>';

  const res = await api('/api/letters');
  if (thisSeq !== reqSeqLetters) return; // Discard stale response
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--danger);">${res.data.error}</td></tr>`;
    return;
  }

  const letters = res.data.letters;
  if (letters.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">No letters issued yet. Click "Generate New Letter" to confer credentials.</td></tr>';
    return;
  }

  tbody.innerHTML = letters.map(l => {
    return `
      <tr>
        <td>
          <span style="font-family:monospace; font-weight:700; color:var(--primary);">${l.letter_number}</span>
        </td>
        <td>
          <div style="font-weight:700; color:var(--text-main);">${escapeHtml(l.intern_name)}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(l.intern_university || 'Academy')}</div>
        </td>
        <td>${escapeHtml(l.department)}</td>
        <td style="font-size:0.85rem;">${l.start_date} → ${l.completion_date}</td>
        <td><span class="badge badge-completed">★ ${escapeHtml(l.performance_rating)}</span></td>
        <td>${l.issue_date}</td>
        <td style="text-align: right; white-space: nowrap;">
          <div style="display:inline-flex; gap:0.35rem; align-items:center; justify-content:flex-end;">
            <button class="btn btn-secondary btn-xs" onclick='openPreviewCertificate(${JSON.stringify(l).replace(/'/g, "&apos;")})'>
              👁️ View
            </button>
            <button class="btn btn-secondary btn-xs" onclick='openEditLetterModal(${JSON.stringify(l).replace(/'/g, "&apos;")})' title="Edit or update this certificate">
              ✏️ Edit
            </button>
            <a href="/certificate/${l.letter_number}" target="_blank" class="btn btn-primary btn-xs">
              🖨️ Print
            </a>
            ${l.document_filename ? `
              <a href="/api/letters/${l.id}/download" class="btn btn-secondary btn-xs" download="${escapeHtml(l.document_filename)}" title="Download attached PDF/Word file: ${escapeHtml(l.document_filename)}">
                📄 Doc
              </a>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

let currentActivePreviewLetter = null;

function formatCertDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
    if (isNaN(d.getTime())) return dateStr;
    const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
    const day = d.getDate();
    let suffix = 'TH';
    if (day % 10 === 1 && day !== 11) suffix = 'ST';
    else if (day % 10 === 2 && day !== 12) suffix = 'ND';
    else if (day % 10 === 3 && day !== 13) suffix = 'RD';
    return `${months[d.getMonth()]} ${day}${suffix}, ${d.getFullYear()}`;
  } catch (e) {
    return dateStr;
  }
}

function formatCertIssueDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
    if (isNaN(d.getTime())) return dateStr;
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const day = String(d.getDate()).padStart(2, '0');
    return `${day}-${months[d.getMonth()]}-${d.getFullYear()}`;
  } catch (e) {
    return dateStr;
  }
}

function openPreviewCertificate(letter) {
  currentActivePreviewLetter = letter;
  const container = document.getElementById('certificate-preview-content');
  const orgName = escapeHtml(letter.organization_name || 'DevWork Studio');
  const subTitle = escapeHtml(letter.sub_title || 'Software Engineering Skill Development Platform');
  const internName = escapeHtml(letter.intern_name || 'Intern');
  const duration = escapeHtml(letter.duration_text || 'TWO Months');
  let rawTrack = (letter.department || '').trim();
  let trackTitle = 'DEVWORK STUDIO INTERNSHIP PROGRAM';
  if (rawTrack && !rawTrack.toLowerCase().includes('full stack') && !rawTrack.toLowerCase().includes('devwork studio')) {
    trackTitle = rawTrack.toUpperCase().includes('INTERNSHIP PROGRAM') ? rawTrack.toUpperCase() : `${rawTrack.toUpperCase()} INTERNSHIP PROGRAM`;
  }
  const track = escapeHtml(trackTitle);
  const projects = escapeHtml(letter.projects_detail || 'Frontend & Backend: Tailwind CSS, JavaScript, Bootstrap, React.js, Next .js, Node. js ,');
  const commendation = escapeHtml(letter.commendation_text || `We commend ${internName} for dedication, creativity, and technical acumen demonstrated throughout the program. We wish continued success in all future endeavors .`);
  const authBy = escapeHtml(letter.authorized_by || 'DevWork Studio');
  const signatory = escapeHtml(letter.signatory_title || 'Admin Maheen');
  const showStamp = (letter.show_stamp !== false);

  container.innerHTML = `
    <div id="modal-cert-sheet" style="background:#ffffff; color:#1e293b; padding:0; border-radius:6px; max-width:800px; margin:0 auto; position:relative; overflow:hidden; font-family:'Plus Jakarta Sans', -apple-system, sans-serif; box-shadow:0 16px 40px rgba(0,0,0,0.35); border:1px solid #cbd5e1;">
      <!-- Exact Top Header Geometry Vector -->
      <svg style="position:absolute; top:0; left:0; width:100%; height:190px; pointer-events:none; z-index:1;" viewBox="0 0 860 220" fill="none" preserveAspectRatio="none">
        <path d="M335 0H860V44H379L335 0Z" fill="#111c2e" />
        <path d="M272 0H327L371 44H490V50H365L321 0H272Z" fill="#22c55e" />
        <path d="M0 48L82 160L0 240V48Z" fill="#111c2e" />
        <path d="M0 165L88 178L0 360V165Z" fill="#22c55e" />
      </svg>

      <!-- Central Security Watermark -->
      <img src="${letter.custom_logo_url || '/static/img/devwork_logo_transparent.png'}" style="position:absolute; top:50%; left:calc(50% + 20px); transform:translate(-50%, -50%); width:380px; height:380px; opacity:0.035; pointer-events:none; z-index:1; object-fit:contain;" alt="Watermark">

      <div style="position:relative; z-index:5; padding:0 34px 18px 34px;">
        <!-- Header: DevWork Studio Branding + Right Serial & Barcode Box -->
        <div style="display:flex; justify-content:space-between; align-items:center; height:150px; padding-top:28px; margin-bottom:12px;">
          <div style="display:flex; align-items:center; gap:0.85rem; padding-left:45px;">
            <div style="display:flex; align-items:center; justify-content:center;">
              <img src="${letter.custom_logo_url || '/static/img/devwork_logo_transparent.png'}" style="width:58px; height:58px; object-fit:contain;" alt="DevWork Studio Logo">
            </div>
            <div>
              <h2 style="font-size:1.60rem; font-weight:800; color:#0b1528; margin:0; line-height:1.15; letter-spacing:-0.5px;">${orgName}</h2>
              <div style="font-size:0.78rem; color:#475569; margin-top:2px;">${subTitle}</div>
            </div>
          </div>

          <!-- Right Security Box -->
          <div style="position:relative; width:270px; background:#f8fafc; border:1px solid #e2e8f0; border-bottom:3.5px solid #22c55e; clip-path:polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 0 100%); padding:10px 14px 8px 14px; display:flex; flex-direction:column; align-items:center; justify-content:center; box-shadow:0 2px 8px rgba(15, 23, 42, 0.04);">
            <div style="display:flex; align-items:center; justify-content:center; gap:6px; margin-bottom:6px; width:100%;">
              <span style="font-size:0.58rem; font-weight:800; color:#64748b; letter-spacing:0.7px; text-transform:uppercase;">SERIAL NUMBER:</span>
              <span style="font-family:monospace; font-weight:800; font-size:0.88rem; color:#0b1528; letter-spacing:0.8px; background:#ffffff; padding:1px 6px; border-radius:4px; border:1px solid #cbd5e1; box-shadow:0 1px 3px rgba(0,0,0,0.05);">${escapeHtml(letter.letter_number)}</span>
            </div>
            <div style="width:100%; height:22px; display:flex; align-items:center; justify-content:center; overflow:hidden;">
              ${letter.barcode_svg ? letter.barcode_svg : `<div style="font-family:monospace; font-size:0.55rem; color:#64748b; letter-spacing:2px; font-weight:bold;">|||||| ||||| |||||||</div>`}
            </div>
          </div>
        </div>

        <!-- Center Title -->
        <div style="text-align:center; margin:1.2rem 0 1rem 0;">
          <h3 style="font-size:1.55rem; font-weight:800; color:#0f172a; margin:0; letter-spacing:-0.3px;">${escapeHtml(letter.title || 'Certificate of Completion')}</h3>
          <div style="width:70px; height:2.5px; background:linear-gradient(90deg, transparent, #c39a54, transparent); margin:4px auto 0 auto; border-radius:2px;"></div>
        </div>

        <!-- Body Section -->
        <div style="font-size:0.88rem; line-height:1.75; color:#1e293b; text-align:justify; margin-bottom:0.85rem;">
          <p style="margin-bottom:0.75rem;">
            This is to certify that <strong style="color:#0f172a; font-weight:700;">${internName}</strong>
            ${letter.guardian_name ? `Son of <strong style="color:#0f172a; font-weight:700;">${escapeHtml(letter.guardian_name)}</strong> ` : ''}
            ${letter.cnic_no ? `bearing CNIC No. <strong style="color:#0f172a; font-weight:700;">${escapeHtml(letter.cnic_no)}</strong> ` : ''}
            has successfully completed the <strong style="color:#0f172a; font-weight:700;">${track}</strong> organized by <strong style="color:#0f172a; font-weight:700;">${orgName}</strong>.
          </p>

          <p style="margin-bottom:0.75rem;">
            The internship spanned <strong style="color:#0f172a; font-weight:700;">${duration}</strong>, from <strong style="color:#0f172a; font-weight:700;">${formatCertDate(letter.start_date)}</strong>, to <strong style="color:#0f172a; font-weight:700;">${formatCertDate(letter.completion_date)}</strong>, during which<br>
            <strong style="color:#0f172a; font-weight:700;">${internName}</strong> worked on a distinctive project titled:
          </p>
        </div>

        <!-- Projects -->
        <div style="margin:0.85rem 0 1rem 0; background:#f8fafc; border:1px solid #e2e8f0; border-left:3px solid #16a34a; border-radius:5px; padding:10px 14px;">
          <div style="font-size:0.82rem; font-weight:800; color:#16a34a; text-transform:uppercase; margin-bottom:0.25rem; letter-spacing:0.6px; display:flex; align-items:center; gap:5px;">
            <span>🚀</span>
            <span>PROJECTS &amp; TECHNICAL DELIVERABLES</span>
          </div>
          <div style="font-size:0.84rem; font-weight:600; color:#1e293b; line-height:1.55; white-space:pre-wrap !important; word-break:break-word !important;">
            ${projects}
          </div>
        </div>

        <!-- Commendation -->
        <p style="font-size:0.85rem; line-height:1.7; color:#1e293b; margin-bottom:1.15rem; text-align:justify;">
          ${commendation}
        </p>

        <!-- Signatures & Authority Section -->
        <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:1.5rem; min-height:80px;">
          <div style="font-size:0.82rem; color:#0f172a; display:flex; flex-direction:column; gap:6px;">
            <div><span style="font-size:0.68rem; font-weight:800; color:#64748b; letter-spacing:0.6px; text-transform:uppercase;">DATE OF ISSUANCE:</span> <strong style="font-weight:700;">${formatCertIssueDate(letter.issue_date)}</strong></div>
            <div><span style="font-size:0.68rem; font-weight:800; color:#64748b; letter-spacing:0.6px; text-transform:uppercase;">AUTHORIZED ISSUER:</span> <strong style="font-weight:700;">${authBy}</strong></div>
          </div>

          ${showStamp ? `
            <div style="display:flex; flex-direction:column; align-items:center;">
              <img src="${letter.custom_stamp_url || '/static/img/fsz_official_stamp.png'}" style="width:105px; height:105px; object-fit:contain;" alt="Official Stamp">
              <div style="font-size:0.82rem; font-weight:700; color:#1f426e; margin-top:-4px;">${signatory}</div>
              <div style="font-size:0.68rem; font-weight:700; color:#1e40af; text-transform:uppercase; letter-spacing:0.5px;">Authorized Signatory</div>
            </div>
          ` : ''}
        </div>

      </div>

      <!-- Bottom Geometric Footer (Exact Vector) -->
      <div style="height:120px; width:100%; position:relative; z-index:10;">
        <svg style="position:absolute; bottom:0; left:0; width:100%; height:120px;" viewBox="0 0 860 150" fill="none" preserveAspectRatio="none">
          <path d="M0 78H420L452 46H860" stroke="#cbd5e1" stroke-width="1.8" fill="none" />
          <path d="M465 56H860V62H471L465 56Z" fill="#22c55e" />
          <path d="M410 150L475 68H860V150H410Z" fill="#111c2e" />
          <path d="M0 84H372L422 150H0V84Z" fill="#22c55e" />
          <path d="M310 150L352 84H364L322 150H310Z" fill="#ffffff" />
          <path d="M338 150L380 84H392L350 150H338Z" fill="#ffffff" />
          <path d="M366 150L408 84H420L378 150H366Z" fill="#ffffff" />
        </svg>
        <div style="position:absolute; bottom:14px; right:28px; display:flex; align-items:center; gap:8px; color:#ffffff; font-size:0.72rem; font-weight:800; letter-spacing:0.8px; text-transform:uppercase;">
          <span>POWERED BY FULL STACK ZONE (PVT) LTD.</span>
          <span style="width:16px; height:16px; background:#22c55e; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 0 6px rgba(34,197,94,0.6);">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          </span>
        </div>
      </div>

    </div>

    ${letter.document_filename ? `
      <div style="max-width:800px; margin:1rem auto 0 auto; padding:0.75rem 1rem; background:rgba(30, 41, 59, 0.95); border:1px solid rgba(255,255,255,0.12); border-radius:8px; font-size:0.85rem; display:flex; align-items:center; justify-content:space-between; gap:0.75rem;">
        <span style="color:#38bdf8;">📎 <strong>Attached Document:</strong> ${escapeHtml(letter.document_filename)}</span>
        <a href="/api/letters/${letter.id}/download" class="btn btn-success btn-xs" download="${escapeHtml(letter.document_filename)}">
          📥 Download Document
        </a>
      </div>
    ` : ''}
  `;

  const btnPrintPage = document.getElementById('btn-open-print-page');
  if (btnPrintPage) {
    if (letter.letter_number && !letter.letter_number.includes('PREVIEW')) {
      btnPrintPage.href = `/certificate/${letter.letter_number}`;
      btnPrintPage.style.display = 'inline-flex';
    } else {
      btnPrintPage.style.display = 'none';
    }
  }

  openModal('modal-preview-certificate');
}

function printModalCertificate() {
  if (currentActivePreviewLetter && currentActivePreviewLetter.letter_number && !currentActivePreviewLetter.letter_number.includes('PREVIEW')) {
    window.open(`/certificate/${currentActivePreviewLetter.letter_number}`, '_blank');
  } else {
    const sheet = document.getElementById('modal-cert-sheet');
    if (!sheet) return;
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Certificate - ${escapeHtml(currentActivePreviewLetter?.intern_name || 'DevWork Studio')}</title>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
        <style>
          @page { size: A4 portrait; margin: 0; }
          body { margin: 0; padding: 0; background: #fff; font-family: 'Plus Jakarta Sans', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          #modal-cert-sheet { width: 100% !important; min-height: 100vh !important; box-shadow: none !important; border-radius: 0 !important; }
        </style>
      </head>
      <body>
        ${sheet.outerHTML}
        <script>
          window.onload = function() { window.print(); }
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  }
}

function exportModalCertificatePDF() {
  const sheet = document.getElementById('modal-cert-sheet');
  if (!sheet) return;
  const btn = document.getElementById('btn-modal-export-pdf');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Generating PDF...';
  }
  const filename = `${(currentActivePreviewLetter?.letter_number || 'DevWork_Studio_Certificate')}.pdf`;
  const opt = {
    margin: 0,
    filename: filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };
  if (typeof html2pdf !== 'undefined') {
    html2pdf().set(opt).from(sheet).save().then(() => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '📥 Export to PDF';
      }
    }).catch(err => {
      console.error('PDF export error:', err);
      if (btn) {
        btn.disabled = false;
        btn.textContent = '📥 Export to PDF';
      }
      showToast('PDF generation encountered an error. You can use Print to PDF.', 'error');
    });
  } else {
    window.print();
    if (btn) {
      btn.disabled = false;
      btn.textContent = '📥 Export to PDF';
    }
  }
}

// ----------------- Attendance (Admin) -----------------

let reqSeqAttendance = 0;

function renderAdminAttendanceRows(records) {
  const tbody = document.getElementById('tbody-admin-attendance');
  if (!tbody) return;
  if (!records || records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:3.5rem 1rem; color:var(--text-muted);"><div style="font-size:2.2rem; margin-bottom:0.5rem; opacity:0.85;">📋</div><div style="font-weight:700; color:var(--text-main); font-size:1.05rem;">No Attendance Records Found</div><div style="font-size:0.85rem; color:var(--text-secondary); margin-top:0.35rem;">No attendance logs have been recorded for the selected criteria.</div></td></tr>';
    return;
  }

  tbody.innerHTML = records.map(r => {
    const isMissedPunch = !!r.is_missed_punch || r.check_out === 'Missed Out Punch';
    const isCompleted = !!r.check_out && !isMissedPunch;

    let checkoutHtml = '';
    let statusBadge = '';
    let hoursHtml = '';

    if (isMissedPunch) {
      checkoutHtml = '<span class="badge" style="background:#fee2e2; color:#b91c1c; font-weight:700; border:1px solid #fca5a5; display:inline-flex; align-items:center; gap:0.25rem;">⚠️ Missed Out Punch</span>';
      statusBadge = '<span class="badge badge-rejected" style="background:#fef2f2; color:#991b1b; border:1px solid #fecaca; font-weight:700;">Missed Punch</span>';
      hoursHtml = '<span style="color:#b91c1c; font-weight:600;">0.0 hrs</span>';
    } else if (isCompleted) {
      checkoutHtml = `<span style="font-family:monospace; font-weight:600; color:#4f46e5;">${escapeHtml(r.check_out)}</span>`;
      statusBadge = `<span class="badge ${r.status === 'late' ? 'badge-rejected' : 'badge-approved'}">${escapeHtml(r.status)}</span>`;
      hoursHtml = `<strong style="color:var(--text-main);">${r.total_hours !== null && r.total_hours !== undefined ? r.total_hours : 0}</strong> hrs`;
    } else {
      checkoutHtml = '<span class="badge" style="background:rgba(16,185,129,0.12); color:#059669; font-weight:700;">🟢 Active Shift</span>';
      statusBadge = `<span class="badge ${r.status === 'late' ? 'badge-rejected' : 'badge-approved'}">${escapeHtml(r.status)}</span>`;
      hoursHtml = '<span style="color:var(--text-muted);">In progress</span>';
    }

    return `
      <tr>
        <td style="font-weight:700; color:var(--text-main); font-family:monospace;">
          ${r.date} ${r.day_name ? `<span style="font-size:0.75rem; color:var(--text-muted); font-weight:normal;">(${r.day_name.slice(0,3)})</span>` : ''}
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:0.4rem; justify-content:space-between;">
            <div style="font-weight:700; color:var(--text-main); font-size:0.92rem;">${escapeHtml(r.intern_name)}</div>
            <button type="button" class="btn btn-outline-secondary btn-xs" onclick="filterAttendanceBySpecificIntern(${r.intern_id}, '${escapeHtml(r.intern_name).replace(/'/g, "\\'")}')" style="font-size:0.68rem; padding:1px 6px; opacity:0.85;" title="View all attendance records for ${escapeHtml(r.intern_name)}">
              🔍 Filter
            </button>
          </div>
          <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">${escapeHtml(r.intern_email)}</div>
        </td>
        <td>
          <span style="font-family:monospace; font-weight:600; color:#059669;">${r.check_in || '—'}</span>
        </td>
        <td>${checkoutHtml}</td>
        <td>${hoursHtml}</td>
        <td>${statusBadge}</td>
        <td style="font-size:0.85rem; color:var(--text-secondary); max-width:240px;">
          ${r.notes ? escapeHtml(r.notes) : (isMissedPunch ? '<span style="color:#b91c1c; font-size:0.78rem;">Auto-marked: Missed out punch (Shift ended after 10:00 PM PKT)</span>' : '<span style="color:var(--text-muted); font-size:0.8rem;">—</span>')}
        </td>
      </tr>
    `;
  }).join('');
}

function updateAdminAttendanceKPIs(records) {
  const totalEl = document.getElementById('admin-att-total-count');
  const activeEl = document.getElementById('admin-att-active-count');
  const completedEl = document.getElementById('admin-att-completed-count');
  const missedEl = document.getElementById('admin-att-missed-count');
  const hoursEl = document.getElementById('admin-att-hours-count');

  if (!records) records = [];
  const total = records.length;
  const missed = records.filter(r => !!r.is_missed_punch || r.check_out === 'Missed Out Punch').length;
  const active = records.filter(r => !r.is_missed_punch && r.check_out !== 'Missed Out Punch' && !r.check_out_raw).length;
  const completed = records.filter(r => !r.is_missed_punch && r.check_out !== 'Missed Out Punch' && !!r.check_out_raw).length;
  const hours = records.reduce((acc, r) => acc + (parseFloat(r.total_hours) || 0), 0);

  if (totalEl) totalEl.textContent = total;
  if (activeEl) activeEl.textContent = active;
  if (completedEl) completedEl.textContent = completed;
  if (missedEl) missedEl.textContent = missed;
  if (hoursEl) hoursEl.textContent = `${hours.toFixed(1)} hrs`;
}

function populateAttendanceInternFilter() {
  try {
    const select = document.getElementById('filter-attendance-intern');
    if (!select) return;

    const currentVal = select.value;
    const internsMap = new Map();

    // Aggregate interns from current attendance cache
    if (Array.isArray(adminAttendanceCache)) {
      adminAttendanceCache.forEach(r => {
        if (r.intern_id && !internsMap.has(r.intern_id)) {
          internsMap.set(r.intern_id, { id: r.intern_id, name: r.intern_name, email: r.intern_email });
        }
      });
    }

    // Also include any other interns from general intern cache
    if (Array.isArray(adminInternsCache)) {
      adminInternsCache.forEach(i => {
        if (i.id && !internsMap.has(i.id)) {
          internsMap.set(i.id, { id: i.id, name: i.full_name, email: i.email });
        }
      });
    }

    const sortedInterns = Array.from(internsMap.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    select.innerHTML = '<option value="">👥 All Interns</option>' +
      sortedInterns.map(i => `<option value="${i.id}">${escapeHtml(i.name)} (${escapeHtml(i.email)})</option>`).join('');

    if (currentVal && internsMap.has(parseInt(currentVal, 10))) {
      select.value = currentVal;
    }
  } catch (err) {
    console.error('Error populating attendance intern filter:', err);
  }
}

function filterAdminAttendanceTable() {
  const searchInput = document.getElementById('filter-attendance-search');
  const internSelect = document.getElementById('filter-attendance-intern');
  const query = (searchInput?.value || '').toLowerCase().trim();
  const selectedInternId = internSelect?.value ? parseInt(internSelect.value, 10) : null;

  let filtered = adminAttendanceCache;
  if (selectedInternId) {
    filtered = filtered.filter(r => r.intern_id === selectedInternId);
  }
  if (query) {
    filtered = filtered.filter(r => {
      const name = (r.intern_name || '').toLowerCase();
      const email = (r.intern_email || '').toLowerCase();
      const notes = (r.notes || '').toLowerCase();
      return name.includes(query) || email.includes(query) || notes.includes(query);
    });
  }

  // Dynamically update KPIs for this specific intern or search query
  updateAdminAttendanceKPIs(filtered);
  renderAdminAttendanceRows(filtered);
}

function filterAttendanceBySpecificIntern(internId, internName) {
  const select = document.getElementById('filter-attendance-intern');
  if (select) {
    select.value = internId;
  }
  const search = document.getElementById('filter-attendance-search');
  if (search) search.value = '';
  filterAdminAttendanceTable();
}

function jumpToInternAttendance(internId, internName) {
  switchAdminTab('attendance');
  setTimeout(() => {
    filterAttendanceBySpecificIntern(internId, internName);
  }, 100);
}

function resetAdminAttendanceFilters() {
  const dateInput = document.getElementById('filter-attendance-date');
  const searchInput = document.getElementById('filter-attendance-search');
  const internSelect = document.getElementById('filter-attendance-intern');
  if (dateInput) dateInput.value = '';
  if (searchInput) searchInput.value = '';
  if (internSelect) internSelect.value = '';
  loadAdminAttendance();
}

async function loadAdminAttendance() {
  const thisSeq = ++reqSeqAttendance;
  const dateFilter = document.getElementById('filter-attendance-date')?.value || '';
  const tbody = document.getElementById('tbody-admin-attendance');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 2rem;"><div class="spinner-small" style="margin: 0 auto 0.5rem auto;"></div>Loading attendance logs...</td></tr>';
  }

  let url = '/api/attendance/all';
  if (dateFilter) url += `?date=${encodeURIComponent(dateFilter)}`;

  try {
    const res = await api(url);
    if (thisSeq !== reqSeqAttendance) return; // Discard stale response
    if (!res.ok) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--danger);">${res.data.error || 'Failed to load attendance'}</td></tr>`;
      return;
    }

    const records = res.data.records || [];
    adminAttendanceCache = records;
    populateAttendanceInternFilter();
    updateAdminAttendanceKPIs(records);
    filterAdminAttendanceTable();
  } catch (err) {
    console.error('Failed to load admin attendance:', err);
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--danger);">Error loading attendance logs.</td></tr>';
  }
}

// ----------------- Messages (Admin) -----------------

let reqSeqMessages = 0;
async function loadAdminMessages() {
  const thisSeq = ++reqSeqMessages;
  const container = document.getElementById('admin-messages-list');
  container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:2rem;"><div class="spinner-small" style="margin: 0 auto 0.5rem auto;"></div>Loading inquiries...</div>';

  const res = await api('/api/messages');
  if (thisSeq !== reqSeqMessages) return; // Discard stale response
  if (!res.ok) {
    container.innerHTML = `<div style="text-align:center;color:var(--danger); padding:2rem;">${escapeHtml(res.data.error)}</div>`;
    return;
  }

  const messages = res.data.messages || [];
  adminMessagesCache = messages;

  // Real-time synchronization of unanswered inquiries count and tab badge
  const unanswered = messages.filter(m => {
    const hasAdminReply = (m.replies || []).some(r => r.sender_role === 'admin' || r.sender_role === 'super_admin');
    return !hasAdminReply;
  });
  const unansweredCount = unanswered.length;

  const metricElem = document.getElementById('metric-unanswered-messages');
  if (metricElem) {
    metricElem.textContent = unansweredCount;
    metricElem.style.color = unansweredCount > 0 ? '#0284c7' : 'var(--text-muted)';
  }

  const subElem = document.getElementById('metric-messages-sub');
  if (subElem) {
    if (unansweredCount === 0) {
      subElem.textContent = 'All inquiries answered';
      subElem.style.color = 'var(--text-muted)';
    } else if (unansweredCount === 1) {
      subElem.textContent = '1 inquiry awaiting reply';
      subElem.style.color = '#0284c7';
    } else {
      subElem.textContent = `${unansweredCount} inquiries awaiting reply`;
      subElem.style.color = '#0284c7';
    }
  }

  const badgeElem = document.getElementById('badge-admin-messages');
  if (badgeElem) {
    if (unansweredCount > 0) {
      badgeElem.textContent = unansweredCount;
      badgeElem.style.display = 'inline-flex';
    } else {
      badgeElem.style.display = 'none';
    }
  }

  if (messages.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:3rem;">No messages received from interns.</div>';
    return;
  }

  container.innerHTML = messages.map(msg => {
    const repliesHtml = (msg.replies || []).map(rep => {
      const isAdminReply = rep.sender_role === 'admin' || rep.sender_role === 'super_admin';
      return `
        <div class="reply-item" style="${isAdminReply ? 'border-left: 3px solid #4f46e5; background: #f5f3ff;' : 'border-left: 3px solid #0284c7; background: #f0f9ff;'} padding: 0.75rem 1rem; border-radius: 6px; margin-top: 0.5rem;">
          <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:0.35rem;">
            <div>
              <strong style="color: ${isAdminReply ? '#4f46e5' : '#0284c7'};">${isAdminReply ? '🛡️ Administrator:' : '👤 Intern:'} ${escapeHtml(rep.sender_name)}</strong>
              <span class="badge ${isAdminReply ? 'badge-admin' : 'badge-intern'}" style="margin-left: 0.4rem; font-size: 0.7rem;">${rep.sender_role}</span>
            </div>
            <span style="color:var(--text-muted);">${rep.created_at ? rep.created_at.slice(0, 16).replace('T', ' ') : ''}</span>
          </div>
          <div style="font-size: 0.9rem; color: var(--text-main); white-space: pre-wrap;">${escapeHtml(rep.body)}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="message-item" style="background: #ffffff; border: 1px solid var(--border-subtle); border-radius: 12px; padding: 1.25rem; margin-bottom: 1rem; box-shadow: var(--shadow-sm);">
        <div class="message-meta" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
          <div class="message-sender" style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <span style="font-weight: 700; color: var(--text-main); font-size: 1rem;">👤 ${escapeHtml(msg.sender_name)}</span>
            <span style="font-size: 0.8rem; color: var(--text-muted);">(${escapeHtml(msg.sender_email || 'No email')})</span>
            <span class="badge badge-intern">Intern</span>
            <span class="badge badge-${msg.priority}">${msg.priority.toUpperCase()}</span>
          </div>
          <div style="font-size:0.8rem; color:var(--text-muted);">
            🕒 ${msg.created_at ? msg.created_at.slice(0, 16).replace('T', ' ') : ''}
          </div>
        </div>
        <div style="font-size:1.1rem; font-weight:700; color:var(--text-main); margin-bottom:0.5rem;">
          ${escapeHtml(msg.subject)}
        </div>
        <div class="message-body" style="font-size: 0.95rem; line-height: 1.5; color: var(--text-secondary); background: #f8fafc; padding: 0.85rem; border-radius: 8px; border: 1px solid var(--border-subtle); white-space: pre-wrap;">${escapeHtml(msg.body)}</div>

        ${repliesHtml ? `
          <div class="replies-thread" style="margin-top: 1rem; border-top: 1px dashed var(--border-subtle); padding-top: 0.75rem;">
            <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.5rem;">Conversation Thread & Replies:</div>
            ${repliesHtml}
          </div>
        ` : ''}

        <div style="margin-top:1.25rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
          <div style="font-size:0.8rem; color:var(--text-muted);">
            ${msg.replies && msg.replies.length > 0 ? `💬 ${msg.replies.length} response(s) logged` : '<span style="color:var(--warning);">⏳ Awaiting administrative response</span>'}
          </div>
          <button class="btn btn-primary btn-sm" onclick="openAdminReplyModal(${msg.id})">
            ↩️ Reply to ${escapeHtml(msg.sender_name)}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function openAdminReplyModal(msgId) {
  const msg = adminMessagesCache.find(m => m.id === msgId);
  if (!msg) return;

  document.getElementById('reply-message-id').value = msg.id;
  document.getElementById('reply-modal-title').textContent = `Reply to ${msg.sender_name}`;
  document.getElementById('reply-thread-sender').textContent = `From Intern: ${msg.sender_name} (${msg.sender_email || 'Intern'})`;
  document.getElementById('reply-thread-date').textContent = msg.created_at ? msg.created_at.slice(0, 16).replace('T', ' ') : '';
  document.getElementById('reply-thread-subject').textContent = msg.subject;
  document.getElementById('reply-thread-body').textContent = msg.body;
  document.getElementById('reply-modal-label').textContent = 'Administrative Response *';
  document.getElementById('reply-body').value = '';
  document.getElementById('reply-body').placeholder = `Type your official administrative response to ${msg.sender_name}...`;
  document.getElementById('btn-submit-reply').textContent = '📨 Send Administrative Response';
  openModal('modal-reply-message');
}

async function handleConfirmReply(e) {
  e.preventDefault();
  const msgId = document.getElementById('reply-message-id').value;
  const body = document.getElementById('reply-body').value.trim();

  const btn = document.getElementById('btn-submit-reply');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  const res = await api(`/api/messages/${msgId}/reply`, 'POST', { body });
  btn.disabled = false;
  btn.textContent = '📨 Send Response';
  closeModal('modal-reply-message');

  if (res.ok) {
    showToast('Reply dispatched successfully.', 'success');
    if (currentUser && currentUser.role === 'intern') {
      loadInternMessages();
    } else {
      loadAdminMessages();
      loadAdminOverview();
    }
  } else {
    showToast(res.data.error || 'Failed to send reply.', 'error');
  }
}

// ----------------- Super Admin Governance -----------------

function openCreateAdminModal() {
  document.getElementById('form-create-admin').reset();
  openModal('modal-create-admin');
}

async function handleCreateAdmin(e) {
  e.preventDefault();
  const payload = {
    full_name: document.getElementById('newadmin-fullname').value.trim(),
    email: document.getElementById('newadmin-email').value.trim(),
    password: document.getElementById('newadmin-password').value,
    phone: document.getElementById('newadmin-phone').value.trim(),
    department: document.getElementById('newadmin-department').value.trim()
  };

  const btn = document.getElementById('btn-submit-newadmin');
  btn.disabled = true;
  btn.textContent = 'Provisioning...';

  const res = await api('/api/auth/create-admin', 'POST', payload);
  btn.disabled = false;
  btn.textContent = 'Establish Administrator';

  if (res.ok) {
    showToast(res.data.message || `Administrator account request created! Another administrator must review and approve it from Pending Approvals.`, 'success');
    closeModal('modal-create-admin');
    loadAdminOverview();
    loadInterns();
    loadSuperAdminAdmins();
  } else {
    showToast(res.data.error || 'Failed to provision admin.', 'error');
  }
}

let reqSeqAdmins = 0;
async function loadSuperAdminAdmins() {
  const thisSeq = ++reqSeqAdmins;
  const tbody = document.getElementById('tbody-super-admins');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem;"><div class="spinner-small" style="margin: 0 auto 0.5rem auto;"></div>Loading sub-administrators...</td></tr>';

  const res = await api('/api/auth/admins');
  if (thisSeq !== reqSeqAdmins) return; // Discard stale response
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--danger);">${res.data.error}</td></tr>`;
    return;
  }

  // Filter strictly sub-admins (role == 'admin') - User requirement: "as section ka andr bas sub admins dikhana chiya"
  const admins = (res.data.admins || []).filter(a => a.role === 'admin');

  // Update badge count
  const badge = document.getElementById('badge-admin-count');
  if (badge) {
    badge.textContent = admins.length;
    badge.style.display = admins.length > 0 ? 'inline-block' : 'none';
  }

  if (admins.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding: 3rem 1rem;">
          <div style="font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.8;">🛡️</div>
          <div style="font-weight: 700; color: var(--text-main); font-size: 1rem;">No Sub-Administrators Registered</div>
          <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">
            Use the "👑 Provision New Admin" button above to create a subordinate administrator account.
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = admins.map(a => {
    const isPending = a.status === 'pending';
    const isRejected = a.status === 'rejected';
    const statusPill = isPending
      ? '<span class="badge badge-pending">⏳ Pending Approval</span>'
      : isRejected
      ? `<span class="badge badge-rejected"${a.rejection_reason ? ` title="Reason: ${escapeHtml(a.rejection_reason)}"` : ''}><span class="badge-dot dot-rejected"></span>Rejected</span>`
      : '<span class="badge badge-approved">Active</span>';

    let actionBtn = '';
    if (isPending) {
      actionBtn = `
        <div style="display:flex; justify-content:flex-end; gap:4px; flex-wrap:wrap;">
          <button type="button" class="btn btn-success btn-xs" onclick="approveIntern(${a.id}, '${escapeHtml(a.full_name)}')">
            ✓ Approve
          </button>
          <button type="button" class="btn btn-warning btn-xs" onclick="openRejectModal(${a.id}, '${escapeHtml(a.full_name)}')">
            ✕ Reject
          </button>
          <button type="button" class="btn btn-danger btn-xs" onclick="deleteAdminAccount(${a.id}, '${escapeHtml(a.full_name)}')">
            🗑️ Delete
          </button>
        </div>
      `;
    } else if (isRejected) {
      actionBtn = `
        <div style="display:flex; justify-content:flex-end; gap:4px; flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary btn-xs" onclick="approveIntern(${a.id}, '${escapeHtml(a.full_name)}')">
            ✓ Re-Approve
          </button>
          <button type="button" class="btn btn-danger btn-xs" onclick="deleteAdminAccount(${a.id}, '${escapeHtml(a.full_name)}')">
            🗑️ Delete
          </button>
        </div>
      `;
    } else {
      actionBtn = `
        <button type="button" class="btn btn-danger btn-xs" onclick="deleteAdminAccount(${a.id}, '${escapeHtml(a.full_name)}')" title="Permanently delete administrator account">
          🗑️ Delete Admin
        </button>
      `;
    }

    return `
      <tr>
        <td>
          <div style="font-weight:700; color:var(--text-main);">${escapeHtml(a.full_name)}</div>
          <div style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(a.email)}</div>
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span class="badge badge-admin">Sub-Admin</span>
            ${statusPill}
          </div>
        </td>
        <td>${escapeHtml(a.department || 'Administration')}</td>
        <td>${escapeHtml(a.phone || '—')}</td>
        <td>${a.created_at ? a.created_at.slice(0, 10) : '—'}</td>
        <td style="text-align: right; white-space: nowrap;">
          ${actionBtn}
        </td>
      </tr>
    `;
  }).join('');
}

async function deleteAdminAccount(adminId, adminName) {
  if (!confirm(`Are you sure you want to permanently delete administrator account "${adminName}"? Any tasks created by them will be safely transferred to your Super Admin account.`)) return;

  const res = await api(`/api/auth/admins/${adminId}`, 'DELETE');
  if (res.ok) {
    showToast(`Administrator "${adminName}" deleted successfully.`, 'info');
    loadSuperAdminAdmins();
    loadAdminOverview();
  } else {
    showToast(res.data.error || 'Failed to delete administrator account.', 'error');
  }
}

async function deleteRejectedUser(userId, userName, role) {
  const isAdm = role === 'admin';
  const label = isAdm ? 'administrator application' : 'intern record';
  if (!confirm(`Are you sure you want to permanently delete the rejected ${label} for "${userName}"? This record will be completely removed.`)) return;

  const endpoint = isAdm ? `/api/auth/admins/${userId}` : `/api/interns/${userId}`;
  const res = await api(endpoint, 'DELETE');
  if (res.ok) {
    showToast(`Rejected ${label} for "${userName}" deleted successfully.`, 'info');
    loadInterns();
    loadAdminOverview();
    if (typeof loadSuperAdminAdmins === 'function') {
      const superAdminTab = document.getElementById('tab-admin-super');
      if (superAdminTab && superAdminTab.classList.contains('active')) {
        loadSuperAdminAdmins();
      }
    }
  } else {
    showToast(res.data.error || 'Failed to delete rejected record.', 'error');
  }
}

async function deleteIntern(internId, internName) {
  if (!confirm(`Are you sure you want to permanently delete intern "${internName}"? All their assignments, tasks, and attendance records will be removed.`)) return;

  const res = await api(`/api/interns/${internId}`, 'DELETE');
  if (res.ok) {
    showToast(`Intern "${internName}" deleted successfully.`, 'info');
    loadInterns();
    loadAdminOverview();
    if (typeof loadSuperAdminAdmins === 'function') {
      const superAdminTab = document.getElementById('tab-admin-super');
      if (superAdminTab && superAdminTab.classList.contains('active')) {
        loadSuperAdminAdmins();
      }
    }
  } else {
    showToast(res.data.error || 'Failed to delete intern.', 'error');
  }
}

// ==================== INTERN DASHBOARD ====================

function initInternDashboard() {
  document.getElementById('intern-welcome-title').textContent = `Welcome, ${currentUser.full_name}`;
  const credId = currentUser.credential_id || ('BTC-2026-' + currentUser.id);
  document.getElementById('intern-subtitle').textContent = `Credential ID: ${credId} | Department: ${currentUser.department || 'General'} | Status: ${currentUser.status.toUpperCase()}`;

  loadInternOverview();
  switchInternTab('tasks');
}

function switchInternTab(tab) {
  const tabs = ['tasks', 'attendance', 'schedule', 'messages'];
  tabs.forEach(t => {
    const btn = document.getElementById(`tab-intern-${t}`);
    const panel = document.getElementById(`intern-panel-${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
  });

  if (tab === 'tasks') loadInternTasks();
  else if (tab === 'attendance') loadInternAttendance();
  else if (tab === 'schedule') loadInternSchedule();
  else if (tab === 'messages') loadInternMessages();
}

async function loadInternOverview() {
  const [attRes, tasksRes] = await Promise.all([
    api('/api/attendance/my'),
    api('/api/tasks')
  ]);

  // Attendance Widget
  if (attRes.ok) {
    const stats = attRes.data.stats;
    const today = attRes.data.today;

    document.getElementById('intern-metric-attendance').textContent = stats.total_days;
    document.getElementById('intern-metric-hours').textContent = `${stats.total_hours} hrs total`;

    const statusText = document.getElementById('attendance-status-text');
    const detailsText = document.getElementById('attendance-details-text');
    const btnCheckIn = document.getElementById('btn-checkin');
    const btnCheckOut = document.getElementById('btn-checkout');

    if (!stats.has_checked_in_today) {
      statusText.innerHTML = '<span style="color:#fbbf24;">Not Checked In Yet</span>';
      detailsText.textContent = "You haven't marked attendance for today yet. Click Check In below.";
      btnCheckIn.style.display = 'inline-flex';
      btnCheckOut.style.display = 'none';
    } else if (stats.has_checked_in_today && !stats.has_checked_out_today) {
      if (today && today.is_missed_punch) {
        statusText.innerHTML = `<span style="color:#ef4444;">⚠️ Missed Out Punch</span>`;
        detailsText.textContent = `Daily check-out auto-closed at 10:00 PM PKT.`;
        btnCheckIn.style.display = 'none';
        btnCheckOut.style.display = 'none';
      } else {
        statusText.innerHTML = `<span style="color:#34d399;">Active Shift</span> (In at ${today ? today.check_in : 'today'})`;
        detailsText.textContent = `Shift is currently active (${today ? today.status : 'present'}). Remember to check out before 10:00 PM PKT.`;
        btnCheckIn.style.display = 'none';
        btnCheckOut.style.display = 'inline-flex';
      }
    } else {
      statusText.innerHTML = `<span style="color:#60a5fa;">Shift Completed</span> (${today.total_hours || 0} hrs logged)`;
      detailsText.textContent = `Checked in at ${today.check_in}, checked out at ${today.check_out}.`;
      btnCheckIn.style.display = 'none';
      btnCheckOut.style.display = 'none';
    }
  }

  // Tasks Widget
  if (tasksRes.ok) {
    const tasks = tasksRes.data.tasks;
    const active = tasks.filter(t => t.status !== 'completed').length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    document.getElementById('intern-metric-tasks').textContent = active;
    document.getElementById('intern-metric-tasks-sub').textContent = `${completed} completed`;
  }
}

function getPakistanTimeSnapshot() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
  const dateStr = now.toLocaleDateString('en-US', {
    timeZone: 'Asia/Karachi',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  const dayName = now.toLocaleDateString('en-US', {
    timeZone: 'Asia/Karachi',
    weekday: 'long'
  });
  return { timeStr, dateStr, dayName };
}

function openAttendanceActionModal(type = 'checkin') {
  const modalTitle = document.getElementById('attendance-action-modal-title');
  const actionTypeInput = document.getElementById('attendance-action-type');
  const submitBtn = document.getElementById('btn-submit-attendance-action');
  const modeGroup = document.getElementById('group-attendance-status-choice');
  const noteLabel = document.getElementById('attendance-action-note-label');
  const noteInput = document.getElementById('attendance-action-note');
  const clockEl = document.getElementById('attendance-modal-clock');
  const dateEl = document.getElementById('attendance-modal-date');
  const leaveBanner = document.getElementById('attendance-modal-leave-banner');
  const leaveMsgEl = document.getElementById('attendance-modal-leave-msg');

  if (actionTypeInput) actionTypeInput.value = type;
  if (noteInput) noteInput.value = '';

  // Exact static snapshot in Pakistan Standard Time (PKT, UTC+5) - no live ticker counter
  const pkt = getPakistanTimeSnapshot();
  if (clockEl) clockEl.textContent = `${pkt.timeStr} PKT`;
  if (dateEl) dateEl.textContent = `${pkt.dateStr}`;

  // Scheduled Leave Check: whichever days are unselected in the intern's approved schedule are their leave days
  const userWorkingDays = (currentUser && currentUser.working_days && currentUser.working_days.length > 0)
    ? currentUser.working_days
    : [];
  const isLeaveDay = userWorkingDays.length > 0 && !userWorkingDays.includes(pkt.dayName);

  if (isLeaveDay) {
    if (leaveBanner) leaveBanner.style.display = 'block';
    if (leaveMsgEl) leaveMsgEl.textContent = `Today (${pkt.dayName}) is your scheduled leave day according to your weekly plan. Attendance check-in is not permitted.`;
    if (type === 'checkin' && submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = `🌴 ${pkt.dayName}: Scheduled Leave (Check-in Disabled)`;
      submitBtn.className = 'btn btn-secondary';
    }
  } else {
    if (leaveBanner) leaveBanner.style.display = 'none';
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.className = type === 'checkin' ? 'btn btn-success' : 'btn btn-primary';
    }
  }

  if (type === 'checkin') {
    if (modalTitle) modalTitle.textContent = 'Daily Attendance Check-In (PKT Time)';
    if (modeGroup) modeGroup.style.display = 'block';
    if (noteLabel) noteLabel.textContent = 'Arrival / Daily Work Plan Note (Optional)';
    if (noteInput) noteInput.placeholder = 'e.g. Arrived on time, working on assigned sprint tasks...';
    if (submitBtn && !isLeaveDay) {
      submitBtn.textContent = '📍 Confirm Check-In';
      submitBtn.className = 'btn btn-success';
    }
  } else {
    if (modalTitle) modalTitle.textContent = 'Daily Shift Check-Out (PKT Time)';
    if (modeGroup) modeGroup.style.display = 'none';
    if (noteLabel) noteLabel.textContent = 'Shift Wrap-up / Summary Note (Optional)';
    if (noteInput) noteInput.placeholder = 'e.g. Completed today sprint modules and signed off...';
    if (submitBtn) {
      submitBtn.textContent = '🏁 Confirm Check-Out';
      submitBtn.className = 'btn btn-primary';
    }
  }

  openModal('modal-attendance-action');
}

async function submitAttendanceAction(e) {
  e.preventDefault();
  const type = document.getElementById('attendance-action-type')?.value || 'checkin';
  const note = document.getElementById('attendance-action-note')?.value.trim() || '';
  const status = document.getElementById('attendance-mode-select')?.value || 'present';
  const submitBtn = document.getElementById('btn-submit-attendance-action');

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
  }

  let url = '/api/attendance/check-in';
  let payload = { notes: note, status: status };
  if (type === 'checkout') {
    url = '/api/attendance/check-out';
    payload = { notes: note };
  }

  const res = await api(url, 'POST', payload);
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = type === 'checkin' ? '📍 Confirm Check-In' : '🏁 Confirm Check-Out';
  }

  closeModal('modal-attendance-action');

  if (res.ok) {
    showToast(res.data.message || 'Attendance recorded in Pakistan Time successfully!', 'success');
    loadInternOverview();
    const attPanel = document.getElementById('intern-panel-attendance');
    if (attPanel && attPanel.style.display !== 'none') {
      loadInternAttendance();
    }
  } else {
    showToast(res.data.error || 'Failed to record attendance.', 'error');
  }
}

function handleCheckIn() {
  openAttendanceActionModal('checkin');
}

function handleCheckOut() {
  openAttendanceActionModal('checkout');
}

// ----------------- Tasks (Intern View & Status Update) -----------------

async function loadInternTasks() {
  const activeGrid = document.getElementById('intern-active-tasks-grid');
  const completedGrid = document.getElementById('intern-completed-tasks-grid');
  const activeCountBadge = document.getElementById('intern-active-task-count');
  const completedCountBadge = document.getElementById('intern-completed-task-count');

  if (activeGrid) activeGrid.innerHTML = '<div style="text-align:center; color:var(--text-muted); grid-column: 1 / -1;">Loading...</div>';
  if (completedGrid) completedGrid.innerHTML = '<div style="text-align:center; color:var(--text-muted); grid-column: 1 / -1;">Loading...</div>';

  const res = await api('/api/tasks');
  if (!res.ok) {
    const errHtml = `<div style="text-align:center;color:var(--danger); grid-column: 1 / -1;">${res.data.error}</div>`;
    if (activeGrid) activeGrid.innerHTML = errHtml;
    if (completedGrid) completedGrid.innerHTML = errHtml;
    return;
  }

  const tasks = res.data.tasks || [];
  internTasksCache = tasks;

  const activeTasks = tasks.filter(t => t.status !== 'completed');
  const completedTasks = tasks.filter(t => t.status === 'completed');

  if (activeCountBadge) activeCountBadge.textContent = activeTasks.length;
  if (completedCountBadge) completedCountBadge.textContent = completedTasks.length;

  function renderTaskCard(task) {
    const isCompleted = task.status === 'completed';
    return `
      <div class="task-card priority-${task.priority} status-${task.status}">
        <div>
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.5rem;">
            <span class="badge badge-${task.priority}">${task.priority}</span>
            <span class="badge badge-${task.status}">${task.status.replace('_', ' ')}</span>
          </div>
          <h3 class="task-title">${escapeHtml(task.title)}</h3>
          <p class="task-desc">${escapeHtml(task.description || 'No description provided.')}</p>

          ${task.intern_notes ? `
            <div class="task-intern-note-box">
              <span class="note-box-label">📝 Your Progress Note:</span>
              <div class="note-box-text">${escapeHtml(task.intern_notes)}</div>
            </div>
          ` : ''}

          ${task.github_repo ? `
            <div class="task-github-link-box">
              <span class="github-box-label">🐙 Project Deliverable:</span>
              <a href="${escapeHtml(task.github_repo)}" target="_blank" rel="noopener noreferrer" class="github-box-link" title="${escapeHtml(task.github_repo)}">
                ${escapeHtml(task.github_repo.replace(/^https?:\/\//, ''))} ↗
              </a>
            </div>
          ` : ''}

          ${task.admin_attachment_path ? `
            <div class="task-attachment-box task-admin-attachment-box" style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.22); border-radius: 8px; padding: 0.6rem 0.75rem; margin-top: 0.6rem; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
              <div style="display: flex; flex-direction: column; gap: 0.15rem; overflow: hidden;">
                <span style="font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--primary);">📋 Task Brief &amp; Reference:</span>
                <span class="attachment-box-name" style="color: var(--text-main); font-weight: 600; font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">📎 ${escapeHtml(task.admin_attachment_filename || 'Reference File')}</span>
              </div>
              <a href="${task.admin_attachment_path}" target="_blank" download class="attachment-box-download" style="background: var(--primary); color: #fff; border-radius: 5px; padding: 0.28rem 0.65rem; font-size: 0.75rem; font-weight: 600; text-decoration: none; flex-shrink: 0;">Download</a>
            </div>
          ` : ''}

          ${task.attachment_path ? `
            <div class="task-attachment-box">
              <div style="display: flex; flex-direction: column; gap: 0.15rem; overflow: hidden;">
                <span style="font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #059669;">📦 Your Submitted Deliverable:</span>
                <span class="attachment-box-name">📎 ${escapeHtml(task.attachment_filename || 'Deliverable File')}</span>
              </div>
              <a href="${task.attachment_path}" target="_blank" download class="attachment-box-download">Download</a>
            </div>
          ` : ''}
        </div>

        <div>
          <div class="task-footer">
            <span>Due: <strong>${task.due_date || 'Flexible'}</strong></span>
            <span>By: ${escapeHtml(task.created_by_name || 'Admin')}</span>
          </div>

          <div style="margin-top:0.75rem; display:flex; flex-direction:column; gap:0.45rem;">
            <button type="button" class="btn-progress-history" style="width:100%; justify-content:center;" onclick="viewTaskProgressHistoryModal(${task.id})">
              📜 Daily Progress Log (${task.progress_count || (task.progress_updates ? task.progress_updates.length : 0)})
            </button>
            ${!isCompleted ? `
              <button class="btn btn-primary btn-sm btn-block" onclick="openUpdateTaskStatusModal(${task.id})">
                🔄 Update Status &amp; Daily Progress
              </button>
            ` : `
              <div style="text-align:center; padding: 0.25rem 0;">
                <span style="font-size:0.82rem; color:#34d399; font-weight:600;">✅ Task Completed</span>
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  }

  if (activeGrid) {
    activeGrid.innerHTML = activeTasks.length === 0
      ? '<div style="text-align:center; color:var(--text-muted); grid-column: 1 / -1; padding:2rem;">🎉 No active tasks — all caught up!</div>'
      : activeTasks.map(renderTaskCard).join('');
  }

  if (completedGrid) {
    completedGrid.innerHTML = completedTasks.length === 0
      ? '<div style="text-align:center; color:var(--text-muted); grid-column: 1 / -1; padding:2rem;">No completed tasks yet.</div>'
      : completedTasks.map(renderTaskCard).join('');
  }
}

function handleTaskStatusSelectChange(status) {
  const repoGroup = document.getElementById('group-task-github-repo');
  if (repoGroup) repoGroup.style.display = 'block';
}

function handleTaskFileChange(input) {
  const display = document.getElementById('update-task-filename-display');
  if (input.files && input.files.length > 0) {
    const file = input.files[0];
    const sizeKB = (file.size / 1024).toFixed(1);
    display.innerHTML = `<strong>Selected:</strong> <span style="color:#60a5fa;">${escapeHtml(file.name)}</span> <span style="color:var(--text-muted);">(${sizeKB} KB)</span>`;
  } else {
    display.textContent = 'No file selected';
  }
}

function renderProgressTimelineHtml(updates) {
  if (!updates || updates.length === 0) {
    return `
      <div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.85rem; background: #f8fafc; border-radius: 8px; border: 1px dashed var(--border-subtle);">
        ℹ️ No previous daily progress updates recorded yet. Your update today will be saved as Day 1.
      </div>
    `;
  }

  const storedRole = localStorage.getItem('internhub_user_role');
  const userRole = (currentUser && currentUser.role) || storedRole;
  const isAdmin = ['admin', 'super_admin'].includes(userRole);

  return updates.map((u, idx) => {
    const dayNum = updates.length - idx;
    return `
      <div class="progress-timeline-item" id="progress-item-${u.id}">
        <div class="progress-timeline-dot"></div>
        <div class="progress-timeline-card">
          <div class="progress-timeline-meta">
            <div class="progress-timeline-date">
              <span>📅 ${escapeHtml(u.created_at_formatted || u.date_str || 'Recent')}</span>
              <span style="color: var(--primary); font-weight: 700; margin-left: 0.35rem;">(Log #${dayNum})</span>
            </div>
            <div style="display:flex; align-items:center; gap:0.45rem;">
              <span class="badge badge-${escapeHtml(u.status)}">${escapeHtml(u.status ? u.status.replace('_', ' ') : 'in progress')}</span>
              ${isAdmin ? `
                <button type="button" 
                        class="btn-delete-progress" 
                        title="Delete this progress log"
                        onclick="deleteProgressLog(${u.task_id}, ${u.id})"
                        style="padding: 2px 8px; font-size: 0.72rem; font-weight: 600; border-radius: 4px; border: 1px solid #fecaca; color: #b91c1c; background: #fef2f2; cursor: pointer; display: inline-flex; align-items: center; gap: 3px; transition: all 0.2s;"
                        onmouseover="this.style.background='#fee2e2'; this.style.borderColor='#f87171';"
                        onmouseout="this.style.background='#fef2f2'; this.style.borderColor='#fecaca';">
                  🗑️ <span>Delete</span>
                </button>
              ` : ''}
            </div>
          </div>

          ${u.notes ? `
            <div class="progress-timeline-notes">${escapeHtml(u.notes)}</div>
          ` : '<div style="font-size:0.8rem; color:var(--text-muted); font-style:italic;">No written note for this log.</div>'}

          ${(u.github_repo || u.attachment_path) ? `
            <div class="progress-timeline-assets">
              ${u.github_repo ? (() => {
                const url = u.github_repo.toLowerCase();
                const isFb = url.includes('facebook') || url.includes('fb.watch') || url.includes('fb.me');
                const isGh = url.includes('github');
                const icon = isFb ? '📘' : (isGh ? '🐙' : '🔗');
                const label = isFb ? 'Facebook Link' : (isGh ? 'GitHub Link' : 'Project Link');
                const bg = isFb ? '#eff6ff' : (isGh ? '#f8fafc' : '#ecfdf5');
                const color = isFb ? '#1d4ed8' : (isGh ? '#0f172a' : '#047857');
                const border = isFb ? '#bfdbfe' : (isGh ? '#cbd5e1' : '#a7f3d0');
                return `
                  <a href="${escapeHtml(u.github_repo)}" target="_blank" rel="noopener noreferrer" class="progress-timeline-chip" style="background:${bg}; color:${color}; border:1px solid ${border};" title="${escapeHtml(u.github_repo)}">
                    ${icon} ${label} ↗
                  </a>
                `;
              })() : ''}
              ${u.attachment_path ? `
                <a href="${escapeHtml(u.attachment_path)}" target="_blank" download class="progress-timeline-chip" style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe;" title="Download attached work: ${escapeHtml(u.attachment_filename || 'Attachment')}">
                  📎 ${escapeHtml(u.attachment_filename || 'Daily Attachment')}
                </a>
              ` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function toggleUpdateModalHistory() {
  const body = document.getElementById('update-modal-history-body');
  const icon = document.getElementById('update-modal-history-icon');
  if (!body) return;
  if (body.style.display === 'none') {
    body.style.display = 'block';
    if (icon) icon.textContent = '▼';
  } else {
    body.style.display = 'none';
    if (icon) icon.textContent = '▶';
  }
}

async function viewTaskProgressHistoryModal(taskId) {
  const container = document.getElementById('history-modal-content');
  const subtitle = document.getElementById('history-modal-task-subtitle');
  if (container) container.innerHTML = '<div style="text-align:center; padding: 2rem; color: var(--text-muted);"><div class="spinner-small" style="margin: 0 auto 0.5rem auto;"></div>Loading progress history...</div>';
  if (subtitle) subtitle.textContent = 'Loading task details...';

  openModal('modal-task-progress-history');

  const res = await api(`/api/tasks/${taskId}/progress`);
  if (!res.ok) {
    if (container) container.innerHTML = `<div style="text-align:center; color:var(--danger); padding:2rem;">${escapeHtml(res.data.error || 'Failed to load progress history.')}</div>`;
    return;
  }

  const data = res.data;
  if (subtitle) {
    subtitle.innerHTML = `<strong>${escapeHtml(data.task_title)}</strong> &bull; Assignee: <strong>${escapeHtml(data.assigned_to_name || 'Intern')}</strong> &bull; Status: <span class="badge badge-${escapeHtml(data.current_status)}">${escapeHtml(data.current_status.replace('_', ' '))}</span>`;
  }
  if (container) {
    container.innerHTML = renderProgressTimelineHtml(data.updates);
  }
}

async function deleteProgressLog(taskId, updateId) {
  if (!confirm('Are you sure you want to delete this progress report log? This action cannot be undone.')) {
    return;
  }

  const res = await api(`/api/tasks/${taskId}/progress/${updateId}`, 'DELETE');
  if (res.ok) {
    showToast(res.data.message || 'Progress log deleted successfully.', 'success');
    const historyModal = document.getElementById('modal-task-progress-history');
    if (historyModal && historyModal.classList.contains('active')) {
      viewTaskProgressHistoryModal(taskId);
    }
    if (typeof loadAdminTasks === 'function') {
      loadAdminTasks();
    }
    if (typeof loadInternTasks === 'function') {
      loadInternTasks();
    }
  } else {
    showToast(res.data.error || 'Failed to delete progress log.', 'error');
  }
}

function openUpdateTaskStatusModal(taskId) {
  const task = (typeof internTasksCache !== 'undefined' && internTasksCache.find(t => t.id === taskId)) || null;
  if (!task) return;

  document.getElementById('update-task-id').value = task.id;
  document.getElementById('update-task-title').textContent = task.title;
  document.getElementById('update-task-status-select').value = task.status;
  
  // Prepare notes input: if there are already past updates, clear input for today's new progress log
  const pastUpdates = task.progress_updates || [];
  const notesField = document.getElementById('update-task-notes');
  if (pastUpdates.length > 0) {
    notesField.value = '';
    notesField.placeholder = "Summarize today's progress, milestones reached, or blockers...";
  } else {
    notesField.value = task.intern_notes || '';
    notesField.placeholder = "Summarize your daily progress or provide deliverable links...";
  }

  // Pre-fill Facebook or GitHub repository URL (ALWAYS visible)
  const repoGroup = document.getElementById('group-task-github-repo');
  const repoInput = document.getElementById('update-task-github-repo');
  if (repoInput) repoInput.value = task.github_repo || '';
  if (repoGroup) repoGroup.style.display = 'block';

  // Reset file selector
  const fileInput = document.getElementById('update-task-file');
  if (fileInput) fileInput.value = '';
  document.getElementById('update-task-filename-display').textContent = 'No file selected';

  // Show existing attachment if exists
  const currentAttachmentDiv = document.getElementById('update-task-current-attachment');
  const currentAttachmentLink = document.getElementById('update-task-current-attachment-link');
  if (task.attachment_path && task.attachment_filename) {
    currentAttachmentDiv.style.display = 'block';
    currentAttachmentLink.href = task.attachment_path;
    currentAttachmentLink.textContent = task.attachment_filename;
  } else {
    currentAttachmentDiv.style.display = 'none';
  }

  // Render past daily progress history inside the modal
  const historyList = document.getElementById('update-modal-history-list');
  const historyCount = document.getElementById('update-modal-history-count');
  if (historyCount) historyCount.textContent = pastUpdates.length;
  if (historyList) {
    historyList.innerHTML = renderProgressTimelineHtml(pastUpdates);
  }

  openModal('modal-update-task-status');
}

async function handleConfirmUpdateTaskStatus(e) {
  e.preventDefault();
  const taskId = document.getElementById('update-task-id').value;
  const status = document.getElementById('update-task-status-select').value;
  const notes = document.getElementById('update-task-notes').value.trim();
  let githubRepo = document.getElementById('update-task-github-repo').value.trim();
  const fileInput = document.getElementById('update-task-file');

  // Normalize URL if provided without protocol (e.g. www.google.com or github.com/user/repo)
  if (githubRepo && !githubRepo.startsWith('http://') && !githubRepo.startsWith('https://')) {
    if (githubRepo.includes('.') || githubRepo.includes('/')) {
      githubRepo = 'https://' + githubRepo;
    }
  }

  const btn = document.getElementById('btn-save-task-status');
  btn.disabled = true;
  btn.textContent = 'Saving daily progress...';

  const formData = new FormData();
  formData.append('status', status);
  formData.append('intern_notes', notes);
  formData.append('github_repo', githubRepo);
  if (fileInput && fileInput.files && fileInput.files.length > 0) {
    formData.append('attachment', fileInput.files[0]);
  }

  const res = await api(`/api/tasks/${taskId}/status`, 'PATCH', formData);
  btn.disabled = false;
  btn.textContent = '💾 Save Daily Progress';

  closeModal('modal-update-task-status');

  if (res.ok) {
    showToast(`Daily task progress logged successfully!`, 'success');
    if (typeof loadInternTasks === 'function') loadInternTasks();
    if (typeof loadInternOverview === 'function') loadInternOverview();
    if (typeof loadAdminTasks === 'function') loadAdminTasks();
    if (typeof loadAdminOverview === 'function') loadAdminOverview();
  } else {
    showToast(res.data.error || 'Failed to update task status.', 'error');
  }
}

// ----------------- Attendance (Intern View) -----------------

async function loadInternAttendance() {
  const tbody = document.getElementById('tbody-intern-attendance');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Loading logs...</td></tr>';

  const res = await api('/api/attendance/my');
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--danger);">${res.data.error}</td></tr>`;
    return;
  }

  const records = res.data.records || [];
  const stats = res.data.stats || {};
  const today = res.data.today || null;

  const daysCountEl = document.getElementById('intern-att-days-count');
  const hoursCountEl = document.getElementById('intern-att-hours-count');
  const todayStatusEl = document.getElementById('intern-att-today-status');
  const todaySubEl = document.getElementById('intern-att-today-sub');
  const todayIconEl = document.getElementById('intern-att-today-icon');
  const avgHoursEl = document.getElementById('intern-att-avg-hours');
  const btnTabCheckin = document.getElementById('btn-tab-checkin');
  const btnTabCheckout = document.getElementById('btn-tab-checkout');

  if (daysCountEl) daysCountEl.textContent = stats.total_days || 0;
  if (hoursCountEl) hoursCountEl.textContent = `${stats.total_hours || 0} hrs`;
  if (avgHoursEl) {
    avgHoursEl.textContent = stats.total_days > 0 ? (stats.total_hours / stats.total_days).toFixed(1) + ' hrs' : '0.0 hrs';
  }

  const todayDayName = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', weekday: 'long' }).format(new Date());
  const userWorkingDays = (res.data.working_days && res.data.working_days.length > 0)
    ? res.data.working_days
    : ((currentUser && currentUser.working_days) ? currentUser.working_days : []);
  const isScheduledToday = userWorkingDays.length === 0 || userWorkingDays.includes(todayDayName);

  if (!isScheduledToday) {
    if (todayStatusEl) todayStatusEl.innerHTML = '<span style="color:#ef4444;">🌴 Scheduled Leave</span>';
    if (todaySubEl) todaySubEl.textContent = `Official Off Day (${todayDayName})`;
    if (todayIconEl) todayIconEl.textContent = '🌴';
    if (btnTabCheckin) {
      btnTabCheckin.disabled = true;
      btnTabCheckin.title = `Today (${todayDayName}) is your scheduled leave day`;
      btnTabCheckin.innerHTML = `🌴 ${todayDayName}: Scheduled Leave`;
      btnTabCheckin.style.display = 'inline-flex';
    }
    if (btnTabCheckout) btnTabCheckout.style.display = 'none';
  } else if (!stats.has_checked_in_today) {
    if (todayStatusEl) todayStatusEl.innerHTML = '<span style="color:#fbbf24;">Not Checked In</span>';
    if (todaySubEl) todaySubEl.textContent = 'Shift not started today';
    if (todayIconEl) todayIconEl.textContent = '🟡';
    if (btnTabCheckin) {
      btnTabCheckin.disabled = false;
      btnTabCheckin.style.display = 'inline-flex';
      btnTabCheckin.innerHTML = '📍 Check In for Today';
    }
    if (btnTabCheckout) btnTabCheckout.style.display = 'none';
  } else if (stats.has_checked_in_today && !stats.has_checked_out_today) {
    if (today && today.is_missed_punch) {
      if (todayStatusEl) todayStatusEl.innerHTML = `<span style="color:#ef4444;">⚠️ Missed Out Punch</span>`;
      if (todaySubEl) todaySubEl.textContent = `Daily check-out auto-closed at 10:00 PM PKT`;
      if (todayIconEl) todayIconEl.textContent = '⚠️';
      if (btnTabCheckin) btnTabCheckin.style.display = 'none';
      if (btnTabCheckout) btnTabCheckout.style.display = 'none';
    } else {
      if (todayStatusEl) todayStatusEl.innerHTML = `<span style="color:#10b981;">Active Shift</span>`;
      if (todaySubEl) todaySubEl.textContent = `In at ${today ? today.check_in : 'today'} PKT`;
      if (todayIconEl) todayIconEl.textContent = '🟢';
      if (btnTabCheckin) btnTabCheckin.style.display = 'none';
      if (btnTabCheckout) btnTabCheckout.style.display = 'inline-flex';
    }
  } else {
    if (todayStatusEl) todayStatusEl.innerHTML = `<span style="color:#6366f1;">Completed</span>`;
    if (todaySubEl) todaySubEl.textContent = `${today ? today.total_hours : 0} hrs logged today`;
    if (todayIconEl) todayIconEl.textContent = '🏁';
    if (btnTabCheckin) btnTabCheckin.style.display = 'none';
    if (btnTabCheckout) btnTabCheckout.style.display = 'none';
  }

  if (records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted); padding:2rem;">No attendance recorded yet. Use the check-in button above to start your shift.</td></tr>';
    return;
  }

  tbody.innerHTML = records.map(r => {
    const dayLabel = r.day_name ? `<span style="font-size:0.75rem; color:var(--text-muted); margin-left:0.35rem;">(${r.day_name.slice(0,3)})</span>` : '';
    let checkoutCell = '';
    if (r.is_missed_punch) {
      checkoutCell = '<span class="badge" style="background:#fee2e2; color:#b91c1c; font-weight:700; border:1px solid #fca5a5; display:inline-flex; align-items:center; gap:0.25rem;">⚠️ Missed Out Punch</span>';
    } else if (r.check_out) {
      checkoutCell = `<span style="font-family:monospace; font-weight:600; color:#4f46e5;">${escapeHtml(r.check_out)} <small style="color:var(--text-muted); font-size:0.75rem;">PKT</small></span>`;
    } else {
      checkoutCell = '<span class="badge" style="background:rgba(16,185,129,0.12); color:#059669; font-weight:700;">🟢 Active Shift</span>';
    }

    let statusCell = '';
    if (r.is_missed_punch) {
      statusCell = '<span class="badge" style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca; font-weight:700;">Missed Punch</span>';
    } else {
      statusCell = `<span class="badge badge-${escapeHtml(r.status)}">${escapeHtml(r.status)}</span>`;
    }

    return `
      <tr>
        <td style="font-weight:700; color:var(--text-main); font-family:monospace;">${r.date}${dayLabel}</td>
        <td><span style="font-family:monospace; font-weight:600; color:#059669;">${r.check_in ? escapeHtml(r.check_in) + ' <small style="color:var(--text-muted); font-size:0.75rem;">PKT</small>' : '—'}</span></td>
        <td>${checkoutCell}</td>
        <td>${r.total_hours !== null && r.total_hours !== undefined ? `<strong>${r.total_hours}</strong> hrs` : '—'}</td>
        <td>${statusCell}</td>
        <td style="font-size:0.85rem; color:var(--text-secondary);">${r.notes ? escapeHtml(r.notes) : '—'}</td>
      </tr>
    `;
  }).join('');
}

// ----------------- Messages (Intern View) -----------------

function openSendMessageModal() {
  document.getElementById('form-send-message').reset();
  openModal('modal-send-message');
}

async function handleSendMessage(e) {
  e.preventDefault();
  const payload = {
    subject: document.getElementById('msg-subject').value.trim(),
    priority: document.getElementById('msg-priority').value,
    body: document.getElementById('msg-body').value.trim()
  };

  const btn = document.getElementById('btn-submit-message');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  const res = await api('/api/messages', 'POST', payload);
  btn.disabled = false;
  btn.textContent = 'Send Message';

  if (res.ok) {
    showToast('Message transmitted to administrators.', 'success');
    closeModal('modal-send-message');
    loadInternMessages();
  } else {
    showToast(res.data.error || 'Failed to send message.', 'error');
  }
}

async function loadInternMessages() {
  const container = document.getElementById('intern-messages-list');
  container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:2rem;">Loading conversations...</div>';

  const res = await api('/api/messages');
  if (!res.ok) {
    container.innerHTML = `<div style="text-align:center;color:var(--danger); padding:2rem;">${escapeHtml(res.data.error)}</div>`;
    return;
  }

  const messages = res.data.messages || [];
  internMessagesCache = messages;

  if (messages.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:3rem;">No messages sent yet. Use "Send New Message" to contact administration.</div>';
    return;
  }

  container.innerHTML = messages.map(msg => {
    const repliesHtml = (msg.replies || []).map(rep => {
      const isAdminReply = rep.sender_role === 'admin' || rep.sender_role === 'super_admin';
      return `
        <div class="reply-item" style="${isAdminReply ? 'border-left: 3px solid #6366f1; background: rgba(99,102,241,0.1);' : 'border-left: 3px solid #3b82f6; background: rgba(59,130,246,0.1);'} padding: 0.75rem 1rem; border-radius: 6px; margin-top: 0.5rem;">
          <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:0.35rem;">
            <div>
              <strong style="color: ${isAdminReply ? '#818cf8' : '#60a5fa'};">${isAdminReply ? '🛡️ Administration Response (' + escapeHtml(rep.sender_name) + ')' : '👤 You:'}</strong>
              <span class="badge ${isAdminReply ? 'badge-admin' : 'badge-intern'}" style="margin-left: 0.4rem; font-size: 0.7rem;">${rep.sender_role}</span>
            </div>
            <span style="color:var(--text-muted);">${rep.created_at ? rep.created_at.slice(0, 16).replace('T', ' ') : ''}</span>
          </div>
          <div style="font-size: 0.9rem; color: var(--text-main); white-space: pre-wrap;">${escapeHtml(rep.body)}</div>
        </div>
      `;
    }).join('');

    const hasReplies = msg.replies && msg.replies.length > 0;

    return `
      <div class="message-item" style="background: #ffffff; border: 1px solid var(--border-subtle); border-radius: 12px; padding: 1.25rem; margin-bottom: 1rem; box-shadow: var(--shadow-sm);">
        <div class="message-meta" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
          <div class="message-sender" style="display: flex; align-items: center; gap: 0.5rem;">
            <span style="font-weight: 700; color: var(--text-main);">To: Administration Team</span>
            <span class="badge badge-${msg.priority}">${msg.priority.toUpperCase()}</span>
          </div>
          <div style="font-size:0.8rem; color:var(--text-muted);">
            🕒 ${msg.created_at ? msg.created_at.slice(0, 16).replace('T', ' ') : ''}
          </div>
        </div>
        <div style="font-size:1.1rem; font-weight:700; color:var(--text-main); margin-bottom:0.5rem;">
          ${escapeHtml(msg.subject)}
        </div>
        <div class="message-body" style="font-size: 0.95rem; line-height: 1.5; color: var(--text-secondary); background: #f8fafc; padding: 0.85rem; border-radius: 8px; border: 1px solid var(--border-subtle); white-space: pre-wrap;">${escapeHtml(msg.body)}</div>

        ${repliesHtml ? `
          <div class="replies-thread" style="margin-top: 1rem; border-top: 1px dashed var(--border-subtle); padding-top: 0.75rem;">
            <div style="font-size: 0.8rem; font-weight: 600; color: var(--primary); margin-bottom: 0.5rem;">🛡️ Administrator Feedback & Replies:</div>
            ${repliesHtml}
          </div>
        ` : `
          <div style="margin-top: 0.85rem; font-size: 0.85rem; color: var(--warning); display: flex; align-items: center; gap: 0.4rem;">
            <span>⏳ Status:</span> <span>Your message is submitted and awaiting administrator review.</span>
          </div>
        `}

        ${hasReplies ? `
          <div style="margin-top:1rem; display:flex; justify-content:flex-end;">
            <button class="btn btn-secondary btn-sm" onclick="openInternReplyModal(${msg.id})">
              💬 Send Follow-up to Administration
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function openInternReplyModal(msgId) {
  const msg = internMessagesCache.find(m => m.id === msgId);
  if (!msg) return;

  document.getElementById('reply-message-id').value = msg.id;
  document.getElementById('reply-modal-title').textContent = 'Send Follow-up to Administration';
  document.getElementById('reply-thread-sender').textContent = 'Regarding Original Inquiry';
  document.getElementById('reply-thread-date').textContent = msg.created_at ? msg.created_at.slice(0, 16).replace('T', ' ') : '';
  document.getElementById('reply-thread-subject').textContent = msg.subject;
  document.getElementById('reply-thread-body').textContent = msg.body;
  document.getElementById('reply-modal-label').textContent = 'Your Follow-up Message *';
  document.getElementById('reply-body').value = '';
  document.getElementById('reply-body').placeholder = 'Type your follow-up note to administrators...';
  document.getElementById('btn-submit-reply').textContent = '📨 Send Follow-up';
  openModal('modal-reply-message');
}

// ==================== INTERN WORKING SCHEDULE & LEAVE DAYS ====================
const ALL_WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
let currentInternScheduleData = null;

async function loadInternSchedule() {
  const banner = document.getElementById('intern-schedule-banner');
  const grid = document.getElementById('intern-calendar-grid');
  if (grid) grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 1.5rem;">Loading your weekly schedule...</div>';

  // Fetch current user details to get fresh schedule data
  const res = await api('/api/auth/me');
  if (!res.ok) {
    if (banner) banner.innerHTML = `<div class="badge badge-danger">Failed to load schedule: ${escapeHtml(res.data.error)}</div>`;
    return;
  }

  const user = res.data.user;
  currentInternScheduleData = user;

  const workingDays = user.working_days || [];
  const proposedDays = user.proposed_working_days || [];
  const status = user.schedule_status || 'not_set';
  const notes = user.schedule_notes || '';
  const leaveDays = ALL_WEEK_DAYS.filter(d => !workingDays.includes(d));
  const proposedLeaveDays = ALL_WEEK_DAYS.filter(d => !proposedDays.includes(d));

  // Render Status Banner
  if (banner) {
    if (status === 'approved') {
      banner.innerHTML = `
        <div style="background: #f0fdf4; border: 1px solid #86efac; border-left: 4px solid #16a34a; border-radius: 8px; padding: 1rem 1.25rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <div style="font-weight: 700; color: #166534; font-size: 0.95rem; display: flex; align-items: center; gap: 0.4rem;">
                <span>✅</span> Official Schedule Approved by Administration
              </div>
              <div style="font-size: 0.85rem; color: #15803d; margin-top: 0.35rem; line-height: 1.5;">
                Active Working Days: <strong>${workingDays.length > 0 ? workingDays.join(', ') : 'None'}</strong><br>
                Designated Leave Days: <strong style="color: #b45309;">${leaveDays.length > 0 ? leaveDays.join(', ') : 'None'}</strong>
                ${user.schedule_approved_at ? ` · <span style="color: var(--text-muted);">Approved on ${user.schedule_approved_at.slice(0, 10)}</span>` : ''}
              </div>
            </div>
            <span class="badge" style="background: #dcfce7; color: #15803d; font-weight: 700;">Approved</span>
          </div>
        </div>
      `;
    } else if (status === 'pending_approval') {
      banner.innerHTML = `
        <div style="background: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 1rem 1.25rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <div style="font-weight: 700; color: #92400e; font-size: 0.95rem; display: flex; align-items: center; gap: 0.4rem;">
                <span>⏳</span> Proposed Schedule Pending Admin Review
              </div>
              <div style="font-size: 0.85rem; color: #b45309; margin-top: 0.35rem; line-height: 1.5;">
                Requested Working Days: <strong>${proposedDays.length > 0 ? proposedDays.join(', ') : workingDays.join(', ')}</strong><br>
                Designated Leave Days: <strong>${proposedLeaveDays.length > 0 ? proposedLeaveDays.join(', ') : leaveDays.join(', ')}</strong>
              </div>
            </div>
            <span class="badge" style="background: #fef3c7; color: #b45309; font-weight: 700;">Pending Approval</span>
          </div>
        </div>
      `;
    } else if (status === 'rejected') {
      banner.innerHTML = `
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid #dc2626; border-radius: 8px; padding: 1rem 1.25rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <div style="font-weight: 700; color: #991b1b; font-size: 0.95rem; display: flex; align-items: center; gap: 0.4rem;">
                <span>❌</span> Schedule Revisions Requested by Admin
              </div>
              <div style="font-size: 0.85rem; color: #b91c1c; margin-top: 0.25rem;">
                ${notes ? `Admin Feedback: <em>${escapeHtml(notes)}</em>` : 'Please adjust your selected working days and submit again.'}
              </div>
            </div>
            <button type="button" class="btn btn-danger btn-xs" onclick="openInternSchedulePickerModal()">
              ✏️ Resubmit Schedule
            </button>
          </div>
        </div>
      `;
    } else {
      banner.innerHTML = `
        <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-left: 4px solid #3b82f6; border-radius: 8px; padding: 1rem 1.25rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <div style="font-weight: 700; color: #1e40af; font-size: 0.95rem; display: flex; align-items: center; gap: 0.4rem;">
                <span>📅</span> Decide Your Weekly Schedule
              </div>
              <div style="font-size: 0.85rem; color: #1d4ed8; margin-top: 0.25rem;">
                You haven't configured your weekly work schedule yet. Select which days you will attend work. Unselected days will become your official leave days.
              </div>
            </div>
            <button type="button" class="btn btn-primary btn-xs" onclick="openInternSchedulePickerModal()">
              📅 Set Schedule Now
            </button>
          </div>
        </div>
      `;
    }
  }

  // Render 7-day Weekly Calendar Grid
  if (grid) {
    const activeList = status === 'pending_approval' && proposedDays.length > 0 ? proposedDays : workingDays;

    grid.innerHTML = ALL_WEEK_DAYS.map(dayName => {
      const isWorking = activeList.includes(dayName);
      return `
        <div class="calendar-day-card ${isWorking ? 'is-working active-day' : 'is-leave off-day'}">
          <div class="day-card-name">${dayName}</div>
          <div class="day-card-badge">${isWorking ? '💼 Working Day' : '🌴 Scheduled Leave'}</div>
          <div class="day-card-sub">${isWorking ? 'Active Attendance' : 'Authorized Off Day'}</div>
        </div>
      `;
    }).join('');
  }
}

function openInternSchedulePickerModal() {
  const user = currentInternScheduleData || {};
  const currentDays = user.proposed_working_days?.length ? user.proposed_working_days : (user.working_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);

  // Set checkboxes for all 7 days
  document.querySelectorAll('input[name="intern_modal_days"]').forEach(cb => {
    cb.checked = currentDays.includes(cb.value);
  });

  const notesEl = document.getElementById('intern-modal-notes');
  if (notesEl) notesEl.value = '';

  openModal('modal-intern-schedule-picker');
}

async function submitInternScheduleRequest(e) {
  e.preventDefault();
  const checkedDays = Array.from(document.querySelectorAll('input[name="intern_modal_days"]:checked')).map(cb => cb.value);

  if (checkedDays.length === 0) {
    showToast('Please select at least 1 working day.', 'error');
    return;
  }

  const notes = document.getElementById('intern-modal-notes')?.value.trim() || '';

  const btn = document.getElementById('btn-submit-intern-schedule');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Submitting...';
  }

  const res = await api('/api/interns/schedule/request', 'POST', {
    working_days: checkedDays,
    notes: notes
  });

  if (btn) {
    btn.disabled = false;
    btn.textContent = '🚀 Submit for Approval';
  }

  if (res.ok) {
    showToast(res.data.message || 'Schedule request submitted for administrator approval.', 'success');
    closeModal('modal-intern-schedule-picker');
    loadInternSchedule();
  } else {
    showToast(res.data.error || 'Failed to submit schedule request.', 'error');
  }
}

// ==================== ADMIN SCHEDULE GOVERNANCE ====================
let adminSchedulesCache = [];

async function loadAdminSchedules() {
  const tbody = document.getElementById('tbody-admin-schedules');
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Loading work schedules...</td></tr>';

  const res = await api('/api/interns/schedules');
  if (!res.ok) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--danger);">${res.data.error}</td></tr>`;
    return;
  }

  const list = res.data.schedules || [];
  adminSchedulesCache = list;

  if (list.length === 0) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:2rem;">No intern records registered.</td></tr>';
    return;
  }

  if (tbody) {
    tbody.innerHTML = list.map(item => {
      const workingDays = item.working_days || [];
      const proposedDays = item.proposed_working_days || [];
      const leaveDays = item.leave_days || ALL_WEEK_DAYS.filter(d => !workingDays.includes(d));
      const status = item.schedule_status || 'not_set';

      let statusBadge = '<span class="badge" style="background:#f1f5f9; color:#475569;">Not Set</span>';
      if (status === 'approved') {
        statusBadge = '<span class="badge" style="background:#dcfce7; color:#166534; font-weight:700;">✅ Approved</span>';
      } else if (status === 'pending_approval') {
        statusBadge = '<span class="badge" style="background:#fef3c7; color:#92400e; font-weight:700;">⏳ Pending Approval</span>';
      } else if (status === 'rejected') {
        statusBadge = '<span class="badge" style="background:#fee2e2; color:#991b1b; font-weight:700;">❌ Rejected</span>';
      }

      // Render days pills
      const displayDays = status === 'pending_approval' && proposedDays.length > 0 ? proposedDays : workingDays;
      let daysHtml = '';
      if (displayDays.length === 0) {
        daysHtml = '<span style="color:var(--text-muted); font-size:0.82rem;">No schedule decided yet</span>';
      } else {
        const workPills = displayDays.map(d => `<span style="display:inline-block; padding:2px 7px; background:#eff6ff; color:#1e40af; border:1px solid #bfdbfe; border-radius:4px; font-size:0.75rem; font-weight:600; margin:1px;">${d.slice(0,3)}</span>`).join('');
        const leavePills = (status === 'pending_approval' && proposedDays.length > 0)
          ? ALL_WEEK_DAYS.filter(d => !proposedDays.includes(d)).map(d => `<span style="display:inline-block; padding:2px 6px; background:#fef2f2; color:#991b1b; border:1px solid #fecaca; border-radius:4px; font-size:0.72rem; margin:1px;">${d.slice(0,3)}</span>`).join('')
          : leaveDays.map(d => `<span style="display:inline-block; padding:2px 6px; background:#fef2f2; color:#991b1b; border:1px solid #fecaca; border-radius:4px; font-size:0.72rem; margin:1px;">${d.slice(0,3)}</span>`).join('');

        daysHtml = `
          <div><strong style="font-size:0.75rem; color:#1e40af;">Work:</strong> ${workPills}</div>
          <div style="margin-top:3px;"><strong style="font-size:0.75rem; color:#991b1b;">Leave:</strong> ${leavePills || '<span style="font-size:0.72rem; color:var(--text-muted);">None</span>'}</div>
        `;
        if (status === 'pending_approval' && proposedDays.length > 0) {
          daysHtml += `<div style="font-size:0.72rem; color:#b45309; font-weight:600; margin-top:2px;">Proposed: ${proposedDays.join(', ')}</div>`;
        }
      }

      return `
        <tr>
          <td>
            <div style="font-weight:700; color:var(--text-main);">${escapeHtml(item.full_name)}</div>
            <div style="font-size:0.8rem; color:var(--text-muted); font-family:monospace;">${escapeHtml(item.email)}</div>
          </td>
          <td>
            <span style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(item.department || 'General')}</span>
          </td>
          <td>
            ${daysHtml}
          </td>
          <td>
            ${statusBadge}
          </td>
          <td style="text-align:right;">
            <div style="display:flex; justify-content:flex-end; gap:0.4rem; flex-wrap:wrap;">
              ${status === 'pending_approval' ? `
                <button type="button" class="btn btn-success btn-xs" onclick="approveInternScheduleAction(${item.id}, '${escapeHtml(item.full_name)}')" title="Approve proposed schedule">
                  ✅ Approve
                </button>
                <button type="button" class="btn btn-danger btn-xs" onclick="rejectInternScheduleAction(${item.id}, '${escapeHtml(item.full_name)}')" title="Reject schedule">
                  ❌ Reject
                </button>
              ` : ''}
              <button type="button" class="btn btn-secondary btn-xs" onclick="openAdminEditScheduleModal(${item.id})" title="Edit or override schedule">
                ✏️ Edit Schedule
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }
}

async function approveInternScheduleAction(internId, internName) {
  if (!confirm(`Are you sure you want to approve the work schedule for ${internName}?`)) return;

  const res = await api(`/api/interns/${internId}/schedule/approve`, 'PATCH');
  if (res.ok) {
    showToast(res.data.message || `Schedule for ${internName} approved!`, 'success');
    loadAdminSchedules();
  } else {
    showToast(res.data.error || 'Failed to approve schedule.', 'error');
  }
}

async function rejectInternScheduleAction(internId, internName) {
  const reason = prompt(`Specify rejection reason / instruction for ${internName}:`, 'Please revise selected working days.');
  if (reason === null) return;

  const res = await api(`/api/interns/${internId}/schedule/reject`, 'PATCH', { reason });
  if (res.ok) {
    showToast(res.data.message || `Schedule for ${internName} rejected.`, 'info');
    loadAdminSchedules();
  } else {
    showToast(res.data.error || 'Failed to reject schedule.', 'error');
  }
}

function openAdminEditScheduleModal(internId) {
  const intern = adminSchedulesCache.find(s => s.id === internId);
  if (!intern) return;

  document.getElementById('admin-schedule-intern-id').value = intern.id;
  document.getElementById('admin-schedule-intern-name').textContent = intern.full_name;
  document.getElementById('admin-schedule-intern-email').textContent = intern.email;

  const badgeEl = document.getElementById('admin-schedule-intern-current-badge');
  if (badgeEl) {
    badgeEl.textContent = intern.schedule_status || 'not_set';
    badgeEl.className = `badge badge-${intern.schedule_status === 'approved' ? 'success' : (intern.schedule_status === 'rejected' ? 'danger' : 'info')}`;
  }

  // Populate days checkboxes for all 7 days
  const currentDays = (intern.proposed_working_days?.length && intern.schedule_status === 'pending_approval')
    ? intern.proposed_working_days
    : (intern.working_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);

  document.querySelectorAll('input[name="admin_modal_days"]').forEach(cb => {
    cb.checked = currentDays.includes(cb.value);
  });

  const statusEl = document.getElementById('admin-schedule-status');
  if (statusEl) statusEl.value = intern.schedule_status === 'pending_approval' ? 'approved' : (intern.schedule_status || 'approved');

  const notesEl = document.getElementById('admin-schedule-notes');
  if (notesEl) notesEl.value = intern.schedule_notes || '';

  openModal('modal-admin-edit-schedule');
}

async function saveAdminInternSchedule(e) {
  e.preventDefault();
  const internId = document.getElementById('admin-schedule-intern-id').value;
  const checkedDays = Array.from(document.querySelectorAll('input[name="admin_modal_days"]:checked')).map(cb => cb.value);

  if (checkedDays.length === 0) {
    showToast('Please select at least 1 working day.', 'error');
    return;
  }

  const status = document.getElementById('admin-schedule-status')?.value;
  const notes = document.getElementById('admin-schedule-notes')?.value.trim();

  const btn = document.getElementById('btn-save-admin-schedule');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  const res = await api(`/api/interns/${internId}/schedule`, 'PUT', {
    working_days: checkedDays,
    status: status,
    notes: notes
  });

  if (btn) {
    btn.disabled = false;
    btn.textContent = '💾 Save & Apply Schedule';
  }

  if (res.ok) {
    showToast(res.data.message || 'Intern schedule updated successfully!', 'success');
    closeModal('modal-admin-edit-schedule');
    loadAdminSchedules();
  } else {
    showToast(res.data.error || 'Failed to update schedule.', 'error');
  }
}

// ==================== ADMIN INTERN PASSWORD MANAGEMENT ====================
let adminInternsPasswordCache = [];

async function loadAdminPasswordManager() {
  const select = document.getElementById('reset-pwd-intern-select');
  if (select) {
    select.innerHTML = '<option value="">Loading intern accounts...</option>';
  }

  // Hide success card
  const successBox = document.getElementById('pwd-reset-success-box');
  if (successBox) successBox.style.display = 'none';

  const res = await api('/api/interns?status=all');
  if (!res.ok) {
    if (select) select.innerHTML = '<option value="">Failed to load interns</option>';
    return;
  }

  const interns = res.data.interns || [];
  adminInternsPasswordCache = interns;

  if (select) {
    if (interns.length === 0) {
      select.innerHTML = '<option value="">No interns found</option>';
    } else {
      select.innerHTML = '<option value="">-- Choose an Intern to Reset Password --</option>' +
        interns.map(i => `<option value="${i.id}">${escapeHtml(i.full_name)} (${escapeHtml(i.email)}) [${i.status}]</option>`).join('');
    }
  }

  // Reset fields
  const newPwdEl = document.getElementById('reset-pwd-new');
  const confirmPwdEl = document.getElementById('reset-pwd-confirm');
  if (newPwdEl) {
    newPwdEl.value = '';
    newPwdEl.type = 'password';
    const btn = newPwdEl.parentElement?.querySelector('.password-toggle-btn');
    if (btn) { btn.innerHTML = '👁️'; btn.title = 'Show password'; btn.setAttribute('aria-label', 'Show password'); }
  }
  if (confirmPwdEl) {
    confirmPwdEl.value = '';
    confirmPwdEl.type = 'password';
    const btn = confirmPwdEl.parentElement?.querySelector('.password-toggle-btn');
    if (btn) { btn.innerHTML = '👁️'; btn.title = 'Show password'; btn.setAttribute('aria-label', 'Show password'); }
  }
  const internCard = document.getElementById('reset-pwd-intern-card');
  if (internCard) internCard.style.display = 'none';
}

function handleSelectInternForPasswordReset() {
  const select = document.getElementById('reset-pwd-intern-select');
  const card = document.getElementById('reset-pwd-intern-card');
  const nameEl = document.getElementById('reset-card-name');
  const emailEl = document.getElementById('reset-card-email');
  const badgeEl = document.getElementById('reset-card-badge');

  const internId = parseInt(select.value, 10);
  const intern = adminInternsPasswordCache.find(i => i.id === internId);

  if (!intern) {
    if (card) card.style.display = 'none';
    return;
  }

  if (nameEl) nameEl.textContent = intern.full_name;
  if (emailEl) emailEl.textContent = intern.email;
  if (badgeEl) {
    badgeEl.textContent = intern.status || 'active';
    badgeEl.className = `badge badge-${intern.status === 'completed' ? 'success' : (intern.status === 'active' ? 'primary' : 'warning')}`;
  }
  if (card) card.style.display = 'block';
}

/**
 * Universal toggle for showing/hiding password field content
 * @param {string} inputId - ID of the password input element
 * @param {HTMLElement} [btnEl] - Reference to the toggle button
 */
function togglePasswordVisibility(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;

  // Resolve button element if not passed explicitly
  let btn = btnEl;
  if (!btn) {
    if (window.event && window.event.currentTarget) {
      btn = window.event.currentTarget;
    } else {
      btn = input.parentElement ? input.parentElement.querySelector('.password-toggle-btn, button[onclick*="togglePasswordVisibility"]') : null;
    }
  }

  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';

  if (btn) {
    btn.innerHTML = isPassword ? '🙈' : '👁️';
    const titleText = isPassword ? 'Hide password' : 'Show password';
    btn.title = titleText;
    btn.setAttribute('aria-label', titleText);
  }
}

function generateRandomInternPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let pwd = '';
  for (let i = 0; i < 10; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const newPwdEl = document.getElementById('reset-pwd-new');
  const confirmPwdEl = document.getElementById('reset-pwd-confirm');
  if (newPwdEl) {
    newPwdEl.type = 'text';
    newPwdEl.value = pwd;
    const btn = newPwdEl.parentElement?.querySelector('.password-toggle-btn');
    if (btn) {
      btn.innerHTML = '🙈';
      btn.title = 'Hide password';
      btn.setAttribute('aria-label', 'Hide password');
    }
  }
  if (confirmPwdEl) {
    confirmPwdEl.type = 'text';
    confirmPwdEl.value = pwd;
    const btn = confirmPwdEl.parentElement?.querySelector('.password-toggle-btn');
    if (btn) {
      btn.innerHTML = '🙈';
      btn.title = 'Hide password';
      btn.setAttribute('aria-label', 'Hide password');
    }
  }
  showToast('Secure random password generated!', 'info');
}

async function handleAdminResetPassword(e) {
  e.preventDefault();
  const internId = document.getElementById('reset-pwd-intern-select')?.value;
  if (!internId) {
    showToast('Please select an intern account to reset.', 'error');
    return;
  }

  const newPwd = document.getElementById('reset-pwd-new')?.value.trim();
  const confirmPwd = document.getElementById('reset-pwd-confirm')?.value.trim();

  if (!newPwd || newPwd.length < 6) {
    showToast('Password must be at least 6 characters long.', 'error');
    return;
  }

  if (newPwd !== confirmPwd) {
    showToast('Passwords do not match. Please re-enter identical passwords.', 'error');
    return;
  }

  const intern = adminInternsPasswordCache.find(i => i.id === parseInt(internId, 10));
  const internName = intern ? intern.full_name : 'Intern';
  const internEmail = intern ? intern.email : '';

  const btn = document.getElementById('btn-submit-pwd-reset');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Updating Password...';
  }

  const res = await api(`/api/interns/${internId}/reset-password`, 'POST', {
    new_password: newPwd
  });

  if (btn) {
    btn.disabled = false;
    btn.textContent = '🔒 Update Password Now';
  }

  if (res.ok) {
    showToast(`Password for ${internName} has been successfully updated!`, 'success');

    // Show credential box
    const successBox = document.getElementById('pwd-reset-success-box');
    const emailSpan = document.getElementById('copy-pwd-email');
    const pwdSpan = document.getElementById('copy-pwd-val');

    if (emailSpan) emailSpan.textContent = internEmail;
    if (pwdSpan) pwdSpan.textContent = newPwd;
    if (successBox) successBox.style.display = 'block';

    // Clear form inputs
    const newPwdEl = document.getElementById('reset-pwd-new');
    const confirmPwdEl = document.getElementById('reset-pwd-confirm');
    if (newPwdEl) newPwdEl.value = '';
    if (confirmPwdEl) confirmPwdEl.value = '';
  } else {
    showToast(res.data.error || 'Failed to reset password.', 'error');
  }
}

function copyResetCredentials() {
  const email = document.getElementById('copy-pwd-email')?.textContent || '';
  const pwd = document.getElementById('copy-pwd-val')?.textContent || '';
  const text = `Full Stack Zone Internship Portal Login:\nEmail: ${email}\nNew Password: ${pwd}\nLogin URL: ${window.location.origin}`;

  navigator.clipboard.writeText(text).then(() => {
    showToast('Login credentials copied to clipboard!', 'success');
  }).catch(() => {
    prompt('Copy these credentials:', text);
  });
}

// Live Cockpit Clock
function updateCockpitTime() {
  const el = document.getElementById('cockpit-system-time');
  if (!el) return;
  const now = new Date();
  const options = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  el.textContent = `${now.toLocaleDateString('en-US', options)}`;
}

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
  updateCockpitTime();
  setInterval(updateCockpitTime, 30000);
  checkSession();
});
