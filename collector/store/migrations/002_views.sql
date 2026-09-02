-- Saved views and boards.
--
-- The value here is persistence and layout, not expressiveness: `params` is
-- exactly what the existing query endpoints already accept, so this adds a name
-- attached to a parameter set and nothing else. No query language.
--
-- Views are global. The collector has one shared password and no user model,
-- which is right for a 20-200 person tool; adding a user model so somebody
-- could have a private favourite would be the tail wagging the dog.

CREATE TABLE IF NOT EXISTS views (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  -- One of the existing query shapes: flows | funnel | aggregates | events.
  kind        TEXT NOT NULL,
  -- JSON object of query parameters, passed through to the endpoint verbatim.
  params      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS boards (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- A board is an ordered collection of saved views.
--
-- ON DELETE CASCADE on both sides: deleting a view removes it from every board
-- rather than leaving a dangling reference that renders as an error. A board
-- that loses a panel is still a working board.
CREATE TABLE IF NOT EXISTS board_views (
  board_id  INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  view_id   INTEGER NOT NULL REFERENCES views(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  PRIMARY KEY (board_id, view_id)
);

CREATE INDEX IF NOT EXISTS idx_board_views_board ON board_views(board_id, position);
