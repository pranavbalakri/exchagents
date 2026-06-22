// Turn a tree snapshot into pixel positions + edges for rendering.
// x comes from the in-order index, y from depth.

const X_SPACING = 60
const Y_SPACING = 82
const PAD = 36

export function layoutFromSnapshot(snapshot) {
  const nodes = snapshot.map((n) => ({
    ...n,
    x: n.xIndex * X_SPACING + PAD,
    y: n.depth * Y_SPACING + PAD,
  }))
  const byKey = new Map(nodes.map((n) => [n.key, n]))

  const edges = []
  for (const n of nodes) {
    if (n.leftKey !== null && byKey.has(n.leftKey)) {
      const c = byKey.get(n.leftKey)
      edges.push({ id: `${n.key}-L`, x1: n.x, y1: n.y, x2: c.x, y2: c.y })
    }
    if (n.rightKey !== null && byKey.has(n.rightKey)) {
      const c = byKey.get(n.rightKey)
      edges.push({ id: `${n.key}-R`, x1: n.x, y1: n.y, x2: c.x, y2: c.y })
    }
  }

  const maxX = nodes.reduce((m, n) => Math.max(m, n.x), 0)
  const maxY = nodes.reduce((m, n) => Math.max(m, n.y), 0)
  return {
    nodes,
    edges,
    byKey,
    width: Math.max(maxX + PAD + X_SPACING / 2, 220),
    height: Math.max(maxY + PAD, 200),
  }
}
