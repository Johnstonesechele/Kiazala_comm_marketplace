const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dbDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = process.env.SQLITE_PATH || path.join(dbDir, "marketplace.sqlite");
const db = new Database(dbPath);

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  data BLOB NOT NULL,
  uploaded_by INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('buyer', 'seller', 'admin')),
  business_name TEXT,
  location TEXT,
  bio TEXT,
  language_pref TEXT DEFAULT 'en',
  verification_file_id INTEGER,
  is_approved INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY (verification_file_id) REFERENCES files(id)
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity_unit TEXT NOT NULL,
  price REAL NOT NULL,
  image_file_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY (seller_id) REFERENCES users(id),
  FOREIGN KEY (image_file_id) REFERENCES files(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id INTEGER NOT NULL,
  total REAL NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  delivery_location TEXT,
  FOREIGN KEY (buyer_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  listing_id INTEGER NOT NULL,
  seller_id INTEGER NOT NULL,
  listing_name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  price_at_purchase REAL NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (listing_id) REFERENCES listings(id),
  FOREIGN KEY (seller_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  listing_id INTEGER NOT NULL,
  buyer_id INTEGER NOT NULL,
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (listing_id) REFERENCES listings(id),
  FOREIGN KEY (buyer_id) REFERENCES users(id),
  UNIQUE(order_id, listing_id)
);

CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  seller_id INTEGER NOT NULL,
  buyer_id INTEGER NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (seller_id) REFERENCES users(id),
  FOREIGN KEY (buyer_id) REFERENCES users(id),
  UNIQUE(order_id, seller_id)
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL,
  recipient_id INTEGER NOT NULL,
  listing_id INTEGER,
  body TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (sender_id) REFERENCES users(id),
  FOREIGN KEY (recipient_id) REFERENCES users(id),
  FOREIGN KEY (listing_id) REFERENCES listings(id)
);
`);

// Safe migrations: add columns introduced after initial schema
const userCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userCols.includes("is_rejected")) {
  db.exec("ALTER TABLE users ADD COLUMN is_rejected INTEGER NOT NULL DEFAULT 0");
}
if (!userCols.includes("avatar_file_id")) {
  db.exec("ALTER TABLE users ADD COLUMN avatar_file_id INTEGER");
}
if (!userCols.includes("password_reset_token_hash")) {
  db.exec("ALTER TABLE users ADD COLUMN password_reset_token_hash TEXT");
}
if (!userCols.includes("password_reset_expires_at")) {
  db.exec("ALTER TABLE users ADD COLUMN password_reset_expires_at TEXT");
}

const listingCols = db.prepare("PRAGMA table_info(listings)").all().map((c) => c.name);
if (!listingCols.includes("stock")) {
  db.exec("ALTER TABLE listings ADD COLUMN stock INTEGER");
}

const orderCols = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
if (!orderCols.includes("delivery_location")) {
  db.exec("ALTER TABLE orders ADD COLUMN delivery_location TEXT");
}

const reviewCols = db.prepare("PRAGMA table_info(reviews)").all().map((c) => c.name);
if (!reviewCols.includes("listing_id")) {
  db.exec("ALTER TABLE reviews ADD COLUMN listing_id INTEGER");
}

module.exports = db;
