// Matching engine built on two red-black trees (bids + asks).
//
// Unlike the Python reference (which matches an incoming order immediately),
// this version rests every order into its tree first, then crosses the book:
// while the best bid >= the best ask, the two TOP nodes trade. That makes the
// "both tops pop off" behaviour literal and easy to visualize.

import { RedBlackTree } from './RedBlackTree.js'

export class MatchingEngine {
  constructor() {
    this.bids = new RedBlackTree() // buy orders;  best = highest price (maxNode)
    this.asks = new RedBlackTree() // sell orders; best = lowest price (minNode)
    this.idCounter = 1
    this.seq = 1 // monotonic arrival sequence — older order is the price maker
  }

  makeOrder(account, side, quantity, price) {
    if (side !== 'buy' && side !== 'sell') throw new Error("side must be 'buy' or 'sell'")
    if (quantity <= 0) throw new Error('quantity must be positive')
    return {
      order_id: this.idCounter++,
      account,
      side,
      quantity,
      price,
      seq: this.seq++,
    }
  }

  // Rest an order into its book (appends to the price level's FIFO queue).
  addOrder(order) {
    const book = order.side === 'buy' ? this.bids : this.asks
    let level = book.get(order.price)
    if (!level) {
      level = []
      book.insert(order.price, level)
    }
    level.push(order)
  }

  // Cross the book repeatedly. Returns one event per execution describing
  // what traded and whether each top price level was emptied (popped).
  runMatching() {
    const events = []
    while (!this.bids.isEmpty() && !this.asks.isEmpty()) {
      const bidNode = this.bids.maxNode()
      const askNode = this.asks.minNode()
      if (bidNode.key < askNode.key) break // best bid below best ask — no cross

      const bidQ = bidNode.value
      const askQ = askNode.value
      const buy = bidQ[0]
      const sell = askQ[0]
      const traded = Math.min(buy.quantity, sell.quantity)
      // Execution happens at the resting (older) order's price.
      const price = buy.seq < sell.seq ? buy.price : sell.price

      buy.quantity -= traded
      sell.quantity -= traded

      const event = {
        price,
        quantity: traded,
        buyOrderId: buy.order_id,
        sellOrderId: sell.order_id,
        buyAccount: buy.account,
        sellAccount: sell.account,
        bidKey: bidNode.key,
        askKey: askNode.key,
        bidRemoved: false,
        askRemoved: false,
      }

      if (buy.quantity === 0) bidQ.shift()
      if (sell.quantity === 0) askQ.shift()
      if (bidQ.length === 0) {
        this.bids.delete(bidNode.key)
        event.bidRemoved = true
      }
      if (askQ.length === 0) {
        this.asks.delete(askNode.key)
        event.askRemoved = true
      }
      events.push(event)
    }
    return events
  }

  bestBid() {
    const n = this.bids.maxNode()
    return n ? n.key : null
  }

  bestAsk() {
    const n = this.asks.minNode()
    return n ? n.key : null
  }
}
