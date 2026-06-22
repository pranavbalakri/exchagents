import { useEffect, useMemo, useRef, useState } from 'react'
import { MatchingEngine } from './engine/MatchingEngine'
import { RED } from './engine/RedBlackTree'
import { layoutFromSnapshot } from './engine/layout'
import TreeView from './components/TreeView'
import AccountPanel from './components/AccountPanel'

const INITIAL_ACCOUNTS = {
  A: { id: 'A', name: 'Account A', balance: 50000, shares: 200 },
  B: { id: 'B', name: 'Account B', balance: 50000, shares: 200 },
}

// Seed a resting, non-crossing book so both trees start populated.
function seedEngine(engine) {
  ;[95, 98, 92, 99, 90, 96, 93].forEach((p) =>
    engine.addOrder(engine.makeOrder('B', 'buy', 10, p)),
  )
  ;[105, 102, 108, 101, 110, 104, 107].forEach((p) =>
    engine.addOrder(engine.makeOrder('A', 'sell', 10, p)),
  )
}

export default function App() {
  const engineRef = useRef(null)
  if (engineRef.current === null) {
    const e = new MatchingEngine()
    seedEngine(e)
    engineRef.current = e
  }
  const engine = engineRef.current

  const [bidsSnap, setBidsSnap] = useState(() => engine.bids.snapshot())
  const [asksSnap, setAsksSnap] = useState(() => engine.asks.snapshot())
  const [accounts, setAccounts] = useState(INITIAL_ACCOUNTS)

  // transient animation state
  const [poppers, setPoppers] = useState([])
  const [bursts, setBursts] = useState([])
  const [flights, setFlights] = useState([])
  const [flashBids, setFlashBids] = useState(new Set())
  const [flashAsks, setFlashAsks] = useState(new Set())
  const [pulseAccounts, setPulseAccounts] = useState(new Set())

  const bidTreeRef = useRef(null)
  const askTreeRef = useRef(null)
  const leftRef = useRef(null)
  const rightRef = useRef(null)
  const accountRefs = { A: leftRef, B: rightRef }
  const fxId = useRef(0)
  const uid = () => `fx-${fxId.current++}`

  // Auto-fit the tree group to the center column; pinch / ctrl-scroll to zoom in further.
  const treesViewportRef = useRef(null)
  const [fitScale, setFitScale] = useState(1)
  const [zoom, setZoom] = useState(1)

  const bidLayout = useMemo(() => layoutFromSnapshot(bidsSnap), [bidsSnap])
  const askLayout = useMemo(() => layoutFromSnapshot(asksSnap), [asksSnap])

  const bestBid = bidsSnap.length ? Math.max(...bidsSnap.map((n) => n.key)) : null
  const bestAsk = asksSnap.length ? Math.min(...asksSnap.map((n) => n.key)) : null

  // Auto-fit so the trees always sit between the panels with no horizontal scroll.
  useEffect(() => {
    const vp = treesViewportRef.current
    if (!vp) return
    const GAP = 56 // must match .trees-inner gap
    const compute = () => {
      const avail = vp.clientWidth - 28
      const natural = bidLayout.width + GAP + askLayout.width
      setFitScale(Math.max(0.35, Math.min(1, avail / natural)))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(vp)
    return () => ro.disconnect()
  }, [bidLayout, askLayout])

  // Pinch (trackpad) or ctrl/⌘ + wheel (mouse) zooms the trees. Non-passive so we can
  // preventDefault and stop the browser's own page zoom.
  useEffect(() => {
    const vp = treesViewportRef.current
    if (!vp) return
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      setZoom((z) => Math.max(0.5, Math.min(3, z * Math.exp(-e.deltaY * 0.01))))
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [])

  function handleSubmit(accountId, side, price, quantity) {
    const order = engine.makeOrder(accountId, side, quantity, price)
    engine.addOrder(order)

    // Snapshot/layout BEFORE matching so we know where popped nodes were.
    const preBids = engine.bids.snapshot()
    const preAsks = engine.asks.snapshot()
    const preBidLayout = layoutFromSnapshot(preBids)
    const preAskLayout = layoutFromSnapshot(preAsks)
    const bidRect = bidTreeRef.current?.getBoundingClientRect()
    const askRect = askTreeRef.current?.getBoundingClientRect()

    const events = engine.runMatching()

    // Commit the new tree state.
    setBidsSnap(engine.bids.snapshot())
    setAsksSnap(engine.asks.snapshot())

    if (events.length === 0) return

    // --- accounts: shares + cash change hands -------------------------
    setAccounts((prev) => {
      const next = { A: { ...prev.A }, B: { ...prev.B } }
      for (const ev of events) {
        const cash = ev.price * ev.quantity
        next[ev.buyAccount].balance -= cash
        next[ev.buyAccount].shares += ev.quantity
        next[ev.sellAccount].balance += cash
        next[ev.sellAccount].shares -= ev.quantity
      }
      return next
    })

    // --- pop animations + flashes ------------------------------------
    const newPoppers = []
    const flashB = new Set()
    const flashA = new Set()
    for (const ev of events) {
      const s = fitScale * zoom
      if (ev.bidRemoved && bidRect) {
        const n = preBidLayout.byKey.get(ev.bidKey)
        if (n) newPoppers.push({ id: uid(), x: bidRect.left + n.x * s, y: bidRect.top + n.y * s, key: ev.bidKey, isRed: n.color === RED })
      } else {
        flashB.add(ev.bidKey)
      }
      if (ev.askRemoved && askRect) {
        const n = preAskLayout.byKey.get(ev.askKey)
        if (n) newPoppers.push({ id: uid(), x: askRect.left + n.x * s, y: askRect.top + n.y * s, key: ev.askKey, isRed: n.color === RED })
      } else {
        flashA.add(ev.askKey)
      }
    }
    if (newPoppers.length && bidRect && askRect) {
      // Converge every popped level toward the spread (the gap between trees).
      const targetX = (bidRect.right + askRect.left) / 2
      const targetY = newPoppers.reduce((s, p) => s + p.y, 0) / newPoppers.length
      newPoppers.forEach((p) => {
        p.dx = targetX - p.x
        p.dy = targetY - p.y
      })
      setPoppers((p) => [...p, ...newPoppers])
      const ids = new Set(newPoppers.map((p) => p.id))
      setTimeout(() => setPoppers((p) => p.filter((x) => !ids.has(x.id))), 800)

      // Gold spark where they meet.
      const burstId = uid()
      setBursts((b) => [...b, { id: burstId, x: targetX, y: targetY }])
      setTimeout(() => setBursts((b) => b.filter((x) => x.id !== burstId)), 900)
    }
    setFlashBids(flashB)
    setFlashAsks(flashA)
    setTimeout(() => {
      setFlashBids(new Set())
      setFlashAsks(new Set())
    }, 700)

    // --- share + cash flights between accounts -----------------------
    const aRect = accountRefs.A.current?.getBoundingClientRect()
    const bRect = accountRefs.B.current?.getBoundingClientRect()
    if (aRect && bRect) {
      const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      const newFlights = []
      events.forEach((ev, i) => {
        const seller = center(ev.sellAccount === 'A' ? aRect : bRect)
        const buyer = center(ev.buyAccount === 'A' ? aRect : bRect)
        const delay = i * 120
        // shares move seller -> buyer
        newFlights.push({ id: uid(), kind: 'share', x: seller.x, y: seller.y, dx: buyer.x - seller.x, dy: buyer.y - seller.y, label: `+${ev.quantity}`, delay })
        // cash moves buyer -> seller
        newFlights.push({ id: uid(), kind: 'cash', x: buyer.x, y: buyer.y, dx: seller.x - buyer.x, dy: seller.y - buyer.y, label: `$${(ev.price * ev.quantity).toLocaleString()}`, delay })
      })
      setFlights((f) => [...f, ...newFlights])
      const ids = new Set(newFlights.map((f) => f.id))
      const maxDelay = (events.length - 1) * 120
      setTimeout(() => setFlights((f) => f.filter((x) => !ids.has(x.id))), 1000 + maxDelay)
    }

    // pulse the involved account cards
    const involved = new Set()
    events.forEach((ev) => {
      involved.add(ev.buyAccount)
      involved.add(ev.sellAccount)
    })
    setPulseAccounts(involved)
    setTimeout(() => setPulseAccounts(new Set()), 700)
  }

  const spread = bestBid !== null && bestAsk !== null ? (bestAsk - bestBid).toFixed(2) : '—'

  const eff = fitScale * zoom
  const GAP = 56
  const naturalW = bidLayout.width + GAP + askLayout.width
  const naturalH = Math.max(bidLayout.height, askLayout.height) + 44

  return (
    <div className="app">
      <AccountPanel
        account={accounts.A}
        side="left"
        pulse={pulseAccounts.has('A')}
        onSubmit={handleSubmit}
        panelRef={leftRef}
      />

      <div className="center">
        <header className="center-head">
          <h1>Markets</h1>
          <div className="book-stats">
            <span className="chip">best bid <b className="buy">{bestBid ?? '—'}</b></span>
            <span className="chip">spread <b>{spread}</b></span>
            <span className="chip">best ask <b className="sell">{bestAsk ?? '—'}</b></span>
          </div>
        </header>

        <div className="trees-viewport" ref={treesViewportRef}>
          <div className="trees-sizer" style={{ width: naturalW * eff, height: naturalH * eff }}>
            <div
              className="trees-inner"
              style={{ width: naturalW, height: naturalH, transform: `scale(${eff})` }}
            >
              <TreeView
                title="BIDS"
                layout={bidLayout}
                flashKeys={flashBids}
                bestKey={bestBid}
                innerRef={bidTreeRef}
              />
              <TreeView
                title="ASKS"
                layout={askLayout}
                flashKeys={flashAsks}
                bestKey={bestAsk}
                innerRef={askTreeRef}
              />
            </div>
          </div>
        </div>
      </div>

      <AccountPanel
        account={accounts.B}
        side="right"
        pulse={pulseAccounts.has('B')}
        onSubmit={handleSubmit}
        panelRef={rightRef}
      />

      {/* full-screen animation overlay */}
      <div className="overlay">
        {poppers.map((p) => (
          <div
            key={p.id}
            className={`popper ${p.isRed ? 'red' : 'black'}`}
            style={{ left: p.x, top: p.y, '--dx': `${p.dx ?? 0}px`, '--dy': `${p.dy ?? 0}px` }}
          >
            {p.key}
          </div>
        ))}
        {bursts.map((b) => (
          <div key={b.id} className="burst" style={{ left: b.x, top: b.y }} />
        ))}
        {flights.map((f) => (
          <div
            key={f.id}
            className={`flight ${f.kind}`}
            style={{ left: f.x, top: f.y, '--dx': `${f.dx}px`, '--dy': `${f.dy}px`, '--delay': `${f.delay}ms` }}
          >
            {f.label}
          </div>
        ))}
      </div>
    </div>
  )
}
