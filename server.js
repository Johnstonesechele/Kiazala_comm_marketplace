// ...imports and app initialization...
// --- Imports and config ---
require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const db = require("./lib/sqlite");
const PDFDocument = require("pdfkit");
const { createToken, requireAuth } = require("./lib/auth");
const { requireRole } = require("./lib/rbac");
const { promptGemini, promptGeminiMultimodal } = require("./lib/gemini");

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "replace-with-a-strong-secret") {
  if (!process.env.JWT_SECRET) {
    console.error("Missing JWT_SECRET. Set JWT_SECRET in .env");
    process.exit(1);
  }
  console.warn("WARNING: JWT_SECRET is set to the default placeholder. Change it for production.");
}

// --- Express app setup ---
const app = express();
const PORT = Number(process.env.PORT || 3000);
app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// --- Helper functions (keep these above endpoints) ---
function nowIso() {
  return new Date().toISOString();
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    businessName: row.business_name,
    location: row.location,
    bio: row.bio,
    languagePref: row.language_pref,
    verificationFileId: row.verification_file_id,
    avatarFileId: row.avatar_file_id || null,
    avatarUrl: row.avatar_file_id ? `/api/files/${row.avatar_file_id}` : null,
    isApproved: Boolean(row.is_approved),
    isRejected: Boolean(row.is_rejected),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapListing(row) {
  if (!row) return null;
  return {
    id: row.id,
    sellerId: row.seller_id,
    name: row.name,
    description: row.description,
    category: row.category,
    quantityUnit: row.quantity_unit,
    price: row.price,
    stock: row.stock !== undefined ? row.stock : null,
    imageFileId: row.image_file_id,
    imageUrl: row.image_file_id ? `/api/files/${row.image_file_id}` : "",
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// --- Seed default accounts if missing ---
function ensureAdminSeed() {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (admin) return;
  const hash = bcrypt.hashSync("Admin@1234", 10);
  db.prepare(
    `INSERT INTO users (name, email, password_hash, role, is_approved, created_at)
     VALUES (?, ?, ?, 'admin', 1, ?)`
  ).run("Marketplace Admin", "admin@kiazala.local", hash, nowIso());
  console.log("✓ Seeded admin account: admin@kiazala.local / Admin@1234");
}

function ensureSeedAccounts() {
  ensureAdminSeed();
  // Seed buyer account
  const buyerEmail = "buyer@test.com";
  const buyer = db.prepare("SELECT id FROM users WHERE email = ?").get(buyerEmail);
  if (!buyer) {
    const hash = bcrypt.hashSync("Buyer@1234", 10);
    db.prepare(
      `INSERT INTO users (name, email, password_hash, role, location, is_approved, created_at)
       VALUES (?, ?, ?, 'buyer', ?, 1, ?)`
    ).run("Test Buyer", buyerEmail, hash, "Nairobi, Kenya", nowIso());
    console.log("✓ Seeded buyer account: buyer@test.com / Buyer@1234");
  }
  // Seed seller account
  const sellerEmail = "seller@test.com";
  const seller = db.prepare("SELECT id FROM users WHERE email = ?").get(sellerEmail);
  if (!seller) {
    const hash = bcrypt.hashSync("Seller@1234", 10);
    db.prepare(
      `INSERT INTO users (name, email, password_hash, role, business_name, location, is_approved, created_at)
       VALUES (?, ?, ?, 'seller', ?, ?, 1, ?)`
    ).run("Test Seller", sellerEmail, hash, "Test Seller Shop", "Nairobi, Kenya", nowIso());
    console.log("✓ Seeded seller account: seller@test.com / Seller@1234");
  }
}

// Call seeding at startup
ensureSeedAccounts();

// --- All endpoints and routes go below this line ---
// Seller approves payment for an order
app.post("/api/orders/:id/confirm-payment", requireAuth, requireRole("seller"), (req, res) => {
  const orderId = Number(req.params.id);
  // Only allow if seller has items in this order
  const sellerId = req.auth.sub;
  const sellerItem = db.prepare("SELECT id FROM order_items WHERE order_id = ? AND seller_id = ? LIMIT 1").get(orderId, sellerId);
  if (!sellerItem) return res.status(403).json({ error: "You can only approve payment for orders you sold." });
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.status === "PAID") return res.status(400).json({ error: "Order already marked as paid." });
  db.prepare("UPDATE orders SET status = 'PAID' WHERE id = ?").run(orderId);
  return res.json({ success: true });
});
// Store ratings endpoint
app.post("/api/ratings", requireAuth, requireRole("buyer"), (req, res) => {
  const { orderId, sellerId, rating } = req.body;
  const ordId = Number(orderId);
  const selId = Number(sellerId);
  const score = Number(rating);
  if (!ordId || !selId || !score) {
    return res.status(400).json({ error: "orderId, sellerId, and rating are required" });
  }
  if (score < 1 || score > 5) {
    return res.status(400).json({ error: "rating must be between 1 and 5" });
  }
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND buyer_id = ?").get(ordId, req.auth.sub);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.status !== "ARRIVED_CONFIRMED") {
    return res.status(403).json({ error: "Rating allowed only after arrival confirmation" });
  }
  const sellerInOrder = db
    .prepare("SELECT id FROM order_items WHERE order_id = ? AND seller_id = ? LIMIT 1")
    .get(ordId, selId);
  if (!sellerInOrder) {
    return res.status(403).json({ error: "You can only rate sellers included in that order" });
  }
  const already = db.prepare("SELECT id FROM ratings WHERE order_id = ? AND seller_id = ?").get(ordId, selId);
  if (already) {
    return res.status(409).json({ error: "Rating already submitted for this seller and order" });
  }
  const info = db
    .prepare(
      `INSERT INTO ratings (order_id, seller_id, buyer_id, rating, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(ordId, selId, req.auth.sub, score, nowIso());
  const ratingRow = db.prepare("SELECT * FROM ratings WHERE id = ?").get(info.lastInsertRowid);
  return res.status(201).json({ rating: ratingRow });
});

// Generate and download PDF receipt for an order
app.get("/api/orders/:id/receipt", requireAuth, (req, res) => {
  const orderId = Number(req.params.id);
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!order) return res.status(404).json({ error: "Order not found" });

  // Fetch order items for this order
  const items = db.prepare(`
    SELECT oi.*, l.name AS listing_name, u.name AS seller_name
    FROM order_items oi
    JOIN listings l ON oi.listing_id = l.id
    JOIN users u ON oi.seller_id = u.id
    WHERE oi.order_id = ?
  `).all(orderId);
  if (!items || items.length === 0) return res.status(404).json({ error: "No items found for this order" });

  // Access control: buyer who placed order or seller included in order items
  const isBuyer = order.buyer_id === req.auth.sub;
  const isSeller = items.some((item) => item.seller_id === req.auth.sub);
  if (!isBuyer && !isSeller) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // Use the first item's seller as the store for this receipt (single-store orders)
  const storeName = items[0].seller_name;
  const siteName = "Kiazala Marketplace";
  const doc = new PDFDocument({ margin: 40 });
  const badge = isBuyer ? "BUYER" : "SELLER";
  let filename = `receipt_order_${orderId}.pdf`;
  filename = encodeURIComponent(filename);
  res.setHeader("Content-disposition", `attachment; filename=\"${filename}\"`);
  res.setHeader("Content-type", "application/pdf");
  doc.pipe(res);

  // Header with site branding
  doc.rect(0, 0, doc.page.width, 60).fill('#2d3a4a');
  doc.fillColor('#fff').fontSize(24).font('Helvetica-Bold').text(siteName, 0, 18, { align: 'center' });
  doc.moveDown(2);
  doc.fillColor('#222').fontSize(18).font('Helvetica-Bold').text('Order Receipt', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(14).font('Helvetica').fillColor('#444').text('Welcome again! Thank you for shopping with us.', { align: 'center' });
  doc.moveDown(1);

  // Viewer role badge
  doc.save();
  doc.rect(doc.page.width - 120, 70, 100, 40).fill('#4a90e2');
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#fff').text(badge, doc.page.width - 120, 80, {
    width: 100,
    align: 'center'
  });
  doc.restore();

  // Order details
  doc.fontSize(12).fillColor('#222').text(`Order ID: ${orderId}`);
  doc.text(`Store: ${storeName}`);
  doc.text(`Date: ${new Date(order.created_at).toLocaleString()}`);
  doc.text(`Delivery Location: ${order.delivery_location}`);
  doc.moveDown(1);

  // Products table
  doc.fontSize(14).font('Helvetica-Bold').fillColor('#2d3a4a').text('Products', { align: 'left' });
  doc.moveDown(0.5);

  // Table styling
  const tableTop = doc.y;
  const colX = [40, 220, 300, 400, 520]; // wider columns for price/subtotal
  const rowHeight = 28; // increased row height
  doc.fontSize(13).font('Helvetica-Bold').fillColor('#fff');
  doc.rect(colX[0], tableTop, colX[4]-colX[0], rowHeight).fill('#4a90e2');
  doc.fillColor('#fff').text('Product', colX[0]+10, tableTop+8, { width: colX[1]-colX[0]-20 });
  doc.text('Qty', colX[1]+10, tableTop+8, { width: colX[2]-colX[1]-20 });
  doc.text('Price', colX[2]+10, tableTop+8, { width: colX[3]-colX[2]-20 });
  doc.text('Subtotal', colX[3]+10, tableTop+8, { width: colX[4]-colX[3]-20 });

  let total = 0;
  let rowY = tableTop + rowHeight;
  items.forEach((item, idx) => {
    const subtotal = item.qty * item.price_at_purchase;
    total += subtotal;
    // Alternate row color
    doc.rect(colX[0], rowY, colX[4]-colX[0], rowHeight).fill(idx % 2 === 0 ? '#f5f7fa' : '#eaf1fb');
    doc.fillColor('#222').font('Helvetica').fontSize(13);
    doc.text(item.listing_name, colX[0]+10, rowY+8, { width: colX[1]-colX[0]-20 });
    doc.text(String(item.qty), colX[1]+10, rowY+8, { width: colX[2]-colX[1]-20 });
    doc.text(`KES ${item.price_at_purchase.toFixed(2)}`, colX[2]+10, rowY+8, { width: colX[3]-colX[2]-20 });
    doc.text(`KES ${subtotal.toFixed(2)}`, colX[3]+10, rowY+8, { width: colX[4]-colX[3]-20 });
    rowY += rowHeight;
  });

  doc.moveDown(2);
  doc.fontSize(15).font('Helvetica-Bold').fillColor('#2d3a4a').text(`Total: KES ${total.toFixed(2)}`, { align: 'right' });

  // If paid, add stamp
  if (order.status === 'PAID') {
    // Draw a circular stamp with text
    const stampX = doc.page.width / 2 - 60;
    const stampY = doc.page.height / 2 + 60;
    doc.save();
    doc.circle(stampX + 60, stampY, 60).lineWidth(4).stroke('#4a90e2');
    doc.fillColor('#4a90e2').font('Helvetica-Bold').fontSize(22).text('PAID', stampX + 20, stampY - 18, { width: 80, align: 'center' });
    doc.fontSize(12).fillColor('#2d3a4a').text('KIAZALA', stampX + 20, stampY + 10, { width: 80, align: 'center' });
    doc.restore();
  }

  // Footer at the very bottom
  const footerY = doc.page.height - 60;
  doc.fontSize(12).font('Helvetica').fillColor('#888');
  doc.text('Thank you for using Kiazala Marketplace. For support, visit kiazala.local.', 0, footerY, {
    align: 'center', width: doc.page.width
  });

  doc.end();
});

// const { createToken, requireAuth } = require("./lib/auth");
// const { requireRole } = require("./lib/rbac");
// const { promptGemini } = require("./lib/gemini");



app.post("/api/auth/register", upload.single("verificationDocument"), async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role,
      businessName = "",
      location = "",
      bio = "",
      languagePref = "en"
    } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: "name, email, password, and role are required" });
    }

    if (!["buyer", "seller"].includes(role)) {
      return res.status(400).json({ error: "role must be buyer or seller" });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
    if (exists) {
      return res.status(409).json({ error: "Email is already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const verificationFileId = role === "seller" ? saveFile(req.file, null) : null;

    const info = db
      .prepare(
        `INSERT INTO users
          (name, email, password_hash, role, business_name, location, bio, language_pref, verification_file_id, is_approved, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        name,
        normalizedEmail,
        passwordHash,
        role,
        role === "seller" ? businessName : null,
        role === "seller" ? location : null,
        role === "seller" ? bio : null,
        languagePref,
        verificationFileId,
        role === "seller" ? 0 : 1,
        nowIso()
      );

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);

    return res.status(201).json({
      user: mapUser(user),
      message: role === "seller" ? "Seller registered. Waiting for admin approval." : "Account created."
    });
  } catch (err) {
    console.error("[register error]", err);
    return res.status(500).json({ error: "Could not create account" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizedEmail);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const mapped = mapUser(user);
  const token = createToken(mapped);
  return res.json({ token, user: mapped });
});

function getAuthUser(req) {
  // req.auth.sub is set by requireAuth middleware (user id from JWT)
  if (!req.auth || !req.auth.sub) return null;
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.auth.sub);
  return mapUser(row);
}
app.get("/api/auth/me", requireAuth, (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "User not found" });
  return res.json({ user });
});

app.patch("/api/users/me", requireAuth, (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "User not found" });

  const updates = {
    name: req.body.name ?? user.name,
    location: req.body.location ?? user.location,
    bio: req.body.bio ?? user.bio,
    languagePref: req.body.languagePref ?? user.languagePref,
    businessName: req.body.businessName ?? user.businessName
  };

  db.prepare(
    `UPDATE users
      SET name = ?, location = ?, bio = ?, language_pref = ?, business_name = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    updates.name,
    updates.location,
    updates.bio,
    updates.languagePref,
    updates.businessName,
    nowIso(),
    user.id
  );

  const latest = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
  return res.json({ user: mapUser(latest) });
});

app.get("/api/listings", (req, res) => {
  const { q, category, maxPrice, sellerId } = req.query;

  let sql = `SELECT l.*, u.name AS seller_name, u.business_name, u.location,
              ROUND(AVG(r.rating), 2) AS average_rating,
              COUNT(r.id) AS review_count
       FROM listings l
       JOIN users u ON u.id = l.seller_id
       LEFT JOIN reviews r ON r.seller_id = l.seller_id
       WHERE l.is_active = 1`;
  const params = [];

  if (category) { sql += " AND l.category = ?"; params.push(category); }
  if (maxPrice) { sql += " AND l.price <= ?"; params.push(Number(maxPrice)); }
  if (sellerId) { sql += " AND l.seller_id = ?"; params.push(Number(sellerId)); }
  if (q) {
    sql += " AND (l.name LIKE ? OR l.description LIKE ? OR u.name LIKE ? OR u.business_name LIKE ?)";
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  sql += " GROUP BY l.id ORDER BY l.created_at DESC";

  const rows = db.prepare(sql).all(...params);

  const listings = rows.map((row) => ({
    ...mapListing(row),
    seller: {
      id: row.seller_id,
      name: row.business_name || row.seller_name,
      location: row.location || ""
    },
    averageRating: row.average_rating !== null ? Number(row.average_rating) : null,
    reviewCount: Number(row.review_count || 0)
  }));

  return res.json({ listings });
});

app.get("/api/listings/mine", requireAuth, requireRole("seller"), (req, res) => {
  const user = getAuthUser(req);
  const rows = db.prepare("SELECT * FROM listings WHERE seller_id = ? ORDER BY created_at DESC").all(user.id);
  return res.json({ listings: rows.map(mapListing), isApproved: user.isApproved });
});

app.post(
  "/api/listings",
  requireAuth,
  requireRole("seller"),
  upload.single("image"),
  (req, res) => {
    const user = getAuthUser(req);
    if (!user.isApproved) {
      return res.status(403).json({ error: "Seller account is pending approval" });
    }

    const { name, description, category, quantityUnit, price, stock } = req.body;
    if (!name || !description || !category || !quantityUnit || !price) {
      return res.status(400).json({ error: "Missing required listing fields" });
    }

    const stockVal = (stock !== undefined && stock !== "") ? Number(stock) : null;
    const imageFileId = saveFile(req.file, user.id);
    const info = db
      .prepare(
        `INSERT INTO listings
          (seller_id, name, description, category, quantity_unit, price, stock, image_file_id, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
      )
      .run(user.id, name, description, category, quantityUnit, Number(price), stockVal, imageFileId, nowIso());

    const listing = db.prepare("SELECT * FROM listings WHERE id = ?").get(info.lastInsertRowid);
    return res.status(201).json({ listing: mapListing(listing) });
  }
);


app.patch("/api/listings/:id", requireAuth, requireRole("seller"), (req, res) => {
  const id = Number(req.params.id);
  const user = getAuthUser(req);

  const listing = db
    .prepare("SELECT * FROM listings WHERE id = ? AND seller_id = ?")
    .get(id, user.id);

  if (!listing) return res.status(404).json({ error: "Listing not found" });

  db.prepare(
    `UPDATE listings
      SET name = ?, description = ?, category = ?, quantity_unit = ?, price = ?, stock = ?, is_active = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    req.body.name ?? listing.name,
    req.body.description ?? listing.description,
    req.body.category ?? listing.category,
    req.body.quantityUnit ?? listing.quantity_unit,
    req.body.price !== undefined ? Number(req.body.price) : listing.price,
    req.body.stock !== undefined ? (req.body.stock === null ? null : Number(req.body.stock)) : listing.stock,
    req.body.isActive !== undefined ? (req.body.isActive ? 1 : 0) : listing.is_active,
    nowIso(),
    id
  );

  const updated = db.prepare("SELECT * FROM listings WHERE id = ?").get(id);
  return res.json({ listing: mapListing(updated) });
});

app.delete("/api/listings/:id", requireAuth, requireRole("seller"), (req, res) => {
  const id = Number(req.params.id);
  const user = getAuthUser(req);

  const listing = db.prepare("SELECT * FROM listings WHERE id = ? AND seller_id = ?").get(id, user.id);
  if (!listing) return res.status(404).json({ error: "Listing not found" });

  // Check if there are active orders for this listing
  const activeOrderItem = db
    .prepare(
      `SELECT oi.id FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.listing_id = ? AND o.status = 'PLACED'
       LIMIT 1`
    )
    .get(id);
  if (activeOrderItem) {
    return res.status(400).json({ error: "Cannot delete listing with pending orders. Deactivate it instead." });
  }

  db.prepare("UPDATE listings SET is_active = 0, updated_at = ? WHERE id = ?").run(nowIso(), id);
  db.prepare("DELETE FROM listings WHERE id = ? AND seller_id = ?").run(id, user.id);
  return res.json({ message: "Listing deleted" });
});

app.post("/api/orders", requireAuth, requireRole("buyer"), (req, res) => {
    console.log("[Order POST] req.body:", req.body);
  const buyer = getAuthUser(req);
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  // Accept both 'deliveryLocation' and 'location' from frontend, but require a non-empty value
  let deliveryLocation = "";
  if (typeof req.body.deliveryLocation === "string" && req.body.deliveryLocation.trim()) {
    deliveryLocation = req.body.deliveryLocation.trim();
  } else if (typeof req.body.location === "string" && req.body.location.trim()) {
    deliveryLocation = req.body.location.trim();
  }
  if (items.length === 0) return res.status(400).json({ error: "Order items are required" });
  if (!deliveryLocation) return res.status(400).json({ error: "Delivery location is required and must be non-empty" });

  const listingsById = new Map();
  for (const item of items) {
    const listing = db
      .prepare("SELECT * FROM listings WHERE id = ? AND is_active = 1")
      .get(Number(item.listingId));
    if (!listing) {
      return res.status(400).json({ error: "One or more listing items are invalid" });
    }
    listingsById.set(Number(item.listingId), listing);
  }

  const normalized = items.map((item) => {
    const listing = listingsById.get(Number(item.listingId));
    const qty = Math.max(1, Number(item.qty || 1));
    return {
      listingId: listing.id,
      sellerId: listing.seller_id,
      listingName: listing.name,
      qty,
      priceAtPurchase: listing.price
    };
  });

  const total = normalized.reduce((sum, i) => sum + i.qty * i.priceAtPurchase, 0);

  const tx = db.transaction(() => {
    const orderInfo = db
      .prepare(
        `INSERT INTO orders (buyer_id, total, status, created_at, delivery_location)
         VALUES (?, ?, 'PLACED', ?, ?)`
      )
      .run(buyer.id, Number(total.toFixed(2)), nowIso(), deliveryLocation);

    const orderId = Number(orderInfo.lastInsertRowid);
    const insertItem = db.prepare(
      `INSERT INTO order_items (order_id, listing_id, seller_id, listing_name, qty, price_at_purchase)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    for (const item of normalized) {
      insertItem.run(orderId, item.listingId, item.sellerId, item.listingName, item.qty, item.priceAtPurchase);
    }

    return orderId;
  });

  const orderId = tx();
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  return res.status(201).json({ order });
});

app.get("/api/orders/mine", requireAuth, requireRole("buyer"), (req, res) => {
  const orders = db.prepare("SELECT * FROM orders WHERE buyer_id = ? ORDER BY created_at DESC").all(req.auth.sub);
  const itemStmt = db.prepare(
    `SELECT oi.*, COALESCE(u.business_name, u.name) AS seller_name
     FROM order_items oi
     JOIN users u ON u.id = oi.seller_id
     WHERE oi.order_id = ?`
  );

  const data = orders.map((order) => ({
    ...order,
    items: itemStmt.all(order.id)
  }));

  return res.json({ orders: data });
});

app.get("/api/orders/seller", requireAuth, requireRole("seller"), (req, res) => {
  const sellerId = req.auth.sub;

  const orders = db
    .prepare(
      `SELECT DISTINCT o.*, COALESCE(b.name, b.email) AS buyer_name
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN users b ON b.id = o.buyer_id
       WHERE oi.seller_id = ?
       ORDER BY o.created_at DESC`
    )
    .all(sellerId);

  const itemStmt = db.prepare("SELECT * FROM order_items WHERE order_id = ? AND seller_id = ?");

  const data = orders.map((order) => ({
    ...order,
    items: itemStmt.all(order.id, sellerId)
  }));

  return res.json({ orders: data });
});

app.post("/api/orders/:id/confirm-arrival", requireAuth, requireRole("buyer"), (req, res) => {
  const orderId = Number(req.params.id);
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND buyer_id = ?").get(orderId, req.auth.sub);
  if (!order) return res.status(404).json({ error: "Order not found" });

  if (order.status === "ARRIVED_CONFIRMED") {
    return res.status(400).json({ error: "Order already confirmed" });
  }

  db.prepare("UPDATE orders SET status = 'ARRIVED_CONFIRMED', confirmed_at = ? WHERE id = ?").run(nowIso(), orderId);
  const updated = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  return res.json({ order: updated });
});

app.get("/api/reviews/summary", (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id AS seller_id, COALESCE(u.business_name, u.name) AS seller_name,
              ROUND(AVG(r.rating), 2) AS average_rating,
              COUNT(r.id) AS review_count
       FROM users u
       LEFT JOIN reviews r ON r.seller_id = u.id
       WHERE u.role = 'seller'
       GROUP BY u.id
       HAVING COUNT(r.id) > 0
       ORDER BY average_rating DESC, review_count DESC`
    )
    .all();

  const recentStmt = db.prepare(
    `SELECT rating, comment, created_at
     FROM reviews
     WHERE seller_id = ?
     ORDER BY created_at DESC
     LIMIT 3`
  );

  const summaries = rows.map((row) => ({
    sellerId: row.seller_id,
    sellerName: row.seller_name,
    averageRating: Number(row.average_rating),
    reviewCount: Number(row.review_count),
    recent: recentStmt.all(row.seller_id)
  }));

  return res.json({ summaries });
});

app.get("/api/reviews/eligible-orders", requireAuth, requireRole("buyer"), (req, res) => {
  const orders = db
    .prepare("SELECT * FROM orders WHERE buyer_id = ? AND status = 'ARRIVED_CONFIRMED' ORDER BY created_at DESC")
    .all(req.auth.sub);

  const orderItems = db.prepare(
    `SELECT oi.*, COALESCE(u.business_name, u.name) AS seller_name
     FROM order_items oi
     JOIN users u ON u.id = oi.seller_id
     WHERE oi.order_id = ?`
  );
  const reviewedStmt = db.prepare("SELECT id FROM reviews WHERE order_id = ? AND seller_id = ?");

  const eligible = [];
  for (const order of orders) {
    const items = orderItems.all(order.id);
    const uniqueSellerIds = [...new Set(items.map((i) => i.seller_id))];
    const hasUnreviewed = uniqueSellerIds.some((sellerId) => !reviewedStmt.get(order.id, sellerId));
    if (hasUnreviewed) {
      eligible.push({
        ...order,
        items
      });
    }
  }

  return res.json({ orders: eligible });
});

app.post("/api/reviews", requireAuth, requireRole("buyer"), (req, res) => {
  const { orderId, listingId, comment } = req.body;
  const ordId = Number(orderId);
  const lstId = Number(listingId);
  if (!ordId || !lstId || !comment) {
    return res.status(400).json({ error: "orderId, listingId, and comment are required" });
  }
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND buyer_id = ?").get(ordId, req.auth.sub);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.status !== "ARRIVED_CONFIRMED") {
    return res.status(403).json({ error: "Review allowed only after arrival confirmation" });
  }
  const listingInOrder = db
    .prepare("SELECT id FROM order_items WHERE order_id = ? AND listing_id = ? LIMIT 1")
    .get(ordId, lstId);
  if (!listingInOrder) {
    return res.status(403).json({ error: "You can only review products included in that order" });
  }
  const already = db.prepare("SELECT id FROM reviews WHERE order_id = ? AND listing_id = ?").get(ordId, lstId);
  if (already) {
    return res.status(409).json({ error: "Review already submitted for this product and order" });
  }
  const info = db
    .prepare(
      `INSERT INTO reviews (order_id, listing_id, buyer_id, comment, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(ordId, lstId, req.auth.sub, comment, nowIso());
  const review = db.prepare("SELECT * FROM reviews WHERE id = ?").get(info.lastInsertRowid);
  return res.status(201).json({ review });
});

app.post("/api/feedback", requireAuth, requireRole("buyer"), (req, res) => {
  const message = String(req.body.message || "").trim();
  if (!message) return res.status(400).json({ error: "message is required" });

  db.prepare("INSERT INTO feedback (user_id, message, created_at) VALUES (?, ?, ?)").run(req.auth.sub, message, nowIso());
  return res.status(201).json({ message: "Feedback received" });
});

app.get("/api/admin/pending-sellers", requireAuth, requireRole("admin"), (req, res) => {
  const rows = db
    .prepare("SELECT * FROM users WHERE role = 'seller' AND is_approved = 0 AND is_rejected = 0 ORDER BY created_at ASC")
    .all();
  return res.json({ pending: rows.map(mapUser) });
});

app.post("/api/admin/sellers/:id/approve", requireAuth, requireRole("admin"), (req, res) => {
  const sellerId = Number(req.params.id);
  const seller = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'seller'").get(sellerId);
  if (!seller) return res.status(404).json({ error: "Seller not found" });

  db.prepare("UPDATE users SET is_approved = 1, is_rejected = 0, updated_at = ? WHERE id = ?").run(nowIso(), sellerId);
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(sellerId);
  return res.json({ seller: mapUser(updated) });
});

app.post("/api/admin/sellers/:id/reject", requireAuth, requireRole("admin"), (req, res) => {
  const sellerId = Number(req.params.id);
  const seller = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'seller'").get(sellerId);
  if (!seller) return res.status(404).json({ error: "Seller not found" });

  db.prepare("UPDATE users SET is_approved = 0, is_rejected = 1, updated_at = ? WHERE id = ?").run(nowIso(), sellerId);
  db.prepare("UPDATE listings SET is_active = 0, updated_at = ? WHERE seller_id = ?").run(nowIso(), sellerId);
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(sellerId);
  return res.json({ seller: mapUser(updated) });
});

app.get("/api/admin/dashboard", requireAuth, requireRole("admin"), (req, res) => {
  const counts = {
    users: db.prepare("SELECT COUNT(*) AS v FROM users").get().v,
    buyers: db.prepare("SELECT COUNT(*) AS v FROM users WHERE role = 'buyer'").get().v,
    sellers: db.prepare("SELECT COUNT(*) AS v FROM users WHERE role = 'seller'").get().v,
    pendingSellers: db.prepare("SELECT COUNT(*) AS v FROM users WHERE role = 'seller' AND is_approved = 0 AND is_rejected = 0").get().v,
    listings: db.prepare("SELECT COUNT(*) AS v FROM listings").get().v,
    activeListings: db.prepare("SELECT COUNT(*) AS v FROM listings WHERE is_active = 1").get().v,
    orders: db.prepare("SELECT COUNT(*) AS v FROM orders").get().v,
    reviews: db.prepare("SELECT COUNT(*) AS v FROM reviews").get().v,
    feedback: db.prepare("SELECT COUNT(*) AS v FROM feedback").get().v
  };

  const recentReviews = db
    .prepare(
      `SELECT r.id, r.rating, r.comment, r.created_at,
              COALESCE(s.business_name, s.name) AS seller_name,
              b.name AS buyer_name
       FROM reviews r
       JOIN users s ON s.id = r.seller_id
       JOIN users b ON b.id = r.buyer_id
       ORDER BY r.created_at DESC
       LIMIT 10`
    )
    .all();

  return res.json({ counts, recentReviews });
});

app.get("/api/admin/users", requireAuth, requireRole("admin"), (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.*, COUNT(l.id) AS listing_count, COUNT(o.id) AS order_count
       FROM users u
       LEFT JOIN listings l ON l.seller_id = u.id
       LEFT JOIN orders o ON o.buyer_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    )
    .all();
  return res.json({ users: rows.map((r) => ({ ...mapUser(r), listingCount: r.listing_count, orderCount: r.order_count })) });
});

app.get("/api/admin/feedback", requireAuth, requireRole("admin"), (req, res) => {
  const rows = db
    .prepare(
      `SELECT f.*, COALESCE(u.name, u.email) AS user_name, u.email AS user_email
       FROM feedback f
       JOIN users u ON u.id = f.user_id
       ORDER BY f.created_at DESC`
    )
    .all();
  return res.json({ feedback: rows });
});

app.delete("/api/admin/users/:id", requireAuth, requireRole("admin"), (req, res) => {
  const userId = Number(req.params.id);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.role === "admin") return res.status(403).json({ error: "Cannot delete admin accounts" });

  // Deactivate listings first
  db.prepare("UPDATE listings SET is_active = 0 WHERE seller_id = ?").run(userId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  return res.json({ message: "User deleted" });
});

app.get("/api/admin/db-schema", requireAuth, requireRole("admin"), (req, res) => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  const schema = {};
  for (const table of tables) {
    schema[table.name] = db.prepare(`PRAGMA table_info(${table.name})`).all();
  }
  return res.json({ schema });
});

app.get("/api/admin/listings", requireAuth, requireRole("admin"), (req, res) => {
  const rows = db
    .prepare(
      `SELECT l.*, COALESCE(u.business_name, u.name) AS seller_name
       FROM listings l
       JOIN users u ON u.id = l.seller_id
       ORDER BY l.created_at DESC`
    )
    .all();
  return res.json({ listings: rows.map((r) => ({ ...mapListing(r), sellerName: r.seller_name })) });
});

app.patch("/api/admin/listings/:id", requireAuth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const listing = db.prepare("SELECT * FROM listings WHERE id = ?").get(id);
  if (!listing) return res.status(404).json({ error: "Listing not found" });

  if (req.body.isActive !== undefined) {
    db.prepare("UPDATE listings SET is_active = ?, updated_at = ? WHERE id = ?").run(
      req.body.isActive ? 1 : 0, nowIso(), id
    );
  }
  const updated = db.prepare("SELECT * FROM listings WHERE id = ?").get(id);
  return res.json({ listing: mapListing(updated) });
});

app.post("/api/ai/chat", async (req, res) => {
  try {
  let userRole = "guest";
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const row = db.prepare("SELECT role FROM users WHERE id = ?").get(payload.sub);
      if (row?.role) userRole = row.role;
    } catch {
      userRole = "guest";
    }
  }

  const prompt = String(req.body.prompt || "").trim();
  const pagePath = String(req.body.pagePath || "/");
  const pageHint = String(req.body.pageHint || "marketplace");
  const language = String(req.body.language || "en").toLowerCase() === "sw" ? "sw" : "en";
  const languageName = language === "sw" ? "Swahili" : "English";
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  const navContext = {
    guest: [
      "Use /auth to create an account or login.",
      "On /marketplace, use filters, open card AI, then sign in to purchase."
    ],
    buyer: [
      "Browse products and click Add to Cart.",
      "Set delivery location and Place Order.",
      "After delivery, confirm arrival in My Orders.",
      "Then submit product review and store rating."
    ],
    seller: [
      "Open Seller Dashboard to publish listings.",
      "Upload clear product photos and keep stock updated.",
      "Check orders received and reply to buyer messages."
    ],
    admin: [
      "Review pending sellers and approve/reject.",
      "Monitor reviews, feedback, user list, and listing activity."
    ]
  };

  const text = await promptGemini({
    systemInstruction:
      `You are Kiazala Marketplace Navigation Copilot. Reply only in ${languageName}. Use plain, simple wording. Keep concise.`,
    prompt: `Current page: ${pagePath}\nPage hint: ${pageHint}\nUser role: ${userRole}\nNavigation capabilities for this role: ${(navContext[userRole] || navContext.guest).join(" | ")}\nUser message: ${prompt}\n\nOutput rules:\n- Return 3 to 6 bullet points only\n- Each bullet max 16 words\n- Focus on exact buttons/sections to use`,
    fallback:
      `Try this flow: ${(navContext[userRole] || navContext.guest).join(" Then ")}`
  });

  return res.json({ response: text });
  } catch (err) {
    return res.status(503).json({
      error: "Gemini is unavailable. Ensure GEMINI_API_KEY is set correctly in .env.",
      details: err.message
    });
  }
});

app.post("/api/ai/card-insight", requireAuth, async (req, res) => {
  try {
  const listingId = Number(req.body.listingId);
  const userQuestion = String(req.body.question || "").trim();
  const language = String(req.body.language || "en").toLowerCase() === "sw" ? "sw" : "en";
  const languageName = language === "sw" ? "Swahili" : "English";
  if (!listingId) return res.status(400).json({ error: "listingId is required" });

  const listing = db
    .prepare(
      `SELECT l.*, COALESCE(u.business_name, u.name) AS seller_name, u.location AS seller_location, u.id AS seller_id, u.verification_file_id
       FROM listings l
       JOIN users u ON u.id = l.seller_id
       WHERE l.id = ? AND l.is_active = 1`
    )
    .get(listingId);

  if (!listing) return res.status(404).json({ error: "Listing not found" });

  // Get seller rating and reviews
  const sellerStats = db
    .prepare(
      `SELECT ROUND(AVG(rating), 2) AS avg_rating, COUNT(*) AS review_count
       FROM reviews
       WHERE seller_id = ?`
    )
    .get(listing.seller_id);

  const sellerReviews = db
    .prepare(
      `SELECT rating, comment, created_at
       FROM reviews
       WHERE seller_id = ?
       ORDER BY created_at DESC
       LIMIT 5`
    )
    .all(listing.seller_id);

  const recommendations = db
    .prepare(
      `SELECT l.id, l.name, l.price, l.category,
              ROUND(AVG(r.rating), 2) AS avg_rating
       FROM listings l
       LEFT JOIN reviews r ON r.seller_id = l.seller_id
       WHERE l.is_active = 1 AND l.id != ? AND (l.category = ? OR l.price <= ?)
       GROUP BY l.id
       ORDER BY avg_rating DESC, l.created_at DESC
       LIMIT 3`
    )
    .all(listing.id, listing.category, listing.price);

  const ratingText = sellerStats.avg_rating
    ? `Seller rating: ${sellerStats.avg_rating}/5 stars from ${sellerStats.review_count} reviews`
    : "Seller has no reviews yet (new seller)";

  const reviewsText = sellerReviews.length
    ? sellerReviews.map((r) => `"${r.comment}" (${r.rating}/5)`).join("; ")
    : "No buyer feedback available.";

  const recText = recommendations.length
    ? recommendations.map((r) => `${r.name} ($${Number(r.price).toFixed(2)}, ${r.avg_rating ? r.avg_rating + "/5" : "unrated"})`).join("; ")
    : "No alternatives found.";

  const parts = [];
  parts.push({
    text:
      `Analyze this marketplace listing deeply and answer buyer questions.\n` +
      `User question: ${userQuestion || "Should I continue with this purchase? Explain clearly."}\n` +
      `Product: ${listing.name}\nDescription: ${listing.description}\nCategory: ${listing.category}\nPrice: $${listing.price}\n` +
      `Seller: ${listing.seller_name} (${listing.seller_location || "Unknown"})\n${ratingText}\nRecent buyer reviews: ${reviewsText}\n` +
      `Alternative options: ${recText}\n` +
      `Output rules:\n` +
      `- Respond only in ${languageName}\n` +
      `- Use a short numbered list with 5 to 7 items\n` +
      `- Keep each item brief (max 20 words)\n` +
      `- Include one clear recommendation: CONTINUE PURCHASE or HOLD OFF`
  });

  if (listing.image_file_id) {
    const imageRow = db
      .prepare("SELECT data, mime_type FROM files WHERE id = ?")
      .get(Number(listing.image_file_id));
    if (imageRow?.data && imageRow?.mime_type?.startsWith("image/")) {
      parts.push({
        inlineData: {
          mimeType: imageRow.mime_type,
          data: imageRow.data.toString("base64")
        }
      });
    }
  }

  if (listing.verification_file_id) {
    const verificationRow = db
      .prepare("SELECT data, mime_type FROM files WHERE id = ?")
      .get(Number(listing.verification_file_id));
    if (verificationRow?.data && verificationRow?.mime_type?.startsWith("image/")) {
      parts.push({
        inlineData: {
          mimeType: verificationRow.mime_type,
          data: verificationRow.data.toString("base64")
        }
      });
    }
  }

  const response = await promptGeminiMultimodal({
    systemInstruction:
      "You are Kiazala Visual Purchase Analyst. Use image + marketplace data. Be concise, clear, and decisive.",
    parts,
    fallback: `${listing.name}: ${listing.description}. ${ratingText}. ${sellerReviews.length > 0 ? "Recent feedback: " + reviewsText : "No buyer reviews yet - consider alternatives or proceed carefully."} Recommendation: ${sellerStats.avg_rating && Number(sellerStats.avg_rating) >= 4 ? "CONTINUE PURCHASE" : "HOLD OFF"}`
  });

  return res.json({
    response,
    sellerRating: sellerStats.avg_rating,
    sellerReviewCount: sellerStats.review_count,
    recentReviews: sellerReviews,
    recommendations: recommendations.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      price: r.price,
      avgRating: r.avg_rating
    }))
  });
  } catch (err) {
    return res.status(503).json({
      error: "Gemini card analysis is unavailable. Ensure GEMINI_API_KEY is set correctly in .env.",
      details: err.message
    });
  }
});

app.get("/api/files/:id", (req, res) => {
  const fileId = Number(req.params.id);
  const row = db.prepare("SELECT * FROM files WHERE id = ?").get(fileId);
  if (!row) return res.status(404).send("File not found");

  res.setHeader("Content-Type", row.mime_type);
  res.setHeader("Content-Length", row.size_bytes);
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(row.file_name)}"`);
  return res.send(row.data);
});

// Messaging
app.get("/api/messages/inbox", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT m.*, COALESCE(s.name, s.email) AS sender_name, l.name AS listing_name
       FROM messages m
       JOIN users s ON s.id = m.sender_id
       LEFT JOIN listings l ON l.id = m.listing_id
       WHERE m.recipient_id = ?
       ORDER BY m.created_at DESC`
    )
    .all(req.auth.sub);
  return res.json({ messages: rows });
});

app.get("/api/messages/sent", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT m.*, COALESCE(r.name, r.email) AS recipient_name, l.name AS listing_name
       FROM messages m
       JOIN users r ON r.id = m.recipient_id
       LEFT JOIN listings l ON l.id = m.listing_id
       WHERE m.sender_id = ?
       ORDER BY m.created_at DESC`
    )
    .all(req.auth.sub);
  return res.json({ messages: rows });
});

app.get("/api/messages/conversation", requireAuth, (req, res) => {
  const otherUserId = Number(req.query.userId);
  const listingId = req.query.listingId ? Number(req.query.listingId) : null;

  if (!otherUserId || Number.isNaN(otherUserId)) {
    return res.status(400).json({ error: "userId query parameter is required" });
  }

  const baseSql = `
    SELECT m.*,
           COALESCE(s.name, s.email) AS sender_name,
           COALESCE(r.name, r.email) AS recipient_name,
           l.name AS listing_name
    FROM messages m
    JOIN users s ON s.id = m.sender_id
    JOIN users r ON r.id = m.recipient_id
    LEFT JOIN listings l ON l.id = m.listing_id
    WHERE (
      (m.sender_id = ? AND m.recipient_id = ?)
      OR
      (m.sender_id = ? AND m.recipient_id = ?)
    )
  `;

  const rows = listingId
    ? db
        .prepare(`${baseSql} AND m.listing_id = ? ORDER BY m.created_at ASC`)
        .all(req.auth.sub, otherUserId, otherUserId, req.auth.sub, listingId)
    : db
        .prepare(`${baseSql} ORDER BY m.created_at ASC`)
        .all(req.auth.sub, otherUserId, otherUserId, req.auth.sub);

  return res.json({ messages: rows });
});

app.post("/api/messages", requireAuth, (req, res) => {
  const { recipientId, listingId, body } = req.body;
  if (!recipientId || !body) {
    return res.status(400).json({ error: "recipientId and body are required" });
  }

  const recipient = db.prepare("SELECT id FROM users WHERE id = ?").get(Number(recipientId));
  if (!recipient) return res.status(404).json({ error: "Recipient not found" });
  if (Number(recipientId) === req.auth.sub) {
    return res.status(400).json({ error: "Cannot message yourself" });
  }

  const info = db
    .prepare(
      `INSERT INTO messages (sender_id, recipient_id, listing_id, body, is_read, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`
    )
    .run(req.auth.sub, Number(recipientId), listingId ? Number(listingId) : null, String(body).trim(), nowIso());

  const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid);
  return res.status(201).json({ message: msg });
});

app.patch("/api/messages/:id/read", requireAuth, (req, res) => {
  const msgId = Number(req.params.id);
  const msg = db.prepare("SELECT * FROM messages WHERE id = ? AND recipient_id = ?").get(msgId, req.auth.sub);
  if (!msg) return res.status(404).json({ error: "Message not found" });
  db.prepare("UPDATE messages SET is_read = 1 WHERE id = ?").run(msgId);
  return res.json({ message: "Marked as read" });
});

// Avatar / listing image update
app.post("/api/users/me/avatar", requireAuth, upload.single("avatar"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "avatar file is required" });
  const user = getAuthUser(req);
  const fileId = saveFile(req.file, user.id);
  db.prepare("UPDATE users SET avatar_file_id = ?, updated_at = ? WHERE id = ?").run(fileId, nowIso(), user.id);
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
  return res.json({ user: mapUser(updated) });
});

app.post("/api/listings/:id/image", requireAuth, requireRole("seller"), upload.single("image"), (req, res) => {
  const id = Number(req.params.id);
  const user = getAuthUser(req);
  const listing = db.prepare("SELECT * FROM listings WHERE id = ? AND seller_id = ?").get(id, user.id);
  if (!listing) return res.status(404).json({ error: "Listing not found" });
  if (!req.file) return res.status(400).json({ error: "image file is required" });
  const fileId = saveFile(req.file, user.id);
  db.prepare("UPDATE listings SET image_file_id = ?, updated_at = ? WHERE id = ?").run(fileId, nowIso(), id);
  const updated = db.prepare("SELECT * FROM listings WHERE id = ?").get(id);
  return res.json({ listing: mapListing(updated) });
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/auth", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "auth.html"));
});

app.get("/marketplace", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "marketplace.html"));
});

app.listen(PORT, () => {
  console.log(`Marketplace running at http://localhost:${PORT}`);
});
