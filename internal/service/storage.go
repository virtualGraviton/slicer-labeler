package service

import (
	"fmt"
	"strings"
)

type StorageService struct {
	baseURL string
}

func NewStorageService(baseURL string) *StorageService {
	return &StorageService{baseURL: strings.TrimRight(baseURL, "/")}
}

// GenerateURL generates a public URL for an audio file.
func (s *StorageService) GenerateURL(relPath string) string {
	relPath = strings.ReplaceAll(relPath, "\\", "/")
	relPath = strings.TrimPrefix(relPath, "./")
	return fmt.Sprintf("%s/%s", s.baseURL, relPath)
}
