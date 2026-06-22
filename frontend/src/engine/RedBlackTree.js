// A self-balancing red-black tree (CLRS, NIL-sentinel) ported from matching.py.
// Each node owns one price level; node.value is a FIFO array of orders.

export const RED = true
export const BLACK = false

class TreeNode {
  constructor(key, value, color = RED) {
    this.key = key
    this.value = value
    this.color = color
    this.parent = null
    this.left = null
    this.right = null
  }
}

export class RedBlackTree {
  constructor() {
    this.NIL = new TreeNode(null, null, BLACK)
    this.NIL.left = this.NIL
    this.NIL.right = this.NIL
    this.NIL.parent = this.NIL
    this.root = this.NIL
  }

  isEmpty() {
    return this.root === this.NIL
  }

  // ---- lookups ------------------------------------------------------
  _findNode(key) {
    let node = this.root
    while (node !== this.NIL) {
      if (key === node.key) return node
      node = key < node.key ? node.left : node.right
    }
    return null
  }

  get(key) {
    const node = this._findNode(key)
    return node ? node.value : null
  }

  minNode() {
    if (this.isEmpty()) return null
    return this._subtreeMin(this.root)
  }

  maxNode() {
    if (this.isEmpty()) return null
    let node = this.root
    while (node.right !== this.NIL) node = node.right
    return node
  }

  _subtreeMin(node) {
    while (node.left !== this.NIL) node = node.left
    return node
  }

  // ---- rotations ----------------------------------------------------
  _leftRotate(x) {
    const y = x.right
    x.right = y.left
    if (y.left !== this.NIL) y.left.parent = x
    y.parent = x.parent
    if (x.parent === this.NIL) this.root = y
    else if (x === x.parent.left) x.parent.left = y
    else x.parent.right = y
    y.left = x
    x.parent = y
  }

  _rightRotate(x) {
    const y = x.left
    x.left = y.right
    if (y.right !== this.NIL) y.right.parent = x
    y.parent = x.parent
    if (x.parent === this.NIL) this.root = y
    else if (x === x.parent.right) x.parent.right = y
    else x.parent.left = y
    y.right = x
    x.parent = y
  }

  // ---- insert -------------------------------------------------------
  insert(key, value) {
    const existing = this._findNode(key)
    if (existing) {
      existing.value = value
      return existing
    }
    const node = new TreeNode(key, value, RED)
    node.left = this.NIL
    node.right = this.NIL
    node.parent = this.NIL

    let y = this.NIL
    let x = this.root
    while (x !== this.NIL) {
      y = x
      x = node.key < x.key ? x.left : x.right
    }
    node.parent = y
    if (y === this.NIL) this.root = node
    else if (node.key < y.key) y.left = node
    else y.right = node
    this._insertFixup(node)
    return node
  }

  _insertFixup(z) {
    while (z.parent.color === RED) {
      if (z.parent === z.parent.parent.left) {
        const y = z.parent.parent.right
        if (y.color === RED) {
          z.parent.color = BLACK
          y.color = BLACK
          z.parent.parent.color = RED
          z = z.parent.parent
        } else {
          if (z === z.parent.right) {
            z = z.parent
            this._leftRotate(z)
          }
          z.parent.color = BLACK
          z.parent.parent.color = RED
          this._rightRotate(z.parent.parent)
        }
      } else {
        const y = z.parent.parent.left
        if (y.color === RED) {
          z.parent.color = BLACK
          y.color = BLACK
          z.parent.parent.color = RED
          z = z.parent.parent
        } else {
          if (z === z.parent.left) {
            z = z.parent
            this._rightRotate(z)
          }
          z.parent.color = BLACK
          z.parent.parent.color = RED
          this._leftRotate(z.parent.parent)
        }
      }
    }
    this.root.color = BLACK
  }

  // ---- delete -------------------------------------------------------
  _transplant(u, v) {
    if (u.parent === this.NIL) this.root = v
    else if (u === u.parent.left) u.parent.left = v
    else u.parent.right = v
    v.parent = u.parent
  }

  delete(key) {
    const z = this._findNode(key)
    if (!z) return false
    let y = z
    let yOriginalColor = y.color
    let x
    if (z.left === this.NIL) {
      x = z.right
      this._transplant(z, z.right)
    } else if (z.right === this.NIL) {
      x = z.left
      this._transplant(z, z.left)
    } else {
      y = this._subtreeMin(z.right)
      yOriginalColor = y.color
      x = y.right
      if (y.parent === z) {
        x.parent = y
      } else {
        this._transplant(y, y.right)
        y.right = z.right
        y.right.parent = y
      }
      this._transplant(z, y)
      y.left = z.left
      y.left.parent = y
      y.color = z.color
    }
    if (yOriginalColor === BLACK) this._deleteFixup(x)
    return true
  }

  _deleteFixup(x) {
    while (x !== this.root && x.color === BLACK) {
      if (x === x.parent.left) {
        let w = x.parent.right
        if (w.color === RED) {
          w.color = BLACK
          x.parent.color = RED
          this._leftRotate(x.parent)
          w = x.parent.right
        }
        if (w.left.color === BLACK && w.right.color === BLACK) {
          w.color = RED
          x = x.parent
        } else {
          if (w.right.color === BLACK) {
            w.left.color = BLACK
            w.color = RED
            this._rightRotate(w)
            w = x.parent.right
          }
          w.color = x.parent.color
          x.parent.color = BLACK
          w.right.color = BLACK
          this._leftRotate(x.parent)
          x = this.root
        }
      } else {
        let w = x.parent.left
        if (w.color === RED) {
          w.color = BLACK
          x.parent.color = RED
          this._rightRotate(x.parent)
          w = x.parent.left
        }
        if (w.right.color === BLACK && w.left.color === BLACK) {
          w.color = RED
          x = x.parent
        } else {
          if (w.left.color === BLACK) {
            w.right.color = BLACK
            w.color = RED
            this._leftRotate(w)
            w = x.parent.left
          }
          w.color = x.parent.color
          x.parent.color = BLACK
          w.left.color = BLACK
          this._rightRotate(x.parent)
          x = this.root
        }
      }
    }
    x.color = BLACK
  }

  // ---- rendering snapshot ------------------------------------------
  // Returns a flat, serializable description of the tree with an in-order
  // x-index and a depth per node so the UI can lay it out.
  snapshot() {
    const NIL = this.NIL
    const out = []
    let idx = 0
    const assign = (node, depth) => {
      if (node === NIL) return
      assign(node.left, depth + 1)
      node.__x = idx++
      node.__d = depth
      assign(node.right, depth + 1)
    }
    assign(this.root, 0)
    const collect = (node) => {
      if (node === NIL) return
      collect(node.left)
      out.push({
        key: node.key,
        color: node.color,
        orders: node.value.map((o) => ({
          order_id: o.order_id,
          account: o.account,
          side: o.side,
          quantity: o.quantity,
          price: o.price,
        })),
        xIndex: node.__x,
        depth: node.__d,
        leftKey: node.left !== NIL ? node.left.key : null,
        rightKey: node.right !== NIL ? node.right.key : null,
      })
      collect(node.right)
    }
    collect(this.root)
    return out
  }
}
