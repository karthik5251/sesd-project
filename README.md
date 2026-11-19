# ConcertHub — MongoDB Edition (No PHP, No MySQL)

ConcertHub is a student-project concert ticket booking website built with HTML, CSS, JavaScript, Node.js, Express and MongoDB.

## Requirements
- Node.js LTS
- MongoDB Community Server running locally, OR a MongoDB Atlas cluster
- VS Code (optional)

## Setup on Windows

1. Extract this ZIP.
2. Open the **inner `ConcertHub-MongoDB` folder** in VS Code (the folder containing `package.json`).
3. Install Node.js LTS if not already installed.
4. Install/start MongoDB Community Server locally, or create a MongoDB Atlas cluster.
5. Copy `.env.example` to `.env`.
6. Set `MONGODB_URI` in `.env`:
   - Local MongoDB: `mongodb://127.0.0.1:27017/concerthub`
   - Atlas: paste your own MongoDB Atlas connection string, replacing the username, password and database name. Do not share this URI.
7. Set a long random `SESSION_SECRET`.
8. In the VS Code terminal run:
   ```powershell
   npm.cmd install
   npm.cmd start
   ```
9. Wait for `Connected to MongoDB.` and `ConcertHub running at http://localhost:8080`.
10. Open `http://localhost:8080` in Chrome.

**Do not use Live Server or `http://localhost/ConcertHub/`.** Node/Express serves both the website and API at port 8080. Apache and XAMPP are not required.

## MongoDB Atlas quick setup
1. Create a free cluster at https://www.mongodb.com/atlas.
2. Create a database user and password.
3. Add your current IP address to Network Access (for a local development setup).
4. Choose Connect → Drivers → Node.js and copy the connection string.
5. Put it in `.env` as `MONGODB_URI=...`. URL-encode special characters in the database password.
6. Restart the Node server.

## Admin access
1. Register an account in ConcertHub.
2. Open MongoDB Compass or `mongosh` and connect to the same database.
3. Run the following, replacing the email with your registered email:
   ```javascript
   use concerthub
   db.users.updateOne(
     { email: "your-email@example.com" },
     { $set: { role: "admin" } }
   )
   ```
   For Atlas, select the `concerthub` database in the connected cluster before running the update.
4. Log out and log back in. The Admin link will appear.

## Features
- Responsive dark purple neon UI
- Concert listing and search
- User registration/login with bcrypt password hashing
- Session storage in MongoDB
- Concert details and booking
- Atomic ticket stock decrement to reduce overselling
- Booking history and confirmation
- Admin concert creation
- Sample concerts seeded automatically on first start

## GitHub
Run from the project root (where `package.json` is located):
```bash
git init
git add .
git commit -m "ConcertHub MongoDB version"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/ConcertHub.git
git push -u origin main
```

## Notes
- This is an academic demo. Booking is a reservation only: no payment is charged and no valid venue-entry QR ticket is issued.
- Never commit `.env` or publish database credentials.
- For production, configure HTTPS, secure session secrets, CSRF protection, input validation, rate limiting, backups, payment verification and monitoring.
