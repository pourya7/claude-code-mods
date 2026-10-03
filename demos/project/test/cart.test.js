const test = require('node:test')
const assert = require('node:assert')
const { subtotal, applyDiscount, total } = require('../src/cart')

const items = [
  { name: 'pen', price: 150, qty: 2 },
  { name: 'notebook', price: 400, qty: 1 },
]

test('subtotal adds price times quantity', () => {
  assert.strictEqual(subtotal(items), 700)
})

test('applyDiscount takes a percentage off', () => {
  assert.strictEqual(applyDiscount(700, 10), 630)
})

test('total applies the discount to the subtotal', () => {
  assert.strictEqual(total(items, 50), 350)
})
