## Inspiration

Kiazala Community Marketplace was inspired by a real gap in local commerce: producers often have great products but low digital visibility, while buyers lack a trusted, centralized place to compare sellers, verify quality, and purchase with confidence. We wanted to build a platform that supports community trade and uses AI to make decisions easier, safer, and faster.

## What it does

Kiazala is a role-based marketplace with three user types:

- Buyers: browse/filter listings, place orders, confirm delivery, then leave public ratings and reviews.
- Sellers: create listings, upload product images, manage orders, and access sales analytics.
- Admins: approve seller accounts, monitor platform activity, and manage trust/compliance workflows.

AI (Gemini) is integrated for:

- Floating assistant chat to help users navigate and complete tasks.
- Card-level product/store analysis (including image-based quality cues and trust signals).
- Seller-facing AI insights from buyer behavior, peak order times, and demand trends.
- English/Swahili response support.

## How we built it

We built the project with:

- Node.js + Express backend API
- SQLite persistent storage for users, listings, orders, reviews, feedback, messages, and uploaded files
- Vanilla HTML/CSS/JS frontend with separate dashboards by role
- Gemini API integration through backend endpoints using `.env` configuration

Core implementation included authentication, strict role authorization, upload support for verification docs/images, transaction lifecycle handling, review/rating logic after delivery confirmation, and analytics endpoints for seller intelligence.

## Challenges we ran into

- Frontend handler gaps where visible buttons had no bound logic in one repo copy.
- JavaScript redeclaration/runtime issues (`api` collisions, undefined state handlers).
- 404 mismatches between frontend API calls and backend routes.
- State/load-order bugs causing intermittent dashboard failures.
- Deployment errors from incorrect start/build command configuration.
- Working across similarly named local folders, which initially caused edits to land in the wrong codebase.

## Accomplishments that we're proud of

- Delivered a full end-to-end marketplace workflow with role-specific dashboards.
- Added strict backend auth/authorization and persistent SQLite schema-backed data.
- Integrated Gemini beyond chat: decision support, recommendations, and seller growth insights.
- Enabled bilingual AI output (English/Swahili) for accessibility.
- Implemented public trust features (ratings/reviews visible to future buyers).
- Added seller analytics to convert buyer activity into actionable sales strategy.

## What we learned

- AI is most valuable when attached to real user decisions, not as a standalone feature.
- Clear trust mechanics (verification, delivery-confirmed reviews) are essential for marketplace adoption.
- Backend-first role enforcement prevents many frontend security and logic pitfalls.
- Small UX fixes (status feedback, clear errors, reliable handlers) dramatically improve usability.
- Tight repo/deploy/environment consistency is critical for reliable iteration.

## What's next for Kiazala community marketplace

- Add richer multimodal AI flows (deeper image quality scoring and fraud/anomaly hints).
- Expand seller intelligence with forecasting dashboards and category-level demand alerts.
- Improve buyer personalization using behavior-based recommendations.
- Introduce stronger verification and dispute-resolution tooling for admins.
- Add notifications and mobile-first refinements for broader community adoption.
- Prepare production deployment hardening (monitoring, backups, and scaling strategy).
