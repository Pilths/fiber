"""Route type of a segment, derived from the kinds of its two end sites (sites.kind). Never stored or uploaded.

- both ends data_center              -> DC-DC
- one end data_center, other toc     -> DC-TOC
- one end data_center, other any     -> Metro
- everything else                    -> Trunk

Use over a query that joins sites as `a` (site A) and `b` (site B).
"""
ROUTE_TYPE_SQL = """(CASE
    WHEN a.kind = 'data_center' AND b.kind = 'data_center' THEN 'DC-DC'
    WHEN a.kind = 'data_center' AND b.kind = 'toc' THEN 'DC-TOC'
    WHEN a.kind = 'toc' AND b.kind = 'data_center' THEN 'DC-TOC'
    WHEN a.kind = 'data_center' OR b.kind = 'data_center' THEN 'Metro'
    ELSE 'Trunk'
  END)"""
