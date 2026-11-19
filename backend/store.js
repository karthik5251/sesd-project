const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

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

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Concert = mongoose.models.Concert || mongoose.model('Concert', concertSchema);
const Booking = mongoose.models.Booking || mongoose.model('Booking', bookingSchema);

const todayUtc = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

const concertOutput = c => ({
  id: String(c._id || c.id),
  title: c.title,
  artist: c.artist,
  venue: c.venue,
  city: c.city,
  event_date: new Date(c.eventDate).toISOString(),
  event_time: c.eventTime,
  price: c.price,
  available_tickets: c.availableTickets,
  description: c.description || '',
  status: c.status || 'active'
});

// In-memory collections used when MongoDB is not connected (e.g. serverless on Vercel)
const memoryStore = {
  users: [],
  concerts: [],
  bookings: [],
  initialized: false
};

async function seedMemoryStore() {
  if (memoryStore.initialized) return;
  memoryStore.initialized = true;

  const days = n => {
    const d = todayUtc();
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  };

  memoryStore.concerts = [
    {
      id: crypto.randomBytes(12).toString('hex'),
      title: 'Neon Nights Live',
      artist: 'The Midnight Echoes',
      venue: 'Gachibowli Stadium',
      city: 'Hyderabad',
      eventDate: days(20),
      eventTime: '19:00',
      price: 1499,
      availableTickets: 250,
      description: 'An electric night of synth-pop, live visuals and unforgettable music.',
      status: 'active'
    },
    {
      id: crypto.randomBytes(12).toString('hex'),
      title: 'Purple Sound Festival',
      artist: 'DJ Nova & Friends',
      venue: 'HITEX Exhibition Centre',
      city: 'Hyderabad',
      eventDate: days(35),
      eventTime: '18:30',
      price: 999,
      availableTickets: 500,
      description: 'A high-energy festival featuring electronic music, immersive lights and multiple live sets.',
      status: 'active'
    },
    {
      id: crypto.randomBytes(12).toString('hex'),
      title: 'Acoustic Under The Stars',
      artist: 'Mira & The Waves',
      venue: 'Shilpakala Vedika',
      city: 'Hyderabad',
      eventDate: days(48),
      eventTime: '19:30',
      price: 799,
      availableTickets: 180,
      description: 'An intimate evening of acoustic favourites and original songs.',
      status: 'active'
    }
  ];

  const passwordHash = await bcrypt.hash('admin123', 10);
  memoryStore.users.push({
    id: crypto.randomBytes(12).toString('hex'),
    name: 'Admin User',
    email: 'admin@concerthub.com',
    passwordHash,
    role: 'admin'
  });
}

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

const store = {
  isMongoConnected,

  async init(mongoUri) {
    if (mongoUri && !mongoUri.includes('none')) {
      try {
        await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 3000 });
        console.log('Connected to MongoDB.');
        // Seed mongo if needed
        const count = await Concert.countDocuments();
        if (count === 0) {
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
        }
        const existingAdmin = await User.findOne({ email: 'admin@concerthub.com' });
        if (!existingAdmin) {
          const passwordHash = await bcrypt.hash('admin123', 10);
          await User.create({ name: 'Admin User', email: 'admin@concerthub.com', passwordHash, role: 'admin' });
        }
        return;
      } catch (err) {
        console.warn('MongoDB connection failed, falling back to embedded in-memory database:', err.message);
      }
    }
    console.log('Running in embedded in-memory database mode (no external MongoDB required).');
    await seedMemoryStore();
  },

  async findUserByEmail(email) {
    const normalized = email.trim().toLowerCase();
    if (isMongoConnected()) {
      const u = await User.findOne({ email: normalized }).lean();
      if (!u) return null;
      return { id: String(u._id), name: u.name, email: u.email, passwordHash: u.passwordHash, role: u.role };
    }
    await seedMemoryStore();
    return memoryStore.users.find(u => u.email === normalized) || null;
  },

  async createUser({ name, email, passwordHash, role = 'user' }) {
    const normalized = email.trim().toLowerCase();
    if (isMongoConnected()) {
      const u = await User.create({ name: name.trim(), email: normalized, passwordHash, role });
      return { id: String(u._id), name: u.name, email: u.email, role: u.role };
    }
    await seedMemoryStore();
    const existing = memoryStore.users.find(u => u.email === normalized);
    if (existing) {
      const err = new Error('Email already registered.');
      err.code = 11000;
      throw err;
    }
    const user = {
      id: crypto.randomBytes(12).toString('hex'),
      name: name.trim(),
      email: normalized,
      passwordHash,
      role
    };
    memoryStore.users.push(user);
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  },

  async listActiveConcerts() {
    if (isMongoConnected()) {
      const list = await Concert.find({ eventDate: { $gte: todayUtc() }, status: 'active' }).sort({ eventDate: 1 });
      return list.map(concertOutput);
    }
    await seedMemoryStore();
    const minDate = todayUtc();
    return memoryStore.concerts
      .filter(c => c.status === 'active' && new Date(c.eventDate) >= minDate)
      .sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate))
      .map(concertOutput);
  },

  async getConcertById(id) {
    if (isMongoConnected()) {
      if (!mongoose.isValidObjectId(id)) return null;
      const c = await Concert.findOne({ _id: id, status: 'active' });
      return c ? concertOutput(c) : null;
    }
    await seedMemoryStore();
    const c = memoryStore.concerts.find(item => item.id === id && item.status === 'active');
    return c ? concertOutput(c) : null;
  },

  async bookTickets(concertId, quantity) {
    if (isMongoConnected()) {
      if (!mongoose.isValidObjectId(concertId)) return null;
      return await Concert.findOneAndUpdate(
        { _id: concertId, status: 'active', eventDate: { $gte: todayUtc() }, availableTickets: { $gte: quantity } },
        { $inc: { availableTickets: -quantity } },
        { new: true }
      );
    }
    await seedMemoryStore();
    const concert = memoryStore.concerts.find(c => c.id === concertId && c.status === 'active' && new Date(c.eventDate) >= todayUtc());
    if (!concert || concert.availableTickets < quantity) return null;
    concert.availableTickets -= quantity;
    return concert;
  },

  async refundTickets(concertId, quantity) {
    if (isMongoConnected()) {
      await Concert.updateOne({ _id: concertId }, { $inc: { availableTickets: quantity } });
      return;
    }
    const concert = memoryStore.concerts.find(c => c.id === concertId);
    if (concert) concert.availableTickets += quantity;
  },

  async createBooking({ userId, concertId, quantity, total, reference }) {
    if (isMongoConnected()) {
      return await Booking.create({
        userId,
        concertId,
        quantity,
        total,
        reference
      });
    }
    const booking = {
      id: crypto.randomBytes(12).toString('hex'),
      userId,
      concertId,
      quantity,
      total,
      reference,
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };
    memoryStore.bookings.push(booking);
    return booking;
  },

  async listUserBookings(userId) {
    if (isMongoConnected()) {
      const list = await Booking.find({ userId }).sort({ createdAt: -1 }).populate('concertId');
      return list.filter(b => b.concertId).map(b => ({
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
      }));
    }
    await seedMemoryStore();
    return memoryStore.bookings
      .filter(b => b.userId === userId)
      .map(b => {
        const concert = memoryStore.concerts.find(c => c.id === b.concertId) || {};
        return {
          id: b.id,
          reference: b.reference,
          quantity: b.quantity,
          total: b.total,
          status: b.status,
          created_at: b.createdAt,
          title: concert.title || 'Concert',
          artist: concert.artist || '',
          venue: concert.venue || '',
          city: concert.city || '',
          event_date: concert.eventDate ? new Date(concert.eventDate).toISOString() : new Date().toISOString()
        };
      })
      .reverse();
  },

  async createConcert(data) {
    if (isMongoConnected()) {
      const c = await Concert.create({
        title: data.title.trim(),
        artist: data.artist.trim(),
        venue: data.venue.trim(),
        city: data.city.trim(),
        eventDate: new Date(`${data.event_date}T00:00:00.000Z`),
        eventTime: data.event_time,
        price: data.price,
        availableTickets: data.available_tickets,
        description: String(data.description || '')
      });
      return { id: String(c._id) };
    }
    await seedMemoryStore();
    const newConcert = {
      id: crypto.randomBytes(12).toString('hex'),
      title: data.title.trim(),
      artist: data.artist.trim(),
      venue: data.venue.trim(),
      city: data.city.trim(),
      eventDate: new Date(`${data.event_date}T00:00:00.000Z`),
      eventTime: data.event_time,
      price: data.price,
      availableTickets: data.available_tickets,
      description: String(data.description || ''),
      status: 'active'
    };
    memoryStore.concerts.push(newConcert);
    return { id: newConcert.id };
  }
};

module.exports = store;
