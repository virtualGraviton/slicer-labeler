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
	endpoint string
	prefix   string
	tmpDir   string
}

// NewStorageService creates an S3-compatible storage client.
// endpoint may be bare or http(s)://host:port.
func NewStorageService(endpoint, bucket, accessKey, secretKey, prefix, tmpDir string) (*StorageService, error) {
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
		client:   client,
		bucket:   bucket,
		endpoint: fullURL,
		prefix:   strings.Trim(prefix, "/"),
		tmpDir:   strings.TrimRight(tmpDir, "/"),
	}, nil
}

// TmpDir returns the configured temporary root directory (for imports/merges).
func (s *StorageService) TmpDir() string { return s.tmpDir }

// Prefix returns the configured storage prefix (e.g. "dataset").
func (s *StorageService) Prefix() string { return s.prefix }

// ObjectKey builds the working-data object path (processing area).
// Format: {prefix}/processing/{modelName}/{datasetName}/{filename}
func (s *StorageService) ObjectKey(modelName, datasetName, filename string) string {
	return fmt.Sprintf("%s/processing/%s/%s/%s", s.prefix, modelName, datasetName, filepath.Base(filename))
}

// ArchiveWavKey builds the archived wav path.
// Format: {prefix}/archived/{modelName}/{datasetName}/output/slicer_opt/{filename}
func (s *StorageService) ArchiveWavKey(modelName, datasetName, filename string) string {
	return fmt.Sprintf("%s/archived/%s/%s/output/slicer_opt/%s", s.prefix, modelName, datasetName, filepath.Base(filename))
}

// ArchiveListKey builds the archived .list path (mirrors the inference-machine layout).
// Format: {prefix}/archived/{modelName}/{datasetName}/output/asr_opt/{datasetName}.list
func (s *StorageService) ArchiveListKey(modelName, datasetName string) string {
	name := strings.ReplaceAll(datasetName, "/", "_")
	return fmt.Sprintf("%s/archived/%s/%s/output/asr_opt/%s.list", s.prefix, modelName, datasetName, name)
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
		return nil, fmt.Errorf("read %s: %w", s.ObjectKey(modelName, datasetName, filepath.Base(wavPath)), err)
	}
	return data, nil
}

// DownloadStream returns a streaming reader for an object in storage.
// The caller must close the reader when done.
func (s *StorageService) DownloadStream(ctx context.Context, modelName, datasetName, wavPath string) (io.ReadCloser, error) {
	key := s.ObjectKey(modelName, datasetName, wavPath)
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("download %s: %w", key, err)
	}
	return obj, nil
}

// UploadBytes writes raw bytes to an object storage path.
// Returns the object key used.
func (s *StorageService) UploadBytes(ctx context.Context, modelName, datasetName, filename string, data []byte) (string, error) {
	key := s.ObjectKey(modelName, datasetName, filename)
	_, err := s.client.PutObject(ctx, s.bucket, key, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{})
	if err != nil {
		return "", fmt.Errorf("upload %s: %w", key, err)
	}
	return key, nil
}

// UploadFile uploads a local file to object storage, streaming from disk (low memory).
// Returns the object key used.
func (s *StorageService) UploadFile(ctx context.Context, modelName, datasetName, filename, localPath string) (string, error) {
	key := s.ObjectKey(modelName, datasetName, filename)
	info, err := s.client.FPutObject(ctx, s.bucket, key, localPath, minio.PutObjectOptions{})
	if err != nil {
		return "", fmt.Errorf("upload file %s: %w", key, err)
	}
	if info.Size == 0 {
		return "", fmt.Errorf("upload file %s: empty object written", key)
	}
	return key, nil
}

// CopyObject performs a server-side copy between two keys in the bucket (zero bandwidth).
func (s *StorageService) CopyObject(ctx context.Context, srcKey, dstKey string) error {
	_, err := s.client.CopyObject(ctx, minio.CopyDestOptions{
		Bucket: s.bucket,
		Object: dstKey,
	}, minio.CopySrcOptions{
		Bucket: s.bucket,
		Object: srcKey,
	})
	if err != nil {
		return fmt.Errorf("copy %s -> %s: %w", srcKey, dstKey, err)
	}
	return nil
}

// PutString writes a text payload to an arbitrary object path.
func (s *StorageService) PutString(ctx context.Context, key, content string) error {
	_, err := s.client.PutObject(ctx, s.bucket, key, bytes.NewReader([]byte(content)), int64(len(content)), minio.PutObjectOptions{ContentType: "text/plain"})
	if err != nil {
		return fmt.Errorf("upload text %s: %w", key, err)
	}
	return nil
}

// GenerateURL builds the public download URL for an object.
func (s *StorageService) GenerateURL(modelName, datasetName, wavPath string) string {
	path := s.ObjectKey(modelName, datasetName, wavPath)
	return fmt.Sprintf("%s/%s/%s", s.endpoint, s.bucket, path)
}
