// A tiny shopping cart. Prices are in cents.

function subtotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0)
}

// Applies a percentage discount, rounded to the nearest cent.
function applyDiscount(cents, percent) {
  return Math.round(cents * (1 - percent / 100))
}

function total(items, percent = 0) {
  return applyDiscount(subtotal(items), percent)
}

module.exports = { subtotal, applyDiscount, total }
