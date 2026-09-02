package dashboard

import "testing"

// Content-hashed chunks may be cached forever; anything whose name is stable
// across builds must revalidate, or a browser keeps serving an app.js that
// points at chunk hashes the new binary no longer contains.
func TestHashedAssetDetection(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		{"replaySurface-WJKVNTB2.js", true},
		{"chunk-RLR2SUFB.js", true},
		{"app.js", false},
		{"app.css", false},
		{"index.html", false},
		{"some-file.js", false},        // suffix too short to be a hash
		{"vendor-lowercase.js", false}, // esbuild hashes are upper base32
		{"a-ABCDEFG1.js", false},       // '1' is not in base32
		{"noext", false},
	}
	for _, tc := range tests {
		if got := hashedAsset(tc.name); got != tc.want {
			t.Errorf("hashedAsset(%q) = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestCacheControl(t *testing.T) {
	if got := cacheControl("replaySurface-WJKVNTB2.js"); got != "public, max-age=31536000, immutable" {
		t.Errorf("hashed chunk cache-control = %q", got)
	}
	if got := cacheControl("app.js"); got != "no-cache" {
		t.Errorf("entry bundle cache-control = %q, want no-cache", got)
	}
}
