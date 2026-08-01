package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// StorageService handles object storage read/write and URL generation.
type StorageService struct {
	client   *minio.Client
	bucket   string
	endpoint  string
	prefix   string
}

// NewStorageService creates an S3-compatible storage client.
// endpoint may be bare or http(s)://host:port.
func NewStorageService(endpoint, bucket, accessKey, secretKey, prefix string) (*StorageService, error) {
	secure := strings.HasPrefix(endpoint, "https://")
	fullURL := strings.TrimRight(endpoint, "/")

	// Strip scheme for minio.New() — it expects bare host:port
	host := fullURL
	if strings.HasPrefix(host, "https://") {
		host = host[len("https://"):]
	} else if strings.HasPrefix(host, "http://") {
		host = host[len("http://"):]
	}

	client, err := minio.New(host, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: secure,
	})
	if err != nil {
		return nil, fmt.Errorf("create storage client: %w", err)
	}

	return &StorageService{
		client:    client,
		bucket:    bucket,
		endpoint:  fullURL,
		prefix:    strings.Trim(prefix, "/"),
	}, nil
}

// objectKey builds the object path in the bucket.
// Format: {prefix}/{modelName}/{datasetName}/{filename}
func (s *StorageService) objectKey(modelName, datasetName, filename string) string {
	return fmt.Sprintf("%s/%s/%s/%s", s.prefix, modelName, datasetName, filename)
}

// DownloadBytes fetches an audio file from storage as raw bytes.
func (s *StorageService) DownloadBytes(ctx context.Context, modelName, datasetName, wavPath string) ([]byte, error) {
	reader, err := s.DownloadStream(ctx, modelName, datasetName, wavPath)
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", s.objectKey(modelName, datasetName, filepath.Base(wavPath)), err)
	}
	return data, nil
}

// DownloadStream returns a streaming reader for an object in storage.
// The caller must close the reader when done.
func (s *StorageService) DownloadStream(ctx context.Context, modelName, datasetName, wavPath string) (io.ReadCloser, error) {
	key := s.objectKey(modelName, datasetName, filepath.Base(wavPath))
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("download %s: %w", key, err)
	}
	return obj, nil
}

// UploadBytes writes raw bytes to an object storage path.
// Returns the object key used.
func (s *StorageService) UploadBytes(ctx context.Context, modelName, datasetName, filename string, data []byte) (string, error) {
	key := s.objectKey(modelName, datasetName, filename)
	_, err := s.client.PutObject(ctx, s.bucket, key, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{})
	if err != nil {
		return "", fmt.Errorf("upload %s: %w", key, err)
	}
	return key, nil
}

// GenerateURL builds the public download URL for an object.
func (s *StorageService) GenerateURL(modelName, datasetName, wavPath string) string {
	filename := filepath.Base(wavPath)
	path := fmt.Sprintf("%s/%s/%s/%s", s.prefix, modelName, datasetName, filename)
	return fmt.Sprintf("%s/%s/%s", s.endpoint, s.bucket, path)
}
