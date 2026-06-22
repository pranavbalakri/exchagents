import { RED } from '../engine/RedBlackTree'

function TreeNode({ node, flash, best }) {
  const isRed = node.color === RED
  return (
    <div
      className={`node ${isRed ? 'red' : 'black'} ${flash ? 'flash' : ''} ${best ? 'best' : ''}`}
      style={{ left: node.x, top: node.y }}
    >
      {best && <span className="best-tag">best</span>}
      <span className="node-price">{node.key}</span>
      <div className="node-tooltip" role="tooltip">
        <div className="tt-head">
          price {node.key} · {node.orders.length} order{node.orders.length === 1 ? '' : 's'}
        </div>
        {node.orders.map((o) => (
          <div className="tt-order" key={o.order_id}>
            <div><span>order_id</span><b>{o.order_id}</b></div>
            <div><span>account</span><b>{o.account}</b></div>
            <div><span>side</span><b className={o.side}>{o.side}</b></div>
            <div><span>quantity</span><b>{o.quantity}</b></div>
            <div><span>price</span><b>{o.price}</b></div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function TreeView({ title, layout, flashKeys, bestKey, innerRef }) {
  return (
    <div className="tree-wrap">
      <div className="tree-title">{title}</div>
      <div className="tree" ref={innerRef} style={{ width: layout.width, height: layout.height }}>
        <svg className="tree-edges" width={layout.width} height={layout.height}>
          {layout.edges.map((e) => (
            <line key={e.id} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
          ))}
        </svg>
        {layout.nodes.map((n) => (
          <TreeNode
            key={n.key}
            node={n}
            flash={flashKeys && flashKeys.has(n.key)}
            best={bestKey !== null && n.key === bestKey}
          />
        ))}
        {layout.nodes.length === 0 && <div className="tree-empty">— empty —</div>}
      </div>
    </div>
  )
}
