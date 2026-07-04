# syntax=docker/dockerfile:1

# --- stage 1: build the embedded dashboard SPA ---
FROM node:22-alpine AS dashboard
WORKDIR /ui
COPY collector/dashboard/ui/package*.json ./
RUN npm install --silent
COPY collector/dashboard/ui/ ./
RUN npm run build

# --- stage 2: build the static Go binary (dashboard embedded via go:embed) ---
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY collector/go.mod collector/go.sum ./
RUN go mod download
COPY collector/ ./
# Bring in the freshly built dashboard so go:embed picks it up.
COPY --from=dashboard /ui/dist ./dashboard/ui/dist
ARG VERSION=docker
# modernc.org/sqlite is pure Go → CGO_ENABLED=0 yields a fully static binary.
RUN CGO_ENABLED=0 go build -trimpath \
      -ldflags "-s -w -X main.version=${VERSION}" \
      -o /spyglassd .
# Pre-create the data dir so it can be copied into the runtime image with
# nonroot ownership below.
RUN mkdir -p /data

# --- stage 3: minimal runtime ---
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /spyglassd /spyglassd
# Data (SQLite + replays) lives here; mount a volume to persist it. The dir is
# owned by the distroless nonroot uid (65532) so the process can write to it and
# the named volume inherits writable ownership on first mount. WORKDIR is / so
# the default config's relative "./data" resolves onto this volume instead of an
# ephemeral cwd-relative path (e.g. /home/nonroot/data) that is wiped on every
# container recreate.
COPY --from=build --chown=65532:65532 /data /data
WORKDIR /
VOLUME ["/data"]
EXPOSE 7474
ENTRYPOINT ["/spyglassd"]
CMD ["--config", "/etc/spyglass/spyglass.config.json"]
