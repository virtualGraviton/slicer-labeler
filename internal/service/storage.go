package service

import (
	"fmt"
	"path/filepath"
	"strings"
)

type StorageService struct {
	endpoint  string
	bucket    string
	accessKey string
	secretKey string
	prefix    string
}

func NewStorageService(endpoint, bucket, accessKey, secretKey, prefix string) *StorageService {
	return &StorageService{
		endpoint:  strings.TrimRight(endpoint, "/"),
		bucket:    bucket,
		accessKey: accessKey,
		secretKey: secretKey,
		prefix:    strings.Trim(prefix, "/"),
	}
}

// GenerateURL builds the object storage URL for an audio file.
// Path format: {prefix}/{model_name}/{dataset_name}/{filename}
func (s *StorageService) GenerateURL(modelName, datasetName, wavPath string) string {
	filename := filepath.Base(wavPath)
	path := fmt.Sprintf("%s/%s/%s/%s", s.prefix, modelName, datasetName, filename)
	return fmt.Sprintf("%s/%s/%s", s.endpoint, s.bucket, path)
}
