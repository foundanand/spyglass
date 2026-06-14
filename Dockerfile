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

# --- stage 3: minimal runtime ---
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /spyglassd /spyglassd
# Data (SQLite + replays) lives here; mount a volume to persist it.
VOLUME ["/data"]
EXPOSE 7474
ENTRYPOINT ["/spyglassd"]
CMD ["--config", "/etc/spyglass/spyglass.config.json"]
