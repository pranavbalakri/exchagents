import { useState } from 'react'

const fmtMoney = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default function AccountPanel({ account, side, pulse, onSubmit, panelRef }) {
  const [orderSide, setOrderSide] = useState(side === 'left' ? 'buy' : 'sell')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  const [error, setError] = useState('')

  const submit = (e) => {
    e.preventDefault()
    const p = parseFloat(price)
    const q = parseInt(quantity, 10)
    if (!Number.isFinite(p) || p <= 0) return setError('Price must be greater than 0.')
    if (!Number.isInteger(q) || q <= 0) return setError('Quantity must be a positive whole number.')
    setError('')
    onSubmit(account.id, orderSide, p, q)
    setPrice('')
    setQuantity('')
  }

  const submitLabel = orderSide === 'buy' ? 'Place buy order' : 'Place sell order'

  return (
    <div className={`account ${pulse ? 'pulse' : ''}`} ref={panelRef}>
      <div className="account-head">
        <span className={`account-dot ${account.id === 'A' ? 'dot-a' : 'dot-b'}`} />
        <span className="account-name">{account.name}</span>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="stat-label">Balance</span>
          <span className="stat-value">{fmtMoney(account.balance)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Shares</span>
          <span className="stat-value">{account.shares.toLocaleString('en-US')}</span>
        </div>
      </div>

      <form className="order-form" onSubmit={submit}>
        <div className="field">
          <span className="field-label">Side</span>
          <div className="side-toggle" role="group" aria-label="Order side">
            <button
              type="button"
              aria-pressed={orderSide === 'buy'}
              className={`tg-buy ${orderSide === 'buy' ? 'active' : ''}`}
              onClick={() => setOrderSide('buy')}
            >
              Buy
            </button>
            <button
              type="button"
              aria-pressed={orderSide === 'sell'}
              className={`tg-sell ${orderSide === 'sell' ? 'active' : ''}`}
              onClick={() => setOrderSide('sell')}
            >
              Sell
            </button>
          </div>
        </div>

        <label className="field">
          <span className="field-label">Price</span>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="100"
          />
        </label>

        <label className="field">
          <span className="field-label">Quantity</span>
          <input
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="10"
          />
        </label>

        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}

        <button type="submit" className={`submit submit-${orderSide}`}>
          {submitLabel}
        </button>
      </form>
    </div>
  )
}
