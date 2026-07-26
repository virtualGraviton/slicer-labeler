package config

import "os"

type Config struct {
	Port              string
	Host              string
	DatabaseURL       string
	DeepSeekAPIKey    string
	DeepSeekModel     string
	DeepSeekAPIURL    string
	AudioStorageBase  string
	AudioDataDir      string
}

func Load() *Config {
	return &Config{
		Port:              envOrDefault("PORT", "8080"),
		Host:              envOrDefault("HOST", "0.0.0.0"),
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		DeepSeekAPIKey:    os.Getenv("DEEPSEEK_API_KEY"),
		DeepSeekModel:     envOrDefault("DEEPSEEK_MODEL", "deepseek-v4-flash"),
		DeepSeekAPIURL:    envOrDefault("DEEPSEEK_API_URL", "https://api.deepseek.com/chat/completions"),
		AudioStorageBase:  os.Getenv("AUDIO_STORAGE_BASE_URL"),
		AudioDataDir:      envOrDefault("AUDIO_DATA_DIR", "/data/audio"),
	}
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
