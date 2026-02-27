# Kiazala Community Marketplace (SQLite + Gemini)

## Implemented

- Animated landing page with marketplace explanation
- Login/Register page with role-based onboarding
- Post-login redirect to dedicated product marketplace page
- Floating AI chat icon on pages (backend Gemini endpoint)
- AI card insight popup on product card click with recommendations
- Settings panel for user profile updates
- Buyer-only feedback and review workflows
- Seller document upload and product image upload from device
- Public seller ratings/reviews visible before purchase

## Backend capabilities

- SQLite persistence (`data/marketplace.sqlite`) for:
  - users
  - files (BLOB storage for docs/images)
  - listings
  - orders + order_items
  - reviews
  - feedback
- JWT authentication
- Strict RBAC:
  - buyer: order, confirm arrival, review, feedback
  - seller: create/manage listings (after admin approval)
  - admin: approve pending sellers
- Review enforcement in API:
  - only buyers
  - only after order arrival confirmation
  - only for sellers included in that confirmed order

## Key routes

- Pages: `/`, `/auth`, `/marketplace`
- Auth: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- User settings: `PATCH /api/users/me`
- Listings: `GET /api/listings`, `GET /api/listings/mine`, `POST /api/listings`, `PATCH /api/listings/:id`
- Orders: `POST /api/orders`, `GET /api/orders/mine`, `POST /api/orders/:id/confirm-arrival`
- Reviews: `GET /api/reviews/summary`, `GET /api/reviews/eligible-orders`, `POST /api/reviews`
- Feedback: `POST /api/feedback`
- Admin: `GET /api/admin/pending-sellers`, `POST /api/admin/sellers/:id/approve`
- AI: `POST /api/ai/chat`, `POST /api/ai/card-insight`
- File streaming: `GET /api/files/:id`

## Setup

1. Install dependencies

```bash
npm install
```

2. Configure environment

```bash
copy .env.example .env
```

Set `JWT_SECRET` and optionally `GEMINI_API_KEY`.

3. Start server

```bash
npm start
```

4. Open `http://localhost:3000`

## Seeded admin account

- Email: `admin@kiazala.local`
- Password: `Admin@1234`
