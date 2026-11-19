require('dotenv').config();
const app = require('./app');
const store = require('./store');

async function start() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    await store.init(mongoUri);

    const port = Number(process.env.PORT) || 8080;
    app.listen(port, () => {
      console.log(`ConcertHub running at http://localhost:${port}`);
      console.log(`Database mode: ${store.isMongoConnected() ? 'MongoDB' : 'Embedded In-Memory'}`);
      console.log(`Default admin account: admin@concerthub.com (password: admin123)`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
