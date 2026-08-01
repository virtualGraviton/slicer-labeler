package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"slicer-labeler/internal/model"
)

type DeepSeekService struct {
	apiKey string
	apiURL string
	model  string
	client *http.Client
}

func NewDeepSeekService(apiKey, apiURL, modelName string) *DeepSeekService {
	return &DeepSeekService{
		apiKey: apiKey,
		apiURL: apiURL,
		model:  modelName,
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

func (s *DeepSeekService) GetModel() string {
	return s.model
}

type deepSeekMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type deepSeekRequest struct {
	Model          string            `json:"model"`
	Thinking       map[string]string `json:"thinking"`
	ResponseFormat map[string]string `json:"response_format"`
	Temperature    float64           `json:"temperature"`
	MaxTokens      int               `json:"max_tokens"`
	Messages       []deepSeekMessage `json:"messages"`
}

type deepSeekResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

// PolishMergeText uses DeepSeek to polish merged transcript text.
func (s *DeepSeekService) PolishMergeText(entries []model.EntryInput, hardMergedText, speaker, language string) (string, string, error) {
	if s.apiKey == "" {
		return "", "", fmt.Errorf("未配置 DeepSeek API Key")
	}

	baseText := hardMergedText
	if baseText == "" {
		var parts []string
		for _, e := range entries {
			parts = append(parts, e.Text)
		}
		baseText = strings.Join(parts, " ")
	}
	if baseText == "" {
		return "", "", fmt.Errorf("hardMergedText required")
	}

	cleanEntries := make([]map[string]interface{}, len(entries))
	for i, e := range entries {
		sp := e.Speaker
		if sp == "" {
			sp = speaker
		}
		lang := e.Language
		if lang == "" {
			lang = language
		}
		cleanEntries[i] = map[string]interface{}{
			"index":    i + 1,
			"speaker":  sp,
			"language": lang,
			"text":     strings.TrimSpace(e.Text),
		}
	}

	userContent, _ := json.Marshal(map[string]interface{}{
		"task":             "润色 hard_merged_text 为自然连贯的完整句子。",
		"speaker":          speaker,
		"language":         language,
		"hard_merged_text": baseText,
		"segments":         cleanEntries,
	})

	payload := deepSeekRequest{
		Model:          s.model,
		Thinking:       map[string]string{"type": "disabled"},
		ResponseFormat: map[string]string{"type": "json_object"},
		Temperature:    0,
		MaxTokens:      1500,
		Messages: []deepSeekMessage{
			{
				Role:    "system",
				Content: "你是语音切片 ASR 文本合并润色助手。修复拼接处的语法问题。必须只输出合法 JSON 对象。JSON 字段: polished_text(string), explanation_zh(string)。",
			},
			{Role: "user", Content: string(userContent)},
		},
	}

	data, err := s.post(payload)
	if err != nil {
		return "", "", fmt.Errorf("DeepSeek polish: %w", err)
	}

	parsed, err := parseDeepSeekJSON(data.Choices[0].Message.Content)
	if err != nil {
		return "", "", err
	}

	polished := truncateStr(getStr(parsed, "polished_text"), 5000)
	if polished == "" {
		polished = truncateStr(getStr(parsed, "polishedText"), 5000)
	}
	explanation := truncateStr(getStr(parsed, "explanation_zh"), 1200)
	if explanation == "" {
		explanation = truncateStr(getStr(parsed, "explanationZh"), 1200)
	}
	if explanation == "" {
		explanation = "模型未说明具体修改。"
	}

	if polished == "" {
		return "", "", fmt.Errorf("DeepSeek did not return polished_text")
	}

	return polished, explanation, nil
}

func (s *DeepSeekService) post(payload deepSeekRequest) (*deepSeekResponse, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", s.apiURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.apiKey)

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		maxLen := len(respBody)
		if maxLen > 800 {
			maxLen = 800
		}
		return nil, fmt.Errorf("DeepSeek API %d: %s", resp.StatusCode, string(respBody[:maxLen]))
	}

	var data deepSeekResponse
	if err := json.Unmarshal(respBody, &data); err != nil {
		return nil, fmt.Errorf("DeepSeek returned invalid JSON: %w", err)
	}

	if len(data.Choices) == 0 {
		return nil, fmt.Errorf("DeepSeek returned no choices")
	}

	return &data, nil
}

// --- JSON helpers ---

func parseDeepSeekJSON(content string) (map[string]interface{}, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, fmt.Errorf("DeepSeek returned empty content")
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		if i := strings.Index(content, "{"); i >= 0 {
			if j := strings.LastIndex(content, "}"); j > i {
				return parsed, json.Unmarshal([]byte(content[i:j+1]), &parsed)
			}
		}
		return nil, fmt.Errorf("DeepSeek returned invalid JSON")
	}
	return parsed, nil
}

func getStr(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func truncateStr(s string, maxLen int) string {
	if len(s) > maxLen {
		return s[:maxLen]
	}
	return s
}
