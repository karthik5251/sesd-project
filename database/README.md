# MongoDB database

The application creates the `concerthub` database and collections automatically when the Node.js server connects.

Collections:
- `users`
- `concerts`
- `bookings`
- `sessions` (created by connect-mongo)

Three sample concerts are inserted automatically on the first run when the `concerts` collection is empty.
