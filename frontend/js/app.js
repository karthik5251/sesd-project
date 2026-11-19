const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const api = async (url, options = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const r = await fetch(url, {
    credentials: 'include',
    ...options,
    headers
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw Error(data.error || 'Request failed with status ' + r.status);
  }
  return data;
};

const safe = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const cash = n => '₹' + Number(n || 0).toLocaleString('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const date = s => {
  if (!s) return 'TBA';
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? String(s).slice(0, 10)
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const msg = (s, bad = true) => {
  const el = $('#message');
  if (el) {
    el.textContent = s;
    el.classList.remove('hidden');
    el.style.color = bad ? '#ffb1c3' : '#a3ffcf';
    el.style.borderColor = bad ? '#ff5281' : '#45d89b';
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
};

let me = null;

async function init() {
  try {
    const res = await api('/api/me');
    me = res.user;
  } catch (err) {
    me = null;
  }

  const auth = $('#auth-links');
  if (auth) {
    auth.innerHTML = me
      ? `<a href="bookings.html">My tickets</a>` +
        (me.role === 'admin' ? `<a href="admin.html">Admin</a>` : '') +
        `<span style="color:#c7aaff;font-weight:600">👤 ${safe(me.name)}</span>` +
        `<button id="logout" class="btn outline" style="padding:6px 14px;font-size:.85rem">Log out</button>`
      : `<a href="login.html">Log in</a><a class="btn" href="register.html">Sign up</a>`;

    $('#logout')?.addEventListener('click', async () => {
      try {
        await api('/api/auth/logout', { method: 'POST' });
      } catch (_) {}
      location.href = 'index.html';
    });
  }

  const page = document.body.dataset.page;
  try {
    if (page === 'home' || page === 'index' || page === 'concerts') await renderConcerts(page);
    if (page === 'detail' || page === 'concert') await renderDetail();
    if (page === 'bookings') await renderBookings();
    if (page === 'admin') setupAdmin();
  } catch (e) {
    msg(e.message);
  }
}

const card = c => `
  <article class="card">
    <div class="poster">♫</div>
    <div class="card-body">
      <small>${date(c.event_date)} · ${safe(c.event_time || '19:00')}</small>
      <h3 style="margin:8px 0">${safe(c.title)}</h3>
      <p style="margin:0 0 14px">♫ ${safe(c.artist)}<br>⌖ ${safe(c.venue)}, ${safe(c.city)}</p>
      <div class="row">
        <strong class="price">${cash(c.price)}</strong>
        <a class="btn" href="concert.html?id=${encodeURIComponent(c.id)}">Book now</a>
      </div>
    </div>
  </article>
`;

async function renderConcerts(page) {
  const all = await api('/api/concerts');
  const grid = $('#concert-grid');
  if (!grid) return;

  const isHome = (page === 'home' || page === 'index');
  const render = items => {
    grid.innerHTML = items.length ? items.map(card).join('') : '<p>No concerts found.</p>';
  };
  render(isHome ? all.slice(0, 3) : all);

  $('#search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    render(all.filter(c => [c.title, c.artist, c.venue, c.city].some(v => (v || '').toLowerCase().includes(q))));
  });
}

async function renderDetail() {
  const container = $('#detail');
  if (!container) return;

  const id = new URLSearchParams(location.search).get('id');
  if (!id) {
    container.innerHTML = '<p>No concert selected. <a href="concerts.html">Browse concerts</a></p>';
    return;
  }

  let c;
  try {
    c = await api('/api/concerts/' + encodeURIComponent(id));
  } catch (err) {
    container.innerHTML = `<p>Concert not found or invalid ID. <a href="concerts.html">Back to concerts</a></p>`;
    return;
  }

  const price = Number(c.price);
  const maxTickets = Math.min(10, Number(c.available_tickets));

  const calculateBilling = qty => {
    const subtotal = Number((price * qty).toFixed(2));
    const fee = Number((subtotal * 0.05).toFixed(2)); // 5% fee
    const total = Number((subtotal + fee).toFixed(2));
    return { subtotal, fee, total };
  };

  const initialBilling = calculateBilling(1);

  container.innerHTML = `
    <div class="poster" style="height:230px">♫</div>
    <h1 style="margin:16px 0 8px">${safe(c.title)}</h1>
    <p style="margin-bottom:20px">${safe(c.description || 'Join us for an unforgettable live music performance.')}</p>
    <div class="row"><span>Artist</span><strong>${safe(c.artist)}</strong></div>
    <div class="row"><span>Venue</span><strong>${safe(c.venue)}, ${safe(c.city)}</strong></div>
    <div class="row"><span>Date & Time</span><strong>${date(c.event_date)} at ${safe(c.event_time)}</strong></div>
    <div class="row"><span>Available tickets</span><strong id="avail-tickets">${Number(c.available_tickets)}</strong></div>
    <div class="row"><span>Ticket Price</span><strong class="price">${cash(price)}</strong></div>

    <form id="booking-form" style="margin-top:30px">
      <h2 style="font-size:1.4rem;margin:0 0 8px;color:#c7aaff">Checkout & Billing</h2>
      <p style="margin:0 0 16px"><small>Select ticket quantity and review your billing breakdown below.</small></p>

      <div class="field">
        <label for="ticket-qty">Tickets (1–${maxTickets > 0 ? maxTickets : 1})</label>
        <input class="input" type="number" id="ticket-qty" name="quantity" min="1" max="${maxTickets > 0 ? maxTickets : 1}" value="1" ${maxTickets < 1 ? 'disabled' : ''} required>
      </div>

      <div class="ticket" style="margin:18px 0;background:#100d1f">
        <div style="font-weight:700;margin-bottom:10px;color:#c7aaff;letter-spacing:1px;font-size:.85rem;text-transform:uppercase">Billing Breakdown</div>
        <div class="row" style="padding:6px 0">
          <span>Tickets (<span id="bill-qty">1</span>x ${cash(price)})</span>
          <strong id="bill-subtotal">${cash(initialBilling.subtotal)}</strong>
        </div>
        <div class="row" style="padding:6px 0">
          <span>Booking & Convenience Fee (5%)</span>
          <strong id="bill-fee">${cash(initialBilling.fee)}</strong>
        </div>
        <div class="row" style="padding:10px 0 0;font-size:1.15rem;font-weight:800;border:0">
          <span>Total Billing Amount</span>
          <strong class="price" id="bill-total" style="font-size:1.35rem;color:#f39cff">${cash(initialBilling.total)}</strong>
        </div>
      </div>

      <div class="field">
        <label>Payment Method</label>
        <select class="input" name="payment_method" style="cursor:pointer">
          <option value="upi">UPI / QR Code (Instant Demo)</option>
          <option value="card">Debit / Credit Card</option>
          <option value="netbanking">Net Banking</option>
        </select>
      </div>

      <button id="book-btn" class="btn" style="width:100%;padding:14px;font-size:1.05rem;margin-top:12px" ${maxTickets < 1 ? 'disabled' : ''}>
        ${maxTickets < 1 ? 'Sold Out' : 'Pay & Confirm Reservation'}
      </button>
    </form>
    <p style="text-align:center;margin-top:14px"><small>Academic demo only · No actual payment charged</small></p>
  `;

  const qtyInput = $('#ticket-qty');
  const updateUiBilling = () => {
    let q = parseInt(qtyInput.value) || 1;
    if (q < 1) q = 1;
    if (q > maxTickets && maxTickets > 0) q = maxTickets;
    const b = calculateBilling(q);
    $('#bill-qty').textContent = q;
    $('#bill-subtotal').textContent = cash(b.subtotal);
    $('#bill-fee').textContent = cash(b.fee);
    $('#bill-total').textContent = cash(b.total);
    return { q, ...b };
  };

  qtyInput?.addEventListener('input', updateUiBilling);
  qtyInput?.addEventListener('change', updateUiBilling);

  $('#booking-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!me) {
      // Redirect to login page with return url so user can continue seamlessly
      const returnUrl = encodeURIComponent(location.pathname + location.search);
      location.href = `login.html?redirect=${returnUrl}`;
      return;
    }

    const { q, total } = updateUiBilling();
    const btn = $('#book-btn');
    btn.disabled = true;
    btn.textContent = 'Processing reservation...';

    try {
      const result = await api('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({ concertId: id, quantity: q })
      });

      location.href = `confirmation.html?ref=${encodeURIComponent(result.reference)}&total=${encodeURIComponent(result.total || total)}&title=${encodeURIComponent(c.title)}&qty=${q}`;
    } catch (err) {
      msg(err.message);
      btn.disabled = false;
      btn.textContent = 'Pay & Confirm Reservation';
    }
  });
}

async function renderBookings() {
  if (!me) {
    location.href = 'login.html?redirect=' + encodeURIComponent(location.pathname);
    return;
  }
  const list = await api('/api/bookings');
  const container = $('#bookings');
  if (!container) return;

  container.innerHTML = list.length
    ? list.map(b => `
        <div class="ticket" style="margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
            <h3 style="margin:0;font-size:1.3rem;color:#f39cff">${safe(b.title)}</h3>
            <span style="background:#281b45;border:1px solid #7042d7;padding:4px 10px;border-radius:8px;font-size:.8rem;color:#a3ffcf">✓ Confirmed</span>
          </div>
          <p style="margin:8px 0 12px">♫ ${safe(b.artist)} · ⌖ ${safe(b.venue)}, ${safe(b.city)}<br>📅 ${date(b.event_date)}</p>
          <div class="row"><span>Booking Reference</span><strong style="letter-spacing:1px;color:#a3ffcf">${safe(b.reference)}</strong></div>
          <div class="row"><span>Tickets Reserved</span><strong>${Number(b.quantity)}</strong></div>
          <div class="row"><span>Total Amount Paid</span><strong class="price">${cash(b.total)}</strong></div>
        </div>
      `).join('')
    : '<p>No bookings yet. <a href="concerts.html" class="btn" style="margin-top:10px">Explore concerts</a></p>';
}

function setupAdmin() {
  if (!me || me.role !== 'admin') {
    location.href = 'login.html';
    return;
  }
  $('#admin-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      await api('/api/admin/concerts', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      msg('Concert created successfully!', false);
      e.target.reset();
    } catch (err) {
      msg(err.message);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  init();

  const form = $('#auth-form');
  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button');
    if (btn) btn.disabled = true;

    const data = Object.fromEntries(new FormData(form));
    const page = document.body.dataset.page;
    try {
      await api('/api/auth/' + page, {
        method: 'POST',
        body: JSON.stringify(data)
      });
      // Redirect back to intended page if specified, otherwise index.html
      const redirect = new URLSearchParams(location.search).get('redirect') || 'index.html';
      location.href = redirect;
    } catch (err) {
      msg(err.message);
      if (btn) btn.disabled = false;
    }
  });

  if (document.body.dataset.page === 'confirmation') {
    const q = new URLSearchParams(location.search);
    const ref = q.get('ref') || '—';
    const total = q.get('total') || '0';
    const title = q.get('title') || '';
    const qty = q.get('qty') || '1';

    if ($('#ref')) $('#ref').textContent = ref;
    if ($('#total')) $('#total').textContent = cash(total);
    if ($('#conf-title') && title) $('#conf-title').textContent = title;
    if ($('#conf-qty')) $('#conf-qty').textContent = qty;
  }
});
