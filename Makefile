.PHONY: build run dev docker-build clean

# Build the Go binary
build:
	GONOSUMCHECK='*' GONOSUMDB='*' GOFLAGS=-insecure go build -o slicer-labeler .

# Run the server locally
run: build
	./slicer-labeler

# Run with hot reload (requires air: go install github.com/air-verse/air@latest)
dev:
	air

# Build Docker image
docker-build:
	docker build -t slicer-labeler:latest .

# Clean build artifacts
clean:
	rm -f slicer-labeler

# Download dependencies
deps:
	GOPROXY=https://goproxy.cn,direct GONOSUMCHECK='*' GONOSUMDB='*' GOFLAGS=-insecure go mod tidy

# Run tests
test:
	go test ./...
