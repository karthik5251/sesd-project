require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '32kb' }));

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/concerthub';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' }
}, { timestamps: true });

const concertSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 180 },
  artist: { type: String, required: true, trim: true, maxlength: 180 },
  venue: { type: String, required: true, trim: true, maxlength: 180 },
  city: { type: String, required: true, trim: true, maxlength: 100 },
  eventDate: { type: Date, required: true },
  eventTime: { type: String, required: true },
  price: { type: Number, required: true, min: 1 },
  availableTickets: { type: Number, required: true, min: 0, default: 0 },
  description: { type: String, default: '' },
  status: { type: String, enum: ['active', 'cancelled'], default: 'active' }
}, { timestamps: true });

const bookingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  concertId: { type: mongoose.Schema.Types.ObjectId, ref: 'Concert', required: true },
  quantity: { type: Number, required: true, min: 1, max: 10 },
  total: { type: Number, required: true, min: 0 },
  reference: { type: String, required: true, unique: true },
  status: { type: String, enum: ['confirmed', 'cancelled'], default: 'confirmed' }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Concert = mongoose.model('Concert', concertSchema);
const Booking = mongoose.model('Booking', bookingSchema);

app.use(session({
  name: 'ch.sid',
  secret: process.env.SESSION_SECRET || 'development-only-change-this-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: mongoUri, collectionName: 'sessions' }),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false
}));

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const requireUser = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: 'Please log in first.' });
const requireAdmin = (req, res, next) => req.session.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only.' });
const validId = id => mongoose.isValidObjectId(id);
const todayUtc = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
const concertOutput = c => ({
  id: String(c._id),
  title: c.title,
  artist: c.artist,
  venue: c.venue,
  city: c.city,
  event_date: c.eventDate.toISOString(),
  event_time: c.eventTime,
  price: c.price,
  available_tickets: c.availableTickets,
  description: c.description,
  status: c.status
});

app.get('/api/health', (req, res) => res.json({ ok: true, database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));
app.get('/api/me', (req, res) => res.json({ user: req.session.user || null }));

app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100 ||
      typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email) ||
      typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Enter a valid name, email and password (8+ characters).' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail }).lean();
  if (existing) return res.status(409).json({ error: 'Email already registered.' });

  const passwordHash = await bcrypt.hash(password, 12);
  let user;
  try {
    user = await User.create({ name: name.trim(), email: normalizedEmail, passwordHash });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Email already registered.' });
    throw err;
  }

  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not create login session.' });
    req.session.user = { id: String(user._id), name: user.name, role: user.role };
    req.session.save(saveErr => {
      if (saveErr) return res.status(500).json({ error: 'Could not save login session.' });
      res.status(201).json({ user: req.session.user });
    });
  });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Enter your email and password.' });
  }
  const user = await User.findOne({ email: email.trim().toLowerCase() });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not create login session.' });
    req.session.user = { id: String(user._id), name: user.name, role: user.role };
    req.session.save(saveErr => {
      if (saveErr) return res.status(500).json({ error: 'Could not save login session.' });
      res.json({ user: req.session.user });
    });
  });
}));

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Could not log out.' });
    res.clearCookie('ch.sid');
    res.json({ ok: true });
  });
});

app.get('/api/concerts', wrap(async (req, res) => {
  const concerts = await Concert.find({ eventDate: { $gte: todayUtc() }, status: 'active' }).sort({ eventDate: 1 });
  res.json(concerts.map(concertOutput));
}));

app.get('/api/concerts/:id', wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid concert ID.' });
  const concert = await Concert.findOne({ _id: req.params.id, status: 'active' });
  if (!concert) return res.status(404).json({ error: 'Concert not found.' });
  res.json(concertOutput(concert));
}));

app.post('/api/bookings', requireUser, wrap(async (req, res) => {
  const concertId = req.body?.concertId;
  const quantity = Number(req.body?.quantity);
  if (!validId(concertId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) {
    return res.status(400).json({ error: 'Choose 1–10 tickets for a valid concert.' });
  }

  // Atomic inventory decrement prevents two users booking the final ticket simultaneously.
  const concert = await Concert.findOneAndUpdate(
    { _id: concertId, status: 'active', eventDate: { $gte: todayUtc() }, availableTickets: { $gte: quantity } },
    { $inc: { availableTickets: -quantity } },
    { new: true }
  );
  if (!concert) return res.status(409).json({ error: 'Not enough tickets available, or this event has passed.' });

  const reference = 'CH' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const total = Number((concert.price * quantity).toFixed(2));
  try {
    await Booking.create({
      userId: req.session.user.id,
      concertId: concert._id,
      quantity,
      total,
      reference
    });
  } catch (err) {
    // Restore stock if booking record creation fails.
    await Concert.updateOne({ _id: concert._id }, { $inc: { availableTickets: quantity } });
    throw err;
  }
  res.status(201).json({ reference, total });
}));

app.get('/api/bookings', requireUser, wrap(async (req, res) => {
  const bookings = await Booking.find({ userId: req.session.user.id }).sort({ createdAt: -1 }).populate('concertId');
  res.json(bookings.filter(b => b.concertId).map(b => ({
    id: String(b._id),
    reference: b.reference,
    quantity: b.quantity,
    total: b.total,
    status: b.status,
    created_at: b.createdAt,
    title: b.concertId.title,
    artist: b.concertId.artist,
    venue: b.concertId.venue,
    city: b.concertId.city,
    event_date: b.concertId.eventDate.toISOString()
  })));
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
  const concert = await Concert.create({
    title: title.trim(), artist: artist.trim(), venue: venue.trim(), city: city.trim(),
    eventDate: new Date(`${event_date}T00:00:00.000Z`), eventTime: event_time,
    price: amount, availableTickets: stock, description: String(description || '')
  });
  res.status(201).json({ id: String(concert._id) });
}));

app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  if (err.name === 'ValidationError') return res.status(400).json({ error: 'Please check the submitted information.' });
  res.status(500).json({
    error: process.env.NODE_ENV === 'development'
      ? `Server error: ${err.message}`
      : 'Server error. Check the server terminal.'
  });
});

async function seedConcerts() {
  const count = await Concert.countDocuments();
  if (count > 0) return;
  const days = n => {
    const d = todayUtc();
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  };
  await Concert.insertMany([
    { title: 'Neon Nights Live', artist: 'The Midnight Echoes', venue: 'Gachibowli Stadium', city: 'Hyderabad', eventDate: days(20), eventTime: '19:00', price: 1499, availableTickets: 250, description: 'An electric night of synth-pop, live visuals and unforgettable music.' },
    { title: 'Purple Sound Festival', artist: 'DJ Nova & Friends', venue: 'HITEX Exhibition Centre', city: 'Hyderabad', eventDate: days(35), eventTime: '18:30', price: 999, availableTickets: 500, description: 'A high-energy festival featuring electronic music, immersive lights and multiple live sets.' },
    { title: 'Acoustic Under The Stars', artist: 'Mira & The Waves', venue: 'Shilpakala Vedika', city: 'Hyderabad', eventDate: days(48), eventTime: '19:30', price: 799, availableTickets: 180, description: 'An intimate evening of acoustic favourites and original songs.' }
  ]);
  console.log('Added 3 sample concerts to MongoDB.');
}

async function start() {
  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.');
    await seedConcerts();
    const port = Number(process.env.PORT) || 8080;
    app.listen(port, () => console.log(`ConcertHub running at http://localhost:${port}`));
  } catch (err) {
    console.error('Could not connect to MongoDB:', err.message);
    process.exit(1);
  }
}

start();
