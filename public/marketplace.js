// --- Threaded Chat Modal Logic ---
function getChatPartners(messages, myId) {
  // Returns array of { userId, name, listingId, listingName, lastMessage, lastTime }
  const map = new Map();
  messages.forEach(m => {
    const otherId = m.sender_id === myId ? m.recipient_id : m.sender_id;
    const otherName = m.sender_id === myId ? m.recipient_name : m.sender_name;
    const key = otherId + '|' + (m.listing_id || '');
    if (!map.has(key) || new Date(m.created_at) > new Date(map.get(key).lastTime)) {
      map.set(key, {
        userId: otherId,
        name: otherName,
        listingId: m.listing_id,
        listingName: m.listing_name,
        lastMessage: m.body,
        lastTime: m.created_at
      });
    }
  });
  return Array.from(map.values()).sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime));
}

async function openChatModal() {
  if (!state.me) return;
  ui['chat-modal'].classList.remove('hidden');
  ui['chat-thread'].style.display = 'none';
  ui['chat-send-form'].style.display = 'none';
  ui['chat-list'].innerHTML = '<div style="color:var(--muted);">Loading...</div>';
  // Fetch all inbox and sent messages
  const [inbox, sent] = await Promise.all([
    api('/api/messages/inbox'),
    api('/api/messages/sent')
  ]);
  const allMsgs = [...(inbox.messages || []), ...(sent.messages || [])];
  const partners = getChatPartners(allMsgs, state.me.id);
  if (!partners.length) {
    ui['chat-list'].innerHTML = '<div style="color:var(--muted);">No chats yet.</div>';
    return;
  }
  ui['chat-list'].innerHTML = partners.map(p =>
    `<div class="chat-list-item" data-chat-user="${p.userId}" data-chat-listing="${p.listingId || ''}">
      <strong>${p.name}</strong>${p.listingName ? ' <span style="color:var(--muted);font-size:0.9em;">re: ' + p.listingName + '</span>' : ''}<br/>
      <span style="font-size:0.9em;color:var(--muted);">${p.lastMessage}</span>
      <span style="float:right;font-size:0.8em;color:var(--muted);">${(p.lastTime || '').slice(0, 16).replace('T', ' ')}</span>
    </div>`
  ).join('');
}

async function loadChatThread(userId, listingId) {
  const uid = Number(userId);
  if (!uid || Number.isNaN(uid)) {
    ui["chat-thread"].innerHTML = '<div style="color:var(--muted);">Invalid chat target.</div>';
    return;
  }

  ui['chat-thread'].style.display = 'flex';
  ui['chat-send-form'].style.display = 'flex';
  ui['chat-thread'].innerHTML = '<div style="color:var(--muted);">Loading...</div>';
  const [inbox, sent] = await Promise.all([api("/api/messages/inbox"), api("/api/messages/sent")]);
  const messages = [...(inbox.messages || []), ...(sent.messages || [])]
    .filter((m) => {
      const matchesUser =
        (m.sender_id === uid && m.recipient_id === state.me.id) ||
        (m.sender_id === state.me.id && m.recipient_id === uid);
      const matchesListing = listingId ? String(m.listing_id || "") === String(listingId) : true;
      return matchesUser && matchesListing;
    })
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const myId = state.me.id;
  ui['chat-thread'].innerHTML = messages.length
    ? messages.map(m =>
        `<div style="margin-bottom:0.5em;text-align:${m.sender_id === myId ? 'right' : 'left'};">
          <span style="display:inline-block;padding:0.4em 0.8em;border-radius:1.2em;background:${m.sender_id === myId ? '#eaf1fb' : '#f5f7fa'};max-width:80%;word-break:break-word;">
            ${m.body}
          </span><br/>
          <span style="font-size:0.8em;color:var(--muted);">${(m.created_at || '').slice(0, 16).replace('T', ' ')}</span>
        </div>`
      ).join('')
    : '<div style="color:var(--muted);">No messages yet.</div>';
  // Store for sending
  ui['chat-send-form'].dataset.chatUser = String(uid);
  ui['chat-send-form'].dataset.chatListing = listingId || '';
  ui['chat-send-input'].value = '';
  ui['chat-send-input'].focus();
}

// Seller reply to buyer messages
safeOn(document, "click", async function(event) {
  const replyBtn = event.target.closest(".reply-btn[data-reply-to]");
  if (replyBtn) {
    const recipientId = replyBtn.dataset.replyTo;
    const listingId = replyBtn.dataset.listing;
    const buyerName = replyBtn.dataset.msgName || "the buyer";
    const body = prompt("Reply to " + buyerName + ":");
    if (!body || !body.trim()) return;
    try {
      await api("/api/messages", {
        method: "POST",
        body: JSON.stringify({ recipientId: Number(recipientId), listingId: listingId ? Number(listingId) : null, body: body.trim() })
      });
      alert("Message sent!");
      await loadSellerData();
    } catch (err) { alert(err.message); }
    return;
  }
});
if (
  typeof api !== "function" ||
  typeof requireAuthRedirect !== "function" ||
  typeof logoutToAuth !== "function" ||
  typeof setStatus !== "function" ||
  typeof initFloatingChat !== "function"
) {
  throw new Error("Kiazala helpers not loaded. Ensure /common.js is loaded before /marketplace.js.");
}
requireAuthRedirect();

const state = {
  me: null,
  listings: [],
  cart: [],
  eligibleOrders: [],
  adminUsers: [],
  cardAiLanguage: "en"
};

function getSafeElement(id) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn("[UI] Element not found:", id);
  }
  return el;
}

const ui = {
  whoami: getSafeElement("whoami"),
  topbarUser: getSafeElement("topbar-user"),
  dashTitle: getSafeElement("dashboard-title"),
  listings: getSafeElement("listings"),
  search: getSafeElement("search"),
  category: getSafeElement("filter-category"),
  maxPrice: getSafeElement("max-price"),
  sortOrder: getSafeElement("sort-order"),
  publicReviews: getSafeElement("public-reviews"),
  logoutBtn: getSafeElement("logout-btn"),
  buyerPanel: getSafeElement("buyer-panel"),
  sellerPanel: getSafeElement("seller-panel"),
  adminPanel: getSafeElement("admin-panel"),
  cart: getSafeElement("cart"),
  placeOrderBtn: getSafeElement("place-order-btn"),
  orderMsg: getSafeElement("order-msg"),
  orders: getSafeElement("orders"),
  reviewForm: getSafeElement("review-form"),
  reviewOrder: getSafeElement("review-order"),
  reviewSeller: getSafeElement("review-seller"),
  reviewMsg: getSafeElement("review-msg"),
  feedbackForm: getSafeElement("feedback-form"),
  feedbackInput: getSafeElement("feedback-msg-input"),
  feedbackMsg: getSafeElement("feedback-msg"),
  messagesInbox: getSafeElement("messages-inbox"),
  sellerApproval: getSafeElement("seller-approval"),
  listingForm: getSafeElement("listing-form"),
  listingMsg: getSafeElement("listing-msg"),
  sellerListings: getSafeElement("seller-listings"),
  sellerOrders: getSafeElement("seller-orders"),
  sellerMessagesInbox: getSafeElement("seller-messages-inbox"),
  sellerAnalyticsStats: getSafeElement("seller-analytics-stats"),
  sellerPopularProducts: getSafeElement("seller-popular-products"),
  sellerPeakTimes: getSafeElement("seller-peak-times"),
  sellerDemandTrends: getSafeElement("seller-demand-trends"),
  sellerInsightLanguage: getSafeElement("seller-insight-language"),
  sellerInsightBtn: getSafeElement("seller-insight-btn"),
  sellerInsightMsg: getSafeElement("seller-insight-msg"),
  sellerAiInsights: getSafeElement("seller-ai-insights"),
  pendingSellers: getSafeElement("pending-sellers"),
  adminStats: getSafeElement("admin-stats"),
  adminReviews: getSafeElement("admin-reviews"),
  adminFeedback: getSafeElement("admin-feedback"),
  adminUsers: getSafeElement("admin-users"),
  adminUserSearch: getSafeElement("admin-user-search"),
  settingsOpen: getSafeElement("settings-open"),
  settingsModal: getSafeElement("settings-modal"),
  settingsClose: getSafeElement("settings-close"),
  settingsForm: getSafeElement("settings-form"),
  settingsMsg: getSafeElement("settings-msg"),
  cardAiModal: getSafeElement("card-ai-modal"),
  cardAiText: getSafeElement("card-ai-text"),
  cardAiRecs: getSafeElement("card-ai-recs"),
  cardAiClose: getSafeElement("card-ai-close"),
  cardAiQuestion: getSafeElement("card-ai-question"),
  cardAiRun: getSafeElement("card-ai-run"),
  cardAiLanguage: getSafeElement("card-ai-language"),
  cardAiLangEn: getSafeElement("card-ai-lang-en"),
  cardAiLangSw: getSafeElement("card-ai-lang-sw"),
  reviewProduct: getSafeElement("review-product"),
  ratingForm: getSafeElement("rating-form"),
  ratingOrder: getSafeElement("rating-order"),
  ratingSeller: getSafeElement("rating-seller"),
  ratingScore: getSafeElement("rating-score"),
  ratingMsg: getSafeElement("rating-msg"),
  filterStoreRating: getSafeElement("filter-store-rating"),
  "chat-modal": getSafeElement("chat-modal"),
  "chat-list": getSafeElement("chat-list"),
  "chat-thread": getSafeElement("chat-thread"),
  "chat-send-form": getSafeElement("chat-send-form"),
  "chat-send-input": getSafeElement("chat-send-input"),
  "chat-modal-close": getSafeElement("chat-modal-close")
};

function safeOn(node, event, handler) {
  if (node) node.addEventListener(event, handler);
}

// Chat modal handlers (must be registered after ui/safeOn exist)
safeOn(document, "click", function(event) {
  const openChatBtn = event.target.closest("[data-open-chat-modal]");
  if (openChatBtn) {
    openChatModal();
    return;
  }

  const chatItem = event.target.closest(".chat-list-item[data-chat-user]");
  if (chatItem) {
    loadChatThread(chatItem.dataset.chatUser, chatItem.dataset.chatListing);
    return;
  }

  const closeBtn = event.target.closest("#chat-modal-close");
  if (closeBtn && ui["chat-modal"]) {
    ui["chat-modal"].classList.add("hidden");
    if (ui["chat-thread"]) ui["chat-thread"].style.display = "none";
    if (ui["chat-send-form"]) ui["chat-send-form"].style.display = "none";
  }
});

safeOn(ui["chat-send-form"], "submit", async function(event) {
  event.preventDefault();
  const userId = ui["chat-send-form"].dataset.chatUser;
  const listingId = ui["chat-send-form"].dataset.chatListing;
  const body = (ui["chat-send-input"] && ui["chat-send-input"].value || "").trim();
  if (!body) return;

  await api("/api/messages", {
    method: "POST",
    body: JSON.stringify({
      recipientId: Number(userId),
      listingId: listingId ? Number(listingId) : null,
      body
    })
  });

  ui["chat-send-input"].value = "";
  await loadChatThread(userId, listingId);
});

function stars(rating) {
  if (!rating) return "No reviews";
  const full = Math.round(rating);
  return "&#9733;".repeat(full) + "&#9734;".repeat(5 - full) + " " + rating + "/5";
}

function fmt(price) {
  return "KES " + Number(price).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function tCard(key) {
  const sw = state.cardAiLanguage === "sw";
  const dict = {
    seller_rating: sw ? "Ukadiriaji wa Muuzaji" : "Seller Rating",
    recent_feedback: sw ? "Maoni ya Hivi Karibuni" : "Recent feedback",
    no_reviews_warning: sw ? "Muuzaji hana maoni bado. Chukua tahadhari zaidi." : "This seller has no reviews yet. Treat this as higher risk and verify details.",
    no_alternatives: sw ? "Hakuna mbadala uliopatikana kwa kategoria/bei hii." : "No alternatives found in this category/price range."
  };
  return dict[key] || key;
}

function syncCardLanguageUi() {
  if (ui.cardAiLanguage) ui.cardAiLanguage.value = state.cardAiLanguage;
  if (ui.cardAiLangEn) ui.cardAiLangEn.classList.toggle("btn--alt", state.cardAiLanguage === "en");
  if (ui.cardAiLangSw) ui.cardAiLangSw.classList.toggle("btn--alt", state.cardAiLanguage === "sw");
}

function renderCardAiResult(result) {
  const lines = String(result.response || "")
    .replace(/\*\*/g, "")
    .split("\n")
    .map(function(x) { return x.trim(); })
    .filter(Boolean);
  const points = [];
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i]
      .replace(/^[\-\*\u2022]\s*/, "")
      .replace(/^\d+[\).\s-]*/, "")
      .trim();
    if (!line) continue;
    if (line.length > 200) line = line.slice(0, 197) + "...";
    points.push(line);
    if (points.length >= 8) break;
  }
  let html = "<ul style=\"margin:0 0 1rem 1rem;\">" + points.map(function(p) { return "<li>" + p + "</li>"; }).join("") + "</ul>";
  if (result.sellerRating) {
    html += "<div style=\"padding:0.6rem;background:var(--surface);border:1px solid var(--line);border-radius:8px;margin-bottom:1rem;\">";
    html += "<strong>" + tCard("seller_rating") + ":</strong> " + stars(result.sellerRating) + " (" + result.sellerReviewCount + " review" + (result.sellerReviewCount !== 1 ? "s" : "") + ")";
    if (result.recentReviews && result.recentReviews.length > 0) {
      html += "<div style=\"margin-top:0.5rem;font-size:0.85em;color:var(--muted);\"><strong>" + tCard("recent_feedback") + ":</strong></div>";
      html += "<ul style=\"margin:0.3rem 0 0 1.2rem;font-size:0.85em;\">";
      result.recentReviews.forEach(function(rev) {
        html += "<li>\"" + rev.comment + "\" (" + rev.rating + "/5)</li>";
      });
      html += "</ul>";
    }
    html += "</div>";
  } else {
    html += "<div style=\"padding:0.6rem;background:#fff3cd;border:1px solid #d4a017;border-radius:8px;margin-bottom:1rem;font-size:0.9em;\">";
    html += tCard("no_reviews_warning");
    html += "</div>";
  }
  if (ui.cardAiText) ui.cardAiText.innerHTML = html;
  if (ui.cardAiRecs) ui.cardAiRecs.innerHTML = result.recommendations && result.recommendations.length
    ? result.recommendations.map(function(r) {
        const ratingBadge = r.avgRating ? " — " + stars(r.avgRating) : " (unrated)";
        return "<li>" + r.name + " (" + r.category + ") — " + fmt(r.price) + ratingBadge + "</li>";
      }).join("")
    : "<li style=\"color:var(--muted);\">" + tCard("no_alternatives") + "</li>";
}

async function runCardAiAnalysis(listingId, question) {
  if (!listingId) return;
  if (ui.cardAiText) ui.cardAiText.textContent = "Loading multimodal AI analysis (photo + seller trust signals)...";
  if (ui.cardAiRecs) ui.cardAiRecs.innerHTML = "";
  const language = ui.cardAiLanguage ? ui.cardAiLanguage.value : state.cardAiLanguage;
  state.cardAiLanguage = language === "sw" ? "sw" : "en";
  const result = await api("/api/ai/card-insight", {
    method: "POST",
    body: JSON.stringify({
      listingId: Number(listingId),
      question: question || "",
      language
    })
  });
  renderCardAiResult(result);
}

function renderRolePanels() {
  const role = state.me.role;
  ui.buyerPanel.classList.toggle("hidden", role !== "buyer");
  ui.sellerPanel.classList.toggle("hidden", role !== "seller");
  ui.adminPanel.classList.toggle("hidden", role !== "admin");

  const titles = { buyer: "Buyer Dashboard", seller: "Seller Dashboard", admin: "Admin Dashboard" };
  if (ui.dashTitle) ui.dashTitle.textContent = titles[role] || "Dashboard";
  if (ui.whoami) ui.whoami.textContent = state.me.name + " (" + role + ")";
  if (ui.topbarUser) {
    const status = role === "seller"
      ? (state.me.isApproved ? " \u2713 Approved" : state.me.isRejected ? " \u2717 Rejected" : " \u23F3 Pending")
      : "";
    ui.topbarUser.textContent = state.me.name + status;
  }
}

function listingMatchesFilters(listing) {
  const q = ((ui.search && ui.search.value) || "").trim().toLowerCase();
  const category = (ui.category && ui.category.value) || "";
  const max = Number((ui.maxPrice && ui.maxPrice.value) || 0) || Infinity;
  const storeRating = Number((ui.filterStoreRating && ui.filterStoreRating.value) || 0) || 0;
  const text = (listing.name + " " + listing.description + " " + (listing.seller ? listing.seller.name : "")).toLowerCase();
  return (!q || text.includes(q)) && (!category || listing.category === category) && Number(listing.price) <= max && (!storeRating || (listing.seller && listing.seller.averageRating >= storeRating));
}

function sortListings(rows) {
  const sort = (ui.sortOrder && ui.sortOrder.value) || "newest";
  const arr = rows.slice();
  if (sort === "price-asc") arr.sort(function(a, b) { return a.price - b.price; });
  else if (sort === "price-desc") arr.sort(function(a, b) { return b.price - a.price; });
  else if (sort === "rating") arr.sort(function(a, b) { return (b.averageRating || 0) - (a.averageRating || 0); });
  return arr;
}

function renderListings() {
  const filtered = sortListings(state.listings.filter(listingMatchesFilters));
  if (!filtered.length) {
    if (ui.listings) ui.listings.innerHTML = "<p style=\"color:var(--muted);grid-column:1/-1;\">No products found. Try adjusting your filters.</p>";
    return;
  }

  if (ui.listings) ui.listings.innerHTML = filtered.map(function(l) {
    const rating = l.averageRating ? (stars(l.averageRating) + " (" + l.reviewCount + ")") : "No reviews yet";
    const img = l.imageUrl ? l.imageUrl : "https://placehold.co/420x260?text=No+Image";
    const stockBadge = (l.stock !== null && l.stock !== undefined)
      ? "<span style=\"font-size:0.8em;color:" + (l.stock > 0 ? "var(--accent)" : "var(--warn)") + ";\">"
        + (l.stock > 0 ? l.stock + " in stock" : "Out of stock") + "</span>"
      : "";
    const canBuy = state.me && state.me.role === "buyer";
    const sellerName = (l.seller && l.seller.name) || "Unknown";
    const sellerLoc = (l.seller && l.seller.location) ? " \u2014 " + l.seller.location : "";
    return "<article class=\"product\">"
      + "<img src=\"" + img + "\" alt=\"" + l.name + "\" loading=\"lazy\" />"
      + "<h3>" + l.name + "</h3>"
      + "<p style=\"font-size:0.85em;color:var(--muted);\">" + l.description + "</p>"
      + "<p style=\"font-size:0.85em;\">" + l.category + " \u00B7 " + l.quantityUnit + "</p>"
      + "<p><strong>" + fmt(l.price) + "</strong> " + stockBadge + "</p>"
      + "<p style=\"font-size:0.85em;\">\uD83D\uDCCD " + sellerName + sellerLoc + "</p>"
      + "<p style=\"font-size:0.85em;\">" + rating + "</p>"
      + "<div class=\"cta-row\" style=\"margin-top:0.5rem;\">"
      + (canBuy ? "<button class=\"btn\" data-add=\"" + l.id + "\">Add to Cart</button>" : "")
      + "<button class=\"btn btn--ghost\" data-insight=\"" + l.id + "\">Ask AI</button>"
      + (canBuy && l.seller && l.seller.id
          ? "<button class=\"btn btn--ghost\" data-msg-seller=\"" + l.seller.id + "\" data-msg-listing=\"" + l.id + "\" data-msg-name=\"" + sellerName + "\">Message</button>"
          : "")
      + "</div>"
      + "</article>";
  }).join("");
}

function renderCart() {
  if (!state.cart.length) {
    if (ui.cart) ui.cart.innerHTML = "<li style=\"color:var(--muted);\"><em>Your cart is empty</em></li>";
    return;
  }

  const total = state.cart.reduce(function(s, i) { return s + i.qty * i.price; }, 0);
  if (ui.cart) ui.cart.innerHTML = state.cart.map(function(item) {
    return "<li style=\"display:flex;justify-content:space-between;align-items:center;gap:0.4rem;flex-wrap:wrap;\">"
      + "<span style=\"flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;\">" + item.name + "</span>"
      + "<span style=\"white-space:nowrap;\">" + fmt(item.qty * item.price) + "</span>"
      + "<span style=\"display:flex;gap:0.25rem;\">"
      + "<button class=\"btn btn--ghost\" style=\"padding:0.15rem 0.45rem;\" data-cart-dec=\"" + item.listingId + "\">\u2212</button>"
      + "<span style=\"min-width:1.5rem;text-align:center;\">" + item.qty + "</span>"
      + "<button class=\"btn btn--ghost\" style=\"padding:0.15rem 0.45rem;\" data-cart-inc=\"" + item.listingId + "\">+</button>"
      + "<button class=\"btn btn--ghost\" style=\"padding:0.15rem 0.45rem;color:#b24a3a;\" data-cart-remove=\"" + item.listingId + "\">\u2715</button>"
      + "</span>"
      + "</li>";
  }).join("")
    + "<li style=\"border-top:1px solid var(--line);padding-top:0.4rem;font-weight:700;\">Total: " + fmt(total) + "</li>";
}

function renderEligibleOrders() {
  const options = state.eligibleOrders.map(function(o) {
    return "<option value=\"" + o.id + "\">Order #" + o.id + " (" + ((o.created_at || "").slice(0, 10)) + ")</option>";
  }).join("");
  if (ui.reviewOrder) ui.reviewOrder.innerHTML = "<option value=\"\">\u2014 Select order \u2014</option>" + options;
  if (ui.reviewSeller) ui.reviewSeller.innerHTML = "<option value=\"\">\u2014 Select seller \u2014</option>";
}

function fillSellerOptions(orderId) {
  const order = state.eligibleOrders.find(function(o) { return String(o.id) === String(orderId); });
  if (!order) {
    if (ui.reviewSeller) ui.reviewSeller.innerHTML = "<option value=\"\">\u2014 Select seller \u2014</option>";
    return;
  }

  const sellerMap = new Map();
  (order.items || []).forEach(function(item) {
    if (!sellerMap.has(item.seller_id)) {
      sellerMap.set(item.seller_id, item.seller_name || ("Seller #" + item.seller_id));
    }
  });

  const options = Array.from(sellerMap.entries()).map(function(entry) {
    return "<option value=\"" + entry[0] + "\">" + entry[1] + "</option>";
  }).join("");

  if (ui.reviewSeller) ui.reviewSeller.innerHTML = "<option value=\"\">\u2014 Select seller \u2014</option>" + options;
}

async function loadMe() {
  const result = await api("/api/auth/me");
  state.me = result.user;

  document.getElementById("set-name").value = state.me.name || "";
  document.getElementById("set-business").value = state.me.businessName || "";
  document.getElementById("set-location").value = state.me.location || "";
  document.getElementById("set-bio").value = state.me.bio || "";
  document.getElementById("set-language").value = state.me.languagePref || "en";

  renderRolePanels();
}

async function loadListings() {
  const result = await api("/api/listings");
  state.listings = result.listings;
  renderListings();
}

async function loadPublicReviews() {
  const result = await api("/api/reviews/summary");
  if (ui.publicReviews) ui.publicReviews.innerHTML = result.summaries.length
    ? result.summaries.map(function(s) {
        return "<li>"
          + "<strong>" + s.sellerName + "</strong> \u2014 " + stars(s.averageRating) + " \u00B7 " + s.reviewCount + " review" + (s.reviewCount !== 1 ? "s" : "")
          + s.recent.map(function(r) {
              return "<div style=\"font-size:0.85em;margin-left:1rem;color:var(--muted);\">\u201C" + r.comment + "\u201D (" + r.rating + "/5)</div>";
            }).join("")
          + "</li>";
      }).join("")
    : "<li style=\"color:var(--muted);\">No public reviews yet.</li>";
}

async function loadBuyerData() {
  if (!state.me || state.me.role !== "buyer") return;

  const results = await Promise.allSettled([
    api("/api/orders/mine"),
    api("/api/reviews/eligible-orders"),
    api("/api/messages/inbox")
  ]);

  const ordersRes = results[0].status === "fulfilled" ? results[0].value : { orders: [] };
  const eligibleRes = results[1].status === "fulfilled" ? results[1].value : { orders: [] };
  const inboxRes = results[2].status === "fulfilled" ? results[2].value : { messages: [] };

  if (ui.orders) ui.orders.innerHTML = ordersRes.orders.length
    ? ordersRes.orders.map(function(o) {
        const itemsHtml = (o.items || []).map(function(i) {
          return "<li>" + i.listing_name + " \u00D7 " + i.qty + " @ " + fmt(i.price_at_purchase) + " \u2014 <em>" + (i.seller_name || ("Seller #" + i.seller_id)) + "</em></li>";
        }).join("");
        let actionHtml = "";
        if (o.status === "PLACED") {
          actionHtml = "<button class=\"btn btn--ghost\" style=\"margin-top:0.4rem;font-size:0.85em;\" data-confirm=\"" + o.id + "\">\u2713 Confirm Arrival</button>";
        } else if (o.status === "ARRIVED_CONFIRMED") {
          actionHtml = "<span class=\"status\" style=\"margin-top:0.4rem;font-size:0.85em;color:#2d3a4a;\">Waiting for seller payment confirmation...</span>";
        } else if (o.status === "PAID") {
          actionHtml = "<button class=\"btn btn--ghost\" style=\"margin-top:0.4rem;font-size:0.85em;\" data-download-receipt=\"" + o.id + "\">Download Confirmed Receipt (PDF)</button>";
        }
        return "<li>"
          + "<div style=\"display:flex;justify-content:space-between;\">"
          + "<strong>Order #" + o.id + "</strong>"
          + "<span class=\"status\" style=\"font-size:0.85em;\">" + o.status + "</span>"
          + "</div>"
          + "<div style=\"font-size:0.85em;color:var(--muted);\">" + ((o.created_at || "").slice(0, 10)) + " \u00B7 " + fmt(o.total) + "</div>"
          + (itemsHtml ? "<ul style=\"margin:0.3rem 0 0 1rem;font-size:0.85em;\">" + itemsHtml + "</ul>" : "")
          + actionHtml
          + "</li>";
      }).join("")
    : "<li style=\"color:var(--muted);\"><em>No orders yet.</em></li>";

  state.eligibleOrders = eligibleRes.orders;
  renderEligibleOrders();

  if (ui.messagesInbox) {
    const msgs = inboxRes.messages || [];
    ui.messagesInbox.innerHTML = msgs.length
      ? msgs.map(function(m) {
          return "<li style=\"" + (!m.is_read ? "font-weight:700;" : "") + "\">"
            + "<div><strong>" + m.sender_name + "</strong>" + (m.listing_name ? " re: " + m.listing_name : "")
            + " <span style=\"float:right;font-size:0.8em;color:var(--muted);\">" + ((m.created_at || "").slice(0, 10)) + "</span></div>"
            + "<div style=\"font-size:0.9em;\">" + m.body + "</div>"
            + "</li>";
        }).join("")
      : "<li style=\"color:var(--muted);\"><em>No messages.</em></li>";
  }
}

async function loadSellerData() {
    // Load seller messages inbox
    const inboxRes = await api("/api/messages/inbox");
    if (ui.sellerMessagesInbox) {
      const msgs = inboxRes.messages || [];
      ui.sellerMessagesInbox.innerHTML = msgs.length
        ? msgs.map(function(m) {
            return `<li style="${!m.is_read ? 'font-weight:700;' : ''}">
              <div><strong>${m.sender_name}</strong>${m.listing_name ? ' re: ' + m.listing_name : ''}
              <span style="float:right;font-size:0.8em;color:var(--muted);">${(m.created_at || '').slice(0, 10)}</span></div>
              <div style="font-size:0.9em;">${m.body}</div>
              <button class="btn btn--ghost reply-btn" data-reply-to="${m.sender_id}" data-listing="${m.listing_id || ''}" data-msg-name="${m.sender_name}">Reply</button>
            </li>`;
          }).join("")
        : '<li style="color:var(--muted);"><em>No messages.</em></li>';
    }
  if (!state.me || state.me.role !== "seller") return;

  const mine = await api("/api/listings/mine");
  const approved = mine.isApproved;
  const rejected = state.me.isRejected;

  ui.sellerApproval.textContent = rejected
    ? "Your seller account has been rejected by admin."
    : approved
    ? "\u2713 Seller account approved. You can publish listings."
    : "\u23F3 Pending admin approval. Publishing is disabled until approved.";
  ui.sellerApproval.classList.toggle("error", rejected || !approved);

  ui.listingForm.querySelectorAll("input, textarea, select, button").forEach(function(node) {
    node.disabled = !approved;
  });

  if (ui.sellerListings) ui.sellerListings.innerHTML = mine.listings.length
    ? mine.listings.map(function(l) {
        const activeLabel = l.isActive
          ? "<span style=\"color:var(--accent);\">Active</span>"
          : "<span style=\"color:var(--warn);\">Inactive</span>";
        return "<li>"
          + "<div style=\"display:flex;justify-content:space-between;align-items:flex-start;gap:0.4rem;\">"
          + "<div style=\"flex:1;\">"
          + "<strong>" + l.name + "</strong>"
          + "<div style=\"font-size:0.85em;color:var(--muted);\">"
          + l.category + " \u00B7 " + fmt(l.price) + " \u00B7 " + activeLabel
          + (l.stock !== null && l.stock !== undefined ? " \u00B7 " + l.stock + " in stock" : "")
          + "</div>"
          + "</div>"
          + "<div style=\"display:flex;gap:0.3rem;flex-shrink:0;\">"
          + "<button class=\"btn btn--ghost\" style=\"font-size:0.8em;padding:0.3rem 0.6rem;\" data-toggle-listing=\"" + l.id + "\" data-active=\"" + (l.isActive ? 1 : 0) + "\">"
          + (l.isActive ? "Deactivate" : "Activate") + "</button>"
          + "<button class=\"btn btn--ghost\" style=\"font-size:0.8em;padding:0.3rem 0.6rem;color:#b24a3a;\" data-delete-listing=\"" + l.id + "\">Delete</button>"
          + "</div>"
          + "</div>"
          + "</li>";
      }).join("")
    : "<li style=\"color:var(--muted);\"><em>No listings yet. Create your first listing above.</em></li>";

  await loadSellerAnalytics();
}

async function loadSellerAnalytics() {
  if (!state.me || state.me.role !== "seller") return;

  const res = await api("/api/seller/analytics");

  if (ui.sellerAnalyticsStats) {
    ui.sellerAnalyticsStats.innerHTML = [
      "Window: last " + (res.windowDays || 30) + " days",
      "Orders: " + ((res.summary && res.summary.totalOrders) || 0),
      "Units sold: " + ((res.summary && res.summary.totalUnits) || 0),
      "Gross sales: " + fmt((res.summary && res.summary.grossSales) || 0)
    ].map(function(line) { return "<li>" + line + "</li>"; }).join("");
  }

  if (ui.sellerPopularProducts) {
    ui.sellerPopularProducts.innerHTML = (res.popularProducts || []).length
      ? res.popularProducts.map(function(p) {
          return "<li><strong>" + p.listingName + "</strong> — " + p.unitsSold + " units, " + fmt(p.revenue) + "</li>";
        }).join("")
      : "<li style=\"color:var(--muted);\"><em>No product demand data yet.</em></li>";
  }

  if (ui.sellerPeakTimes) {
    ui.sellerPeakTimes.innerHTML = (res.peakTimes || []).length
      ? res.peakTimes.map(function(t) { return "<li>" + t.hour + ":00 — " + t.orderCount + " orders</li>"; }).join("")
      : "<li style=\"color:var(--muted);\"><em>No peak-time pattern yet.</em></li>";
  }

  if (ui.sellerDemandTrends) {
    ui.sellerDemandTrends.innerHTML = (res.demandTrends || []).length
      ? res.demandTrends.map(function(t) {
          const sign = t.deltaQty > 0 ? "+" : "";
          const trend = t.deltaQty > 0 ? "up" : t.deltaQty < 0 ? "down" : "flat";
          return "<li><strong>" + t.category + "</strong> — " + trend + " (" + sign + t.deltaQty + " units, " + sign + t.deltaPct + "%)</li>";
        }).join("")
      : "<li style=\"color:var(--muted);\"><em>No market trend data yet.</em></li>";
  }
}

async function generateSellerAiInsights() {
  if (!state.me) {
    setStatus(ui.sellerInsightMsg, "Please wait for your account to load.", true);
    return;
  }
  if (state.me.role !== "seller") {
    setStatus(ui.sellerInsightMsg, "Only sellers can generate sales insights.", true);
    return;
  }
  const language = ui.sellerInsightLanguage ? ui.sellerInsightLanguage.value : "en";
  setStatus(ui.sellerInsightMsg, "Generating AI insights...");
  const result = await api("/api/ai/seller-insights", {
    method: "POST",
    body: JSON.stringify({ language })
  });

  const lines = String(result.insights || "")
    .replace(/\*\*/g, "")
    .split("\n")
    .map(function(x) { return x.trim(); })
    .filter(Boolean)
    .map(function(line) { return line.replace(/^[\-\*\u2022]\s*/, "").replace(/^\d+[\).\s-]*/, "").trim(); })
    .filter(Boolean)
    .slice(0, 8);

  if (ui.sellerAiInsights) {
    ui.sellerAiInsights.innerHTML = lines.length
      ? "<ul style=\"margin:0.3rem 0 0 1rem;\">" + lines.map(function(x) { return "<li>" + x + "</li>"; }).join("") + "</ul>"
      : "<p>No AI insights returned.</p>";
  }
  setStatus(ui.sellerInsightMsg, "AI insights ready.");
}

async function loadSellerOrders() {
  if (!state.me || state.me.role !== "seller") return;
  if (!ui.sellerOrders) return;

  const result = await api("/api/orders/seller");
  if (ui.sellerOrders) ui.sellerOrders.innerHTML = result.orders.length
    ? result.orders.map(function(o) {
        const itemsHtml = (o.items || []).map(function(i) {
          return "<li>" + i.listing_name + " \u00D7 " + i.qty + " @ " + fmt(i.price_at_purchase) + "</li>";
        }).join("");
        let actionHtml = "";
        if (o.status === "ARRIVED_CONFIRMED") {
          actionHtml = "<button class=\"btn btn--ghost\" style=\"margin-top:0.4rem;font-size:0.85em;\" data-confirm-payment=\"" + o.id + "\">Confirm Payment Received</button>";
        } else if (o.status === "PAID") {
          actionHtml = "<button class=\"btn btn--ghost\" style=\"margin-top:0.4rem;font-size:0.85em;\" data-download-receipt=\"" + o.id + "\">Download Confirmed Receipt (PDF)</button>";
        }
        return "<li>"
          + "<div style=\"display:flex;justify-content:space-between;\">"
          + "<strong>Order #" + o.id + "</strong>"
          + "<span class=\"status\" style=\"font-size:0.85em;\">" + o.status + "</span>"
          + "</div>"
          + "<div style=\"font-size:0.85em;color:var(--muted);\">Buyer: " + (o.buyer_name || ("#" + o.buyer_id)) + " \u00B7 " + ((o.created_at || "").slice(0, 10)) + "</div>"
          + (itemsHtml ? "<ul style=\"margin:0.3rem 0 0 1rem;font-size:0.85em;\">" + itemsHtml + "</ul>" : "")
          + actionHtml
          + "</li>";
      }).join("")
    : "<li style=\"color:var(--muted);\"><em>No orders received yet.</em></li>";
}

async function loadAdminData() {
  if (!state.me || state.me.role !== "admin") return;

  const results = await Promise.allSettled([
    api("/api/admin/pending-sellers"),
    api("/api/admin/dashboard"),
    api("/api/admin/feedback"),
    api("/api/admin/users")
  ]);

  const pendingRes = results[0].status === "fulfilled" ? results[0].value : { pending: [] };
  const dashRes = results[1].status === "fulfilled" ? results[1].value : { counts: {}, recentReviews: [] };
  const feedbackRes = results[2].status === "fulfilled" ? results[2].value : { feedback: [] };
  const usersRes = results[3].status === "fulfilled" ? results[3].value : { users: [] };

  if (ui.pendingSellers) ui.pendingSellers.innerHTML = pendingRes.pending.length
    ? pendingRes.pending.map(function(s) {
        return "<li>"
          + "<div><strong>" + (s.businessName || s.name) + "</strong> \u2014 " + s.email + (s.location ? " \u00B7 " + s.location : "") + "</div>"
          + "<div style=\"font-size:0.85em;color:var(--muted);\">Registered: " + ((s.createdAt || "").slice(0, 10)) + "</div>"
          + "<div style=\"display:flex;gap:0.4rem;margin-top:0.4rem;flex-wrap:wrap;\">"
          + "<button class=\"btn btn--ghost\" style=\"font-size:0.85em;\" data-approve=\"" + s.id + "\">\u2713 Approve</button>"
          + "<button class=\"btn btn--ghost\" style=\"font-size:0.85em;color:#b24a3a;\" data-reject=\"" + s.id + "\">\u2717 Reject</button>"
          + (s.verificationFileId ? "<a class=\"btn btn--ghost\" style=\"font-size:0.85em;\" href=\"/api/files/" + s.verificationFileId + "\" target=\"_blank\">View Doc</a>" : "")
          + "</div>"
          + "</li>";
      }).join("")
    : "<li style=\"color:var(--muted);\"><em>No pending sellers.</em></li>";

  const c = dashRes.counts || {};
  if (ui.adminStats) ui.adminStats.innerHTML = [
    "Total users: " + (c.users || 0),
    "Buyers: " + (c.buyers || 0) + " \u00B7 Sellers: " + (c.sellers || 0) + " (" + (c.pendingSellers || 0) + " pending approval)",
    "Listings: " + (c.listings || 0) + " (" + (c.activeListings || 0) + " active)",
    "Orders: " + (c.orders || 0),
    "Reviews: " + (c.reviews || 0),
    "Feedback entries: " + (c.feedback || 0)
  ].map(function(line) { return "<li>" + line + "</li>"; }).join("");

  if (ui.adminReviews) ui.adminReviews.innerHTML = (dashRes.recentReviews || []).length
    ? (dashRes.recentReviews || []).map(function(r) {
        return "<li><strong>" + r.rating + "/5</strong> by " + r.buyer_name + " for " + r.seller_name + ": \u201C" + r.comment + "\u201D <span style=\"color:var(--muted);font-size:0.8em;\">(" + ((r.created_at || "").slice(0, 10)) + ")</span></li>";
      }).join("")
    : "<li style=\"color:var(--muted);\"><em>No reviews yet.</em></li>";

  if (ui.adminFeedback) {
    ui.adminFeedback.innerHTML = feedbackRes.feedback.length
      ? feedbackRes.feedback.map(function(f) {
          return "<li><strong>" + f.user_name + "</strong>: \u201C" + f.message + "\u201D <span style=\"color:var(--muted);font-size:0.8em;\">(" + String(f.created_at || "").slice(0, 10) + ")</span></li>";
        }).join("")
      : "<li style=\"color:var(--muted);\"><em>No feedback yet.</em></li>";
  }

  state.adminUsers = usersRes.users || [];
  renderAdminUsers();
}

function renderAdminUsers() {
  if (!ui.adminUsers) return;
  const q = ((ui.adminUserSearch && ui.adminUserSearch.value) || "").toLowerCase();
  const filtered = q
    ? state.adminUsers.filter(function(u) {
        return (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q);
      })
    : state.adminUsers;

  if (ui.adminUsers) ui.adminUsers.innerHTML = filtered.length
    ? filtered.map(function(u) {
        const roleLabel = u.role + (u.role === "seller" ? (u.isApproved ? " \u2713" : u.isRejected ? " \u2717" : " \u23F3") : "");
        return "<li style=\"font-size:0.85em;padding:0.4rem 0;\">"
          + "<div><strong>" + u.name + "</strong> \u2014 " + u.email
          + " <span class=\"status\" style=\"font-size:0.8em;\">[" + roleLabel + "]</span></div>"
          + (u.role !== "admin"
              ? "<button class=\"btn btn--ghost\" style=\"font-size:0.75em;padding:0.2rem 0.5rem;margin-top:0.25rem;color:#b24a3a;\" data-delete-user=\"" + u.id + "\">Delete user</button>"
              : "")
          + "</li>";
      }).join("")
    : "<li style=\"color:var(--muted);\"><em>No users found.</em></li>";
}

async function reloadAll() {
  await loadMe();
  await Promise.allSettled([
    loadListings(),
    loadPublicReviews(),
    loadBuyerData(),
    loadSellerData(),
    loadSellerOrders(),
    loadAdminData()
  ]);
}

// ──── Event handlers ────

safeOn(ui.logoutBtn, "click", function() { logoutToAuth(); });
safeOn(ui.adminUserSearch, "input", renderAdminUsers);

if (ui.search) ui.search.addEventListener("input", renderListings);
if (ui.category) ui.category.addEventListener("input", renderListings);
if (ui.maxPrice) ui.maxPrice.addEventListener("input", renderListings);
if (ui.sortOrder) ui.sortOrder.addEventListener("change", renderListings);

document.addEventListener("click", async function(event) {
      // Download confirmed receipt (buyer/seller)
      const downloadReceiptBtn = event.target.closest("[data-download-receipt]");
      if (downloadReceiptBtn) {
        const orderId = downloadReceiptBtn.dataset.downloadReceipt;
        downloadReceiptBtn.disabled = true;
        downloadReceiptBtn.textContent = 'Downloading...';
        try {
          const token = localStorage.getItem('token');
          const resp = await fetch(`/api/orders/${orderId}/receipt`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (!resp.ok) throw new Error('Failed to fetch receipt');
          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `receipt_order_${orderId}.pdf`;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 100);
          downloadReceiptBtn.textContent = 'Download Confirmed Receipt (PDF)';
          downloadReceiptBtn.disabled = false;
        } catch (err) {
          downloadReceiptBtn.textContent = 'Download Failed';
          downloadReceiptBtn.disabled = false;
          alert('Could not download receipt: ' + err.message);
        }
        return;
      }
    // Seller confirms payment
    const confirmPaymentBtn = event.target.closest("[data-confirm-payment]");
    if (confirmPaymentBtn) {
      try {
        await api("/api/orders/" + confirmPaymentBtn.dataset.confirmPayment + "/confirm-payment", { method: "POST" });
        setStatus(ui.sellerApproval, "Payment confirmed for order.");
        await loadSellerOrders();
        await loadBuyerData();
      } catch (err) {
        setStatus(ui.sellerApproval, err.message, true);
      }
      return;
    }
  // Add to cart
  const addBtn = event.target.closest("[data-add]");
  if (addBtn) {
    if (!state.me || state.me.role !== "buyer") {
      setStatus(ui.orderMsg, "Only buyers can add items to cart.", true);
      return;
    }
    const listing = state.listings.find(function(l) { return String(l.id) === String(addBtn.dataset.add); });
    if (!listing) return;
    const existing = state.cart.find(function(c) { return c.listingId === listing.id; });
    if (existing) existing.qty += 1;
    else state.cart.push({ listingId: listing.id, name: listing.name, price: Number(listing.price), qty: 1 });
    renderCart();
    setStatus(ui.orderMsg, "\u201C" + listing.name + "\u201D added to cart.");
    return;
  }

  const cartDecBtn = event.target.closest("[data-cart-dec]");
  if (cartDecBtn) {
    const idx = state.cart.findIndex(function(c) { return String(c.listingId) === String(cartDecBtn.dataset.cartDec); });
    if (idx !== -1) {
      state.cart[idx].qty -= 1;
      if (state.cart[idx].qty <= 0) state.cart.splice(idx, 1);
      renderCart();
    }
    return;
  }

  const cartIncBtn = event.target.closest("[data-cart-inc]");
  if (cartIncBtn) {
    const idx = state.cart.findIndex(function(c) { return String(c.listingId) === String(cartIncBtn.dataset.cartInc); });
    if (idx !== -1) { state.cart[idx].qty += 1; renderCart(); }
    return;
  }

  const cartRemoveBtn = event.target.closest("[data-cart-remove]");
  if (cartRemoveBtn) {
    state.cart = state.cart.filter(function(c) { return String(c.listingId) !== String(cartRemoveBtn.dataset.cartRemove); });
    renderCart();
    return;
  }

  // Confirm arrival
  const confirmBtn = event.target.closest("[data-confirm]");
  if (confirmBtn) {
    try {
      await api("/api/orders/" + confirmBtn.dataset.confirm + "/confirm-arrival", { method: "POST" });
      setStatus(ui.orderMsg, "Arrival confirmed! You can now leave a review.");
      await loadBuyerData();
      await loadPublicReviews();
    } catch (err) {
      setStatus(ui.orderMsg, err.message, true);
    }
    return;
  }

  // Approve seller
  const approveBtn = event.target.closest("[data-approve]");
  if (approveBtn) {
    try {
      await api("/api/admin/sellers/" + approveBtn.dataset.approve + "/approve", { method: "POST" });
      await loadAdminData();
      await loadListings();
    } catch (err) { alert(err.message); }
    return;
  }

  // Reject seller
  const rejectBtn = event.target.closest("[data-reject]");
  if (rejectBtn) {
    if (!confirm("Reject this seller? Their listings will be deactivated.")) return;
    try {
      await api("/api/admin/sellers/" + rejectBtn.dataset.reject + "/reject", { method: "POST" });
      await loadAdminData();
      await loadListings();
    } catch (err) { alert(err.message); }
    return;
  }

  // Delete user (admin)
  const deleteUserBtn = event.target.closest("[data-delete-user]");
  if (deleteUserBtn) {
    if (!confirm("Permanently delete this user? This cannot be undone.")) return;
    try {
      await api("/api/admin/users/" + deleteUserBtn.dataset.deleteUser, { method: "DELETE" });
      await loadAdminData();
    } catch (err) { alert(err.message); }
    return;
  }

  // Toggle listing (seller)
  const toggleBtn = event.target.closest("[data-toggle-listing]");
  if (toggleBtn) {
    const isActive = Number(toggleBtn.dataset.active);
    try {
      await api("/api/listings/" + toggleBtn.dataset.toggleListing, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !isActive })
      });
      await loadSellerData();
      await loadListings();
    } catch (err) { setStatus(ui.listingMsg, err.message, true); }
    return;
  }

  // Delete listing (seller)
  const deleteListingBtn = event.target.closest("[data-delete-listing]");
  if (deleteListingBtn) {
    if (!confirm("Delete this listing? This cannot be undone.")) return;
    try {
      await api("/api/listings/" + deleteListingBtn.dataset.deleteListing, { method: "DELETE" });
      setStatus(ui.listingMsg, "Listing deleted.");
      await loadSellerData();
      await loadListings();
    } catch (err) { setStatus(ui.listingMsg, err.message, true); }
    return;
  }

  // AI card insight
  const insightBtn = event.target.closest("[data-insight]");
  if (insightBtn) {
    ui.cardAiModal.classList.remove("hidden");
    if (ui.cardAiModal) ui.cardAiModal.dataset.listingId = String(Number(insightBtn.dataset.insight));
    if (ui.cardAiQuestion) ui.cardAiQuestion.value = "Should I continue with this purchase? Analyze product photo and store trustworthiness.";
    syncCardLanguageUi();
    try {
      await runCardAiAnalysis(Number(insightBtn.dataset.insight), ui.cardAiQuestion ? ui.cardAiQuestion.value : "");
    } catch (err) {
      ui.cardAiText.textContent = err.message;
    }
    return;
  }

  // Message seller
  const msgSellerBtn = event.target.closest("[data-msg-seller]");
  if (msgSellerBtn) {
    const sellerId = msgSellerBtn.dataset.msgSeller;
    const listingId = msgSellerBtn.dataset.msgListing;
    const sellerName = msgSellerBtn.dataset.msgName || "the seller";
    const body = prompt("Message to " + sellerName + ":");
    if (!body || !body.trim()) return;
    try {
      await api("/api/messages", {
        method: "POST",
        body: JSON.stringify({ recipientId: Number(sellerId), listingId: Number(listingId), body: body.trim() })
      });
      alert("Message sent!");
    } catch (err) { alert(err.message); }
    return;
  }
});

// Place order
safeOn(ui.placeOrderBtn, "click", async function() {
  if (!state.cart.length) {
    setStatus(ui.orderMsg, "Cart is empty.", true);
    return;
  }
  const deliveryLocation = document.getElementById("order-location").value.trim();
  if (!deliveryLocation) {
    setStatus(ui.orderMsg, "Please enter a delivery location.", true);
    return;
  }
  try {
    const res = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        items: state.cart.map(function(item) { return { listingId: item.listingId, qty: item.qty }; }),
        deliveryLocation: deliveryLocation
      })
    });
    state.cart = [];
    renderCart();
    if (ui.orderMsg) {
      setStatus(
        ui.orderMsg,
        "Order placed successfully! <button id='download-receipt-btn' class='btn btn--ghost' style='margin-left:0.5rem;'>Download Receipt (PDF)</button>"
      );
      // Attach handler for receipt download
      setTimeout(function() {
        const btn = document.getElementById('download-receipt-btn');
        if (btn) {
          btn.addEventListener('click', async function() {
            btn.disabled = true;
            btn.textContent = 'Downloading...';
            try {
              const token = localStorage.getItem('token');
              const resp = await fetch(`/api/orders/${res.order.id}/receipt`, {
                headers: { Authorization: `Bearer ${token}` }
              });
              if (!resp.ok) throw new Error('Failed to fetch receipt');
              const blob = await resp.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `receipt_order_${res.order.id}.pdf`;
              document.body.appendChild(a);
              a.click();
              setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }, 100);
              btn.textContent = 'Download Receipt (PDF)';
              btn.disabled = false;
            } catch (err) {
              btn.textContent = 'Download Failed';
              btn.disabled = false;
              alert('Could not download receipt: ' + err.message);
            }
          });
        }
      }, 100);
    } else {
      console.warn("[Order] orderMsg element not found, cannot show receipt link.");
    }
    await loadBuyerData();
  } catch (err) {
    if (ui.orderMsg) {
      setStatus(ui.orderMsg, err.message, true);
    } else {
      console.error("[Order] orderMsg element not found:", err.message);
    }
  }
});

safeOn(ui.reviewOrder, "change", function() {
  // Populate products for the selected order
  const order = state.eligibleOrders.find(function(o) { return String(o.id) === String(ui.reviewOrder.value); });
  if (!order) {
    ui.reviewProduct.innerHTML = "<option value=\"\">— Select product —</option>";
    return;
  }
  const options = (order.items || []).map(function(item) {
    return "<option value=\"" + item.listing_id + "\">" + item.listing_name + "</option>";
  }).join("");
  ui.reviewProduct.innerHTML = "<option value=\"\">— Select product —</option>" + options;
});

safeOn(ui.reviewForm, "submit", async function(event) {
  event.preventDefault();
  try {
    await api("/api/reviews", {
      method: "POST",
      body: JSON.stringify({
        orderId: Number(ui.reviewOrder.value),
        sellerId: Number(ui.reviewProduct.value),
        comment: document.getElementById("review-comment").value
      })
    });
    setStatus(ui.reviewMsg, "Review published!");
    ui.reviewForm.reset();
    await loadBuyerData();
    await loadListings();
    await loadPublicReviews();
  } catch (err) {
    setStatus(ui.reviewMsg, err.message, true);
  }
});

// Store rating form
safeOn(ui.ratingOrder, "change", function() {
  // Populate sellers for the selected order
  const order = state.eligibleOrders.find(function(o) { return String(o.id) === String(ui.ratingOrder.value); });
  if (!order) {
    ui.ratingSeller.innerHTML = "<option value=\"\">— Select store —</option>";
    return;
  }
  const sellerMap = new Map();
  (order.items || []).forEach(function(item) {
    if (!sellerMap.has(item.seller_id)) {
      sellerMap.set(item.seller_id, item.seller_name || ("Seller #" + item.seller_id));
    }
  });
  const options = Array.from(sellerMap.entries()).map(function(entry) {
    return "<option value=\"" + entry[0] + "\">" + entry[1] + "</option>";
  }).join("");
  ui.ratingSeller.innerHTML = "<option value=\"\">— Select store —</option>" + options;
});

safeOn(ui.ratingForm, "submit", async function(event) {
  event.preventDefault();
  try {
    await api("/api/ratings", {
      method: "POST",
      body: JSON.stringify({
        orderId: Number(ui.ratingOrder.value),
        sellerId: Number(ui.ratingSeller.value),
        rating: Number(ui.ratingScore.value)
      })
    });
    setStatus(ui.ratingMsg, "Store rating submitted!");
    ui.ratingForm.reset();
    await loadBuyerData();
    await loadListings();
    await loadPublicReviews();
  } catch (err) {
    setStatus(ui.ratingMsg, err.message, true);
  }
});

// Store rating filter
safeOn(ui.filterStoreRating, "change", function() {
  renderListings();
});

safeOn(ui.feedbackForm, "submit", async function(event) {
  event.preventDefault();
  try {
    await api("/api/feedback", {
      method: "POST",
      body: JSON.stringify({ message: ui.feedbackInput.value })
    });
    ui.feedbackForm.reset();
    setStatus(ui.feedbackMsg, "Feedback submitted. Thank you!");
  } catch (err) {
    setStatus(ui.feedbackMsg, err.message, true);
  }
});

safeOn(ui.listingForm, "submit", async function(event) {
  event.preventDefault();
  const fd = new FormData();
  fd.append("name", document.getElementById("lst-name").value);
  fd.append("description", document.getElementById("lst-description").value);
  fd.append("category", document.getElementById("lst-category").value);
  fd.append("quantityUnit", document.getElementById("lst-qty").value);
  fd.append("price", document.getElementById("lst-price").value);

  const stockEl = document.getElementById("lst-stock");
  if (stockEl && stockEl.value.trim() !== "") fd.append("stock", stockEl.value.trim());

  const imgEl = document.getElementById("lst-image");
  if (imgEl && imgEl.files[0]) fd.append("image", imgEl.files[0]);

  try {
    await api("/api/listings", { method: "POST", body: fd });
    setStatus(ui.listingMsg, "Listing published successfully!");
    ui.listingForm.reset();
    await loadSellerData();
    await loadListings();
  } catch (err) {
    setStatus(ui.listingMsg, err.message, true);
  }
});

safeOn(ui.settingsOpen, "click", function() { ui.settingsModal.classList.remove("hidden"); });
safeOn(ui.settingsClose, "click", function() { ui.settingsModal.classList.add("hidden"); });

document.addEventListener("click", function(e) {
  if (e.target === ui.settingsModal) ui.settingsModal.classList.add("hidden");
  if (e.target === ui.cardAiModal) ui.cardAiModal.classList.add("hidden");
});

safeOn(ui.settingsForm, "submit", async function(event) {
  event.preventDefault();
  try {
    await api("/api/users/me", {
      method: "PATCH",
      body: JSON.stringify({
        name: document.getElementById("set-name").value,
        businessName: document.getElementById("set-business").value,
        location: document.getElementById("set-location").value,
        bio: document.getElementById("set-bio").value,
        languagePref: document.getElementById("set-language").value
      })
    });
    setStatus(ui.settingsMsg, "Settings saved.");
    await loadMe();
    await loadListings();
  } catch (err) {
    setStatus(ui.settingsMsg, err.message, true);
  }
});

safeOn(ui.cardAiClose, "click", function() { ui.cardAiModal.classList.add("hidden"); });
safeOn(ui.sellerInsightBtn, "click", async function() {
  if (ui.sellerInsightBtn) ui.sellerInsightBtn.disabled = true;
  try {
    await generateSellerAiInsights();
  } catch (err) {
    setStatus(ui.sellerInsightMsg, err.message, true);
  } finally {
    if (ui.sellerInsightBtn) ui.sellerInsightBtn.disabled = false;
  }
});
safeOn(ui.cardAiLangEn, "click", function() {
  state.cardAiLanguage = "en";
  syncCardLanguageUi();
});
safeOn(ui.cardAiLangSw, "click", function() {
  state.cardAiLanguage = "sw";
  syncCardLanguageUi();
});
safeOn(ui.cardAiRun, "click", async function() {
  const listingId = ui.cardAiModal ? Number(ui.cardAiModal.dataset.listingId || 0) : 0;
  if (!listingId) {
    if (ui.cardAiText) ui.cardAiText.textContent = "Open AI from a product card first.";
    return;
  }
  try {
    await runCardAiAnalysis(listingId, ui.cardAiQuestion ? ui.cardAiQuestion.value : "");
  } catch (err) {
    if (ui.cardAiText) ui.cardAiText.textContent = err.message;
  }
});

async function init() {
  try {
    syncCardLanguageUi();
    await reloadAll();
    initFloatingChat();
  } catch (err) {
    console.error("[init error]", err);
    logoutToAuth();
  }
}

init();
