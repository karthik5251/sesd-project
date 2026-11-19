require('dotenv').config();

const express = require('express');
const cookieSession = require('cookie-session');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const path = require('path');
const store = require('./store');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '32kb' }));

// Cookie-session allows authentication to work seamlessly across serverless functions,
// local development, and production without requiring an external Redis or MongoDB session store.
app.use(cookieSession({
  name: 'ch.sid',
  keys: [process.env.SESSION_SECRET || 'concerthub-secret-key-12345'],
  maxAge: 24 * 60 * 60 * 1000,
  sameSite: 'lax',
  secure: false, // Ensures session cookies work on localhost as well as HTTPS proxies
  httpOnly: true
}));

// Compatibility middleware for session save / regenerate
app.use((req, res, next) => {
  if (req.session && !req.session.regenerate) {
    req.session.regenerate = cb => cb && cb(null);
  }
  if (req.session && !req.session.save) {
    req.session.save = cb => cb && cb(null);
  }
  next();
});

const isServerless = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME;
if (!isServerless) {
  app.use('/api/auth', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 50,
    standardHeaders: 'draft-7',
    legacyHeaders: false
  }));
}

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const requireUser = (req, res, next) => req.session?.user ? next() : res.status(401).json({ error: 'Please log in first to continue.' });
const requireAdmin = (req, res, next) => req.session?.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only.' });

app.get('/api/health', (req, res) => res.json({
  ok: true,
  mode: store.isMongoConnected() ? 'mongodb' : 'embedded-memory'
}));

app.get('/api/me', (req, res) => res.json({ user: req.session?.user || null }));

app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100 ||
      typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email.trim()) ||
      typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Enter a valid name, email and password (8+ characters).' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await store.findUserByEmail(normalizedEmail);
  if (existing) return res.status(409).json({ error: 'Email already registered.' });

  const passwordHash = await bcrypt.hash(password, 12);
  let user;
  try {
    user = await store.createUser({ name: name.trim(), email: normalizedEmail, passwordHash });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Email already registered.' });
    throw err;
  }

  req.session.user = { id: String(user.id), name: user.name, role: user.role };
  res.status(201).json({ user: req.session.user });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ error: 'Enter your email and password.' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const user = await store.findUserByEmail(normalizedEmail);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  req.session.user = { id: String(user.id), name: user.name, role: user.role };
  res.json({ user: req.session.user });
}));

app.post('/api/auth/logout', (req, res) => {
  req.session = null;
  res.clearCookie('ch.sid');
  res.json({ ok: true });
});

app.get('/api/concerts', wrap(async (req, res) => {
  const concerts = await store.listActiveConcerts();
  res.json(concerts);
}));

app.get('/api/concerts/:id', wrap(async (req, res) => {
  const concert = await store.getConcertById(req.params.id);
  if (!concert) return res.status(404).json({ error: 'Concert not found.' });
  res.json(concert);
}));

app.post('/api/bookings', requireUser, wrap(async (req, res) => {
  const concertId = req.body?.concertId;
  const quantity = Number(req.body?.quantity);
  if (!concertId || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) {
    return res.status(400).json({ error: 'Choose 1–10 tickets for a valid concert.' });
  }

  const concert = await store.bookTickets(concertId, quantity);
  if (!concert) return res.status(409).json({ error: 'Not enough tickets available, or this event has passed.' });

  const reference = 'CH' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const subtotal = Number((concert.price * quantity).toFixed(2));
  const fee = Number((subtotal * 0.05).toFixed(2));
  const total = Number((subtotal + fee).toFixed(2));

  try {
    await store.createBooking({
      userId: req.session.user.id,
      concertId: concert._id ? String(concert._id) : concert.id,
      quantity,
      total,
      reference
    });
  } catch (err) {
    await store.refundTickets(concertId, quantity);
    throw err;
  }
  res.status(201).json({ reference, total, quantity });
}));

app.get('/api/bookings', requireUser, wrap(async (req, res) => {
  const bookings = await store.listUserBookings(req.session.user.id);
  res.json(bookings);
}));

app.post('/api/admin/concerts', requireUser, requireAdmin, wrap(async (req, res) => {
  const { title, artist, venue, city, event_date, event_time, price, available_tickets, description } = req.body || {};
  const amount = Number(price);
  const stock = Number(available_tickets);
  if ([title, artist, venue, city, event_date, event_time].some(v => typeof v !== 'string' || !v.trim()) ||
      !Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(stock) || stock < 0 ||
      Number.isNaN(new Date(`${event_date}T00:00:00.000Z`).getTime())) {
    return res.status(400).json({ error: 'Complete all concert fields with valid values.' });
  }

  const result = await store.createConcert({
    title, artist, venue, city,
    event_date, event_time,
    price: amount,
    available_tickets: stock,
    description
  });
  res.status(201).json(result);
}));

const frontendDir = path.join(process.cwd(), 'frontend');
app.use(express.static(frontendDir));
app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));

app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  if (err.name === 'ValidationError') return res.status(400).json({ error: 'Please check the submitted information.' });
  res.status(500).json({
    error: process.env.NODE_ENV === 'development'
      ? `Server error: ${err.message}`
      : 'Server error. Check the server terminal.'
  });
});

module.exports = app;
