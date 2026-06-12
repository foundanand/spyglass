// Package store owns persistence: opening SQLite in WAL mode, running numbered
// migrations (p1-schema-migration), batched event inserts (p1-store-open), the
// replay-on-disk layout (p2-replay-disk-layout), and the retention sweep
// (p2-retention-sweep).
//
// The pure-Go modernc.org/sqlite driver is blank-imported here so it registers
// the "sqlite" database/sql driver for the whole binary. No CGo.
package store

import (
	_ "modernc.org/sqlite"
)
