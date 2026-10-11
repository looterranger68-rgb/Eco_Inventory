/**
 * EcoInventery Shared Client Library
 * Handles API fetch wrapper, active navigation highlighting, authentication state, and modals.
 */

// Pages where a 401 must NOT trigger a login redirect (we're already there,
// and the redirect would swallow the server's error message).
function isAuthPage() {
  return /\/(login|register)\.html$/.test(window.location.pathname);
}

function isPublicPage() {
  return window.location.pathname === '/' || window.location.pathname === '/index.html';
}

// Sends credentials (httpOnly JWT cookie) with every request.
// On 401, protected app pages are bounced to the sign-in page.
async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });

  if (res.status === 401 && !isAuthPage() && !isPublicPage()) {
    window.location.href = '/login.html';
    throw new Error('Session expired. Please sign in again.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP error ${res.status}`);
  }
  return res.json();
}

const API = {
  get: (url) => apiFetch(url),

  post: (url, data) => apiFetch(url, { method: 'POST', body: JSON.stringify(data) }),

  put: (url, data) => apiFetch(url, { method: 'PUT', body: JSON.stringify(data) }),

  delete: (url) => apiFetch(url, { method: 'DELETE' })
};

// Currency & Date formatting
function formatCurrency(num) {
  const n = parseFloat(num) || 0;
  let symbol = '$';
  try { symbol = localStorage.getItem('eco_currency_symbol') || '$'; } catch (e) { /* use the default symbol */ }
  return symbol + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Minimal HTML escaping for API values injected into innerHTML templates
function esc(str) {
  return String(str === undefined || str === null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Toast notification
function showToast(message, type = 'info') {
  let box = document.getElementById('toast-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast-box';
    box.className = 'toast-container';
    document.body.appendChild(box);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;

  if (type === 'danger') toast.style.backgroundColor = '#991B1B';
  else if (type === 'success') toast.style.backgroundColor = '#15803D';

  box.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

// Modal management
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('open');
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('open');
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-backdrop')) {
    e.target.classList.remove('open');
  }
});

// Automatic Navigation Highlighting & Auth State
document.addEventListener('DOMContentLoaded', async () => {
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  const navLinks = document.querySelectorAll('.nav-link');
  
  navLinks.forEach(link => {
    const linkPath = link.getAttribute('href').split('/').pop();
    if (linkPath === currentPath || (currentPath === '' && linkPath === 'index.html')) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  if (!isAuthPage()) {
    try {
      const { data: settings } = await API.get('/api/dashboard/settings');
      if (settings.currency_symbol) localStorage.setItem('eco_currency_symbol', settings.currency_symbol);
      if (settings.store_name) {
        document.querySelectorAll('.brand-title').forEach(el => { el.textContent = settings.store_name; });
      }
    } catch (e) {
      // The protected page API below will redirect if the session has expired.
    }
  }

  // Render header auth state from the live session (httpOnly cookie)
  const userSlot = document.getElementById('nav-user-slot');
  if (userSlot) {
    try {
      const res = await API.get('/api/auth/me');
      userSlot.innerHTML = `
        <span style="font-size: 0.82rem; color: var(--text-secondary); margin-right: 6px;">${esc(res.seller.name)}</span>
        <button class="btn btn-sm" onclick="logout()">Sign Out</button>
      `;
    } catch (e) {
      // Not signed in (or on a page where login redirect is suppressed)
      if (!window.location.pathname.endsWith('/login.html') && !window.location.pathname.endsWith('/register.html')) {
        userSlot.innerHTML = `
          <a href="/login.html" class="btn btn-sm">Sign In</a>
          <a href="/register.html" class="btn btn-sm btn-dark">Get Started</a>
        `;
      }
    }
  }

  // Responsive hamburger nav (≤700px): inject toggle + close on outside click
  const headerContainer = document.querySelector('.header-container');
  const mainNav = document.querySelector('.main-nav');
  if (headerContainer && mainNav && !document.getElementById('nav-toggle-btn')) {
    const btn = document.createElement('button');
    btn.id = 'nav-toggle-btn';
    btn.className = 'nav-toggle';
    btn.setAttribute('aria-label', 'Toggle navigation menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';
    // Insert before the auth actions so order is: brand | nav | toggle | auth
    headerContainer.insertBefore(btn, mainNav.nextSibling);

    btn.addEventListener('click', () => {
      const open = mainNav.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    // Close the menu when a nav link is chosen or the user clicks elsewhere
    mainNav.addEventListener('click', (e) => {
      if (e.target.classList.contains('nav-link')) {
        mainNav.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('click', (e) => {
      if (mainNav.classList.contains('open') && !mainNav.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        mainNav.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }
});

async function logout() {
  try { await API.post('/api/auth/logout', {}); } catch (e) { /* clear locally regardless */ }
  localStorage.removeItem('eco_token');
  localStorage.removeItem('eco_user');
  window.location.href = '/login.html';
}

// ---------------------------------------------------------------------------
// Cursor tilt micro-effect
// Elements with class "tilt" shift up to 3px toward the cursor. Plain JS,
// rAF-throttled, resets to neutral when the cursor leaves the element.
// ---------------------------------------------------------------------------
(function initTilt() {
  const MAX_SHIFT = 3; // px

  function handleMove(e) {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const dist = Math.hypot(dx, dy) || 1;
    const scale = Math.min(dist, 80) / 80; // 0 at center, 1 at edge+
    const x = (dx / dist) * MAX_SHIFT * scale;
    const y = (dy / dist) * MAX_SHIFT * scale;
    el.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
  }

  function handleLeave(e) {
    e.currentTarget.style.transform = '';
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tilt').forEach(el => {
      el.addEventListener('mousemove', handleMove);
      el.addEventListener('mouseleave', handleLeave);
    });
  });
})();
