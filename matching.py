# Contains the trading matching engine.
#
# Design
# ------
# * Order        - a single buy/sell order with a remaining quantity.
# * red_black_tree - a self-balancing BST (CLRS-style with a NIL sentinel).
#                  Each node owns one price level whose value is a FIFO queue
#                  of orders, giving us price-time priority.
# * MatchingEngine - holds a bid tree and an ask tree. Incoming orders are
#                  matched against the opposite book; whatever is left rests
#                  in its own book.

from collections import deque
import itertools

RED = True
BLACK = False


class Order:
    """A single resting or incoming order.

    `quantity` is the *remaining* quantity and shrinks as the order fills.
    """

    def __init__(self, order_id, account, side, quantity, price):
        self.order_id = order_id
        self.account = account
        self.side = side  # "buy" or "sell"
        self.quantity = quantity
        self.price = price

    @property
    def is_filled(self):
        return self.quantity <= 0

    def __repr__(self):
        return (
            f"Order(id={self.order_id}, account={self.account!r}, "
            f"side={self.side}, qty={self.quantity}, price={self.price})"
        )


class Trade:
    """A single execution produced when two orders cross."""

    def __init__(self, price, quantity, buy_order_id, sell_order_id, aggressor):
        self.price = price
        self.quantity = quantity
        self.buy_order_id = buy_order_id
        self.sell_order_id = sell_order_id
        self.aggressor = aggressor  # side of the incoming order that triggered it

    def __repr__(self):
        return (
            f"Trade(price={self.price}, qty={self.quantity}, "
            f"buy={self.buy_order_id}, sell={self.sell_order_id}, "
            f"aggressor={self.aggressor})"
        )


class TreeNode:
    """A node in the red-black tree. Holds one price level (`key`) whose
    `value` is the FIFO queue of orders resting at that price."""

    def __init__(self, key, value, color=RED, parent=None, left=None, right=None):
        self.key = key
        self.value = value
        self.color = color
        self.parent = parent
        self.left = left
        self.right = right


class red_black_tree:
    """Order-book index keyed by price.

    Supports the operations a matching engine needs: insert, delete, lookup,
    and find-min / find-max to read the best price in O(log n).
    """

    def __init__(self):
        # Single shared sentinel for all leaves/parents — simplifies fixups.
        self.NIL = TreeNode(key=None, value=None, color=BLACK)
        self.NIL.left = self.NIL
        self.NIL.right = self.NIL
        self.NIL.parent = self.NIL
        self.root = self.NIL

    def is_empty(self):
        return self.root is self.NIL

    # ---- lookups -------------------------------------------------------
    def _find_node(self, key):
        node = self.root
        while node is not self.NIL:
            if key == node.key:
                return node
            node = node.left if key < node.key else node.right
        return None

    def get(self, key):
        node = self._find_node(key)
        return node.value if node is not None else None

    def contains(self, key):
        return self._find_node(key) is not None

    def min_node(self):
        """Node with the smallest key (None if empty)."""
        if self.is_empty():
            return None
        return self._subtree_min(self.root)

    def max_node(self):
        """Node with the largest key (None if empty)."""
        if self.is_empty():
            return None
        node = self.root
        while node.right is not self.NIL:
            node = node.right
        return node

    def _subtree_min(self, node):
        while node.left is not self.NIL:
            node = node.left
        return node

    # ---- rotations -----------------------------------------------------
    def _left_rotate(self, x):
        y = x.right
        x.right = y.left
        if y.left is not self.NIL:
            y.left.parent = x
        y.parent = x.parent
        if x.parent is self.NIL:
            self.root = y
        elif x is x.parent.left:
            x.parent.left = y
        else:
            x.parent.right = y
        y.left = x
        x.parent = y

    def _right_rotate(self, x):
        y = x.left
        x.left = y.right
        if y.right is not self.NIL:
            y.right.parent = x
        y.parent = x.parent
        if x.parent is self.NIL:
            self.root = y
        elif x is x.parent.right:
            x.parent.right = y
        else:
            x.parent.left = y
        y.right = x
        x.parent = y

    # ---- insert --------------------------------------------------------
    def insert(self, key, value):
        """Insert a key/value, or update the value if the key already exists.
        Returns the node holding the key."""
        existing = self._find_node(key)
        if existing is not None:
            existing.value = value
            return existing

        node = TreeNode(
            key, value, color=RED, parent=self.NIL, left=self.NIL, right=self.NIL
        )
        y = self.NIL
        x = self.root
        while x is not self.NIL:
            y = x
            x = x.left if node.key < x.key else x.right
        node.parent = y
        if y is self.NIL:
            self.root = node
        elif node.key < y.key:
            y.left = node
        else:
            y.right = node
        self._insert_fixup(node)
        return node

    def _insert_fixup(self, z):
        while z.parent.color == RED:
            if z.parent is z.parent.parent.left:
                y = z.parent.parent.right  # uncle
                if y.color == RED:
                    z.parent.color = BLACK
                    y.color = BLACK
                    z.parent.parent.color = RED
                    z = z.parent.parent
                else:
                    if z is z.parent.right:
                        z = z.parent
                        self._left_rotate(z)
                    z.parent.color = BLACK
                    z.parent.parent.color = RED
                    self._right_rotate(z.parent.parent)
            else:
                y = z.parent.parent.left  # uncle
                if y.color == RED:
                    z.parent.color = BLACK
                    y.color = BLACK
                    z.parent.parent.color = RED
                    z = z.parent.parent
                else:
                    if z is z.parent.left:
                        z = z.parent
                        self._right_rotate(z)
                    z.parent.color = BLACK
                    z.parent.parent.color = RED
                    self._left_rotate(z.parent.parent)
        self.root.color = BLACK

    # ---- delete --------------------------------------------------------
    def _transplant(self, u, v):
        if u.parent is self.NIL:
            self.root = v
        elif u is u.parent.left:
            u.parent.left = v
        else:
            u.parent.right = v
        v.parent = u.parent

    def delete(self, key):
        """Remove a key. Returns True if it was present."""
        z = self._find_node(key)
        if z is None:
            return False
        y = z
        y_original_color = y.color
        if z.left is self.NIL:
            x = z.right
            self._transplant(z, z.right)
        elif z.right is self.NIL:
            x = z.left
            self._transplant(z, z.left)
        else:
            y = self._subtree_min(z.right)
            y_original_color = y.color
            x = y.right
            if y.parent is z:
                x.parent = y
            else:
                self._transplant(y, y.right)
                y.right = z.right
                y.right.parent = y
            self._transplant(z, y)
            y.left = z.left
            y.left.parent = y
            y.color = z.color
        if y_original_color == BLACK:
            self._delete_fixup(x)
        return True

    def _delete_fixup(self, x):
        while x is not self.root and x.color == BLACK:
            if x is x.parent.left:
                w = x.parent.right  # sibling
                if w.color == RED:
                    w.color = BLACK
                    x.parent.color = RED
                    self._left_rotate(x.parent)
                    w = x.parent.right
                if w.left.color == BLACK and w.right.color == BLACK:
                    w.color = RED
                    x = x.parent
                else:
                    if w.right.color == BLACK:
                        w.left.color = BLACK
                        w.color = RED
                        self._right_rotate(w)
                        w = x.parent.right
                    w.color = x.parent.color
                    x.parent.color = BLACK
                    w.right.color = BLACK
                    self._left_rotate(x.parent)
                    x = self.root
            else:
                w = x.parent.left  # sibling
                if w.color == RED:
                    w.color = BLACK
                    x.parent.color = RED
                    self._right_rotate(x.parent)
                    w = x.parent.left
                if w.right.color == BLACK and w.left.color == BLACK:
                    w.color = RED
                    x = x.parent
                else:
                    if w.left.color == BLACK:
                        w.right.color = BLACK
                        w.color = RED
                        self._left_rotate(w)
                        w = x.parent.left
                    w.color = x.parent.color
                    x.parent.color = BLACK
                    w.left.color = BLACK
                    self._right_rotate(x.parent)
                    x = self.root
        x.color = BLACK


class MatchingEngine:
    """A price-time-priority matching engine backed by two red-black trees."""

    def __init__(self):
        self.bids = red_black_tree()  # buy orders;  best = highest price
        self.asks = red_black_tree()  # sell orders; best = lowest price
        self.trades = []
        self._id_counter = itertools.count(1)

    # ---- order creation ------------------------------------------------
    def create_order(self, account, side, quantity, price, order_id=None):
        """Build (but don't yet submit) a new order with validation."""
        if side not in ("buy", "sell"):
            raise ValueError("side must be 'buy' or 'sell'")
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        if order_id is None:
            order_id = next(self._id_counter)
        return Order(order_id, account, side, quantity, price)

    def place_order(self, account, side, quantity, price, order_id=None):
        """Convenience: create an order and immediately submit it."""
        order = self.create_order(account, side, quantity, price, order_id)
        return self.submit(order)

    # ---- submission / matching ----------------------------------------
    def submit(self, order):
        """Match `order` against the opposite book, then rest any remainder.

        Returns the order (whose `quantity` is the unfilled remainder)."""
        if order.side == "buy":
            # A buy crosses an ask when the ask price is at or below our bid.
            self._match(order, self.asks, best=lambda t: t.min_node(),
                        crosses=lambda incoming, resting: resting <= incoming)
            if order.quantity > 0:
                self._rest(order, self.bids)
        else:
            # A sell crosses a bid when the bid price is at or above our ask.
            self._match(order, self.bids, best=lambda t: t.max_node(),
                        crosses=lambda incoming, resting: resting >= incoming)
            if order.quantity > 0:
                self._rest(order, self.asks)
        return order

    def _match(self, incoming, book, best, crosses):
        """Fill `incoming` against `book` while prices cross and qty remains."""
        while incoming.quantity > 0 and not book.is_empty():
            node = best(book)
            if not crosses(incoming.price, node.key):
                break  # best price on the book no longer crosses — stop.

            queue = node.value  # FIFO of resting orders at this price level
            while incoming.quantity > 0 and queue:
                resting = queue[0]
                traded = min(incoming.quantity, resting.quantity)
                incoming.quantity -= traded
                resting.quantity -= traded

                # Executions happen at the resting (passive) order's price.
                if incoming.side == "buy":
                    buy_id, sell_id = incoming.order_id, resting.order_id
                else:
                    buy_id, sell_id = resting.order_id, incoming.order_id
                self.trades.append(
                    Trade(node.key, traded, buy_id, sell_id, incoming.side)
                )

                if resting.is_filled:
                    queue.popleft()  # pop the fully-filled resting order

            if not queue:
                book.delete(node.key)  # price level exhausted — drop it

    def _rest(self, order, book):
        """Add the unfilled remainder of `order` to its side of the book."""
        level = book.get(order.price)
        if level is None:
            level = deque()
            book.insert(order.price, level)
        level.append(order)

    # ---- introspection -------------------------------------------------
    def best_bid(self):
        node = self.bids.max_node()
        return node.key if node else None

    def best_ask(self):
        node = self.asks.min_node()
        return node.key if node else None


if __name__ == "__main__":
    engine = MatchingEngine()

    # Rest a couple of sell orders on the book.
    engine.place_order("alice", "sell", 10, 101.0)
    engine.place_order("alice", "sell", 5, 100.0)
    print("best bid / ask:", engine.best_bid(), "/", engine.best_ask())

    # A buy that crosses both levels (price-time priority kicks in).
    remainder = engine.place_order("bob", "buy", 12, 101.0)
    print("bob remainder:", remainder.quantity)
    for trade in engine.trades:
        print(" ", trade)

    print("best bid / ask:", engine.best_bid(), "/", engine.best_ask())
