# Build stage
FROM golang:1.25-bookworm AS build

WORKDIR /app
COPY go.mod go.sum ./
RUN GOPROXY=https://goproxy.cn,direct GONOSUMCHECK='*' GONOSUMDB='*' GOFLAGS=-insecure go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GONOSUMCHECK='*' GONOSUMDB='*' GOFLAGS=-insecure go build -o slicer-labeler .

# Runtime stage
FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/slicer-labeler .

ENV HOST=0.0.0.0
ENV PORT=8080

EXPOSE 8080
CMD ["./slicer-labeler"]
