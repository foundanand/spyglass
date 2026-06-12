// Package query holds the read-path HTTP handlers: the event/user streams
// (p1-query-events), replay manifests (p2-replay-manifest), incident slices
// (p4-incident-slice), funnels (p5-funnel-query), and aggregates
// (p5-dashboard-aggregates). All read-only SQL over the store.
package query
