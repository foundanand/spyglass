# spyglass — build the dashboard, embed it, and produce the single static binary.
#
#   make build        build dashboard + collector for the host platform
#   make dashboard    build only the embedded dashboard SPA
#   make release      cross-compile static binaries for darwin/linux × amd64/arm64
#   make run          build then run with spyglass.config.json
#   make test         run Go + SDK tests
#   make clean        remove build output

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)
BIN     := spyglassd
OUT     := collector/dist
DASH    := collector/dashboard/ui

.PHONY: build dashboard collector release run test clean

build: dashboard collector

dashboard:
	cd $(DASH) && npm install --silent && npm run build

collector:
	cd collector && CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o $(BIN) .

# Cross-compiled, fully static binaries. modernc.org/sqlite is pure Go, so
# CGO_ENABLED=0 cross-compiles cleanly with no C toolchain.
release: dashboard
	mkdir -p $(OUT)
	@for target in darwin/amd64 darwin/arm64 linux/amd64 linux/arm64; do \
		os=$${target%/*}; arch=$${target#*/}; \
		echo "building $$os/$$arch"; \
		cd collector && CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch \
			go build -trimpath -ldflags "$(LDFLAGS)" \
			-o dist/$(BIN)-$$os-$$arch . && cd ..; \
	done
	@echo "binaries in $(OUT)/"

run: build
	cd collector && ./$(BIN) --config ../spyglass.config.json

test:
	cd collector && go test ./...
	cd sdk && npm test --silent

clean:
	rm -f collector/$(BIN)
	rm -rf $(OUT) $(DASH)/dist
