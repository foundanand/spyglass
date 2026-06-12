// Package ingest holds the write-path HTTP handlers: POST /v1/events
// (p1-events-ingest) and POST /v1/replay (p2-replay-ingest). It validates app
// keys, CORS origins, and payload limits before handing data to the store.
package ingest
