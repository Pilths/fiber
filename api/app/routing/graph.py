"""Routing graph: node = site id, edge = segment, weight = distance_km. Routes are not in it.

Built lazily on first use and rebuilt after invalidate(). Callers that change segments call invalidate() after commit.
"""
from threading import Lock

import networkx as nx
from sqlalchemy import text
from sqlalchemy.orm import Session

# A segment with no distance still routes: it weighs this many km and its edge carries no_distance=True.
FALLBACK_KM = 10.0

_lock = Lock()
_graph: nx.Graph | None = None  # ponytail: one process-wide cache; with several workers each rebuilds on its own restart only


def invalidate() -> None:
    global _graph
    with _lock:
        _graph = None


def build(db: Session) -> nx.Graph:
    g = nx.Graph()
    for sid, a, b, km in db.execute(text("SELECT id, site_a_id, site_b_id, distance_km FROM segments WHERE NOT fiber_cut")):
        g.add_edge(a, b, segment_id=sid, weight=float(km) if km is not None else FALLBACK_KM, no_distance=km is None)
    return g


def get_graph(db: Session) -> nx.Graph:
    global _graph
    with _lock:
        if _graph is None:
            _graph = build(db)
        return _graph
