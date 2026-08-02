package config

import "os"

type Config struct {
	Port             string
	Host             string
	DatabaseURL      string
	DeepSeekAPIKey   string
	DeepSeekModel    string
	DeepSeekAPIURL   string
	StorageEndpoint  string
	StorageBucket    string
	StorageAccessKey string
	StorageSecretKey string
	StoragePrefix    string
	TmpDir           string
}

func Load() *Config {
	return &Config{
		Port:             envOrDefault("PORT", "8080"),
		Host:             envOrDefault("HOST", "0.0.0.0"),
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		DeepSeekAPIKey:   os.Getenv("DEEPSEEK_API_KEY"),
		DeepSeekModel:    envOrDefault("DEEPSEEK_MODEL", "deepseek-v4-flash"),
		DeepSeekAPIURL:   envOrDefault("DEEPSEEK_API_URL", "https://api.deepseek.com/chat/completions"),
		StorageEndpoint:  os.Getenv("STORAGE_ENDPOINT"),
		StorageBucket:    os.Getenv("STORAGE_BUCKET"),
		StorageAccessKey: os.Getenv("STORAGE_ACCESS_KEY"),
		StorageSecretKey: os.Getenv("STORAGE_SECRET_KEY"),
		StoragePrefix:    envOrDefault("STORAGE_PREFIX", "dataset"),
		TmpDir:           envOrDefault("TMP_DIR", "/data/tmp"),
	}
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
