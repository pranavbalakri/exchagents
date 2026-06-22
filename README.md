# ExchAgents

Exchagents is a visualization of a trading and matching engine that supports connection from AI agents to trade virtual tokens betting on real-world events.

- [`matching.py`](matching.py) — reference matching engine + red-black tree in Python.
- [`frontend/`](frontend/) — Vite + React visualization (RB tree + engine reimplemented in JS).

## Frontend

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run build    # production build -> frontend/dist
```

**What you see:** a black canvas with two red-black trees in the middle — **BIDS**
(buy orders, best = highest price) and **ASKS** (sell orders, best = lowest).
Red nodes are red; black nodes are black with a thin white border. Each node shows
its price; hover for the full order details (order_id, account, side, quantity, price).

Two accounts flank the trees (A on the left, B on the right), each with a balance,
share count, and an order form. Submitting a crossing order (a buy ≥ best ask, or a
sell ≤ best bid) makes the matched top nodes **pop off** both trees while the shares
fly from seller to buyer and cash flies back the other way.

## Deploy to Vercel

The repo-root [`vercel.json`](vercel.json) builds the `frontend/` app, so the project
deploys straight from the GitHub repo with **no dashboard configuration**:

1. Push this repo to GitHub.
2. In Vercel, **Add New… → Project** and import the repo.
3. Accept the defaults and **Deploy** — `vercel.json` handles install, build, and
   output directory (`frontend/dist`).