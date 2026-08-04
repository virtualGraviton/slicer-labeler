package handler

import (
	"archive/tar"
	"archive/zip"
	"bufio"
	"compress/gzip"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/db"
	"slicer-labeler/internal/model"
	"slicer-labeler/internal/service"
)

const (
	importStageExtract = "extract"
	importStageUpload  = "upload"
	importStageUpsert  = "upsert"

	importTimeout = 30 * time.Minute
)

// ImportHandler accepts inference-machine bundles and processes them as a task
// (extract -> upload -> upsert), streaming progress over SSE.
type ImportHandler struct {
	entryStore   *db.EntryStore
	datasetStore *db.DatasetStore
	modelStore   *db.ModelStore
	storage      *service.StorageService
	tmpDir       string
	tm           *TaskManager
}

func NewImportHandler(entryStore *db.EntryStore, datasetStore *db.DatasetStore, modelStore *db.ModelStore, storage *service.StorageService, tm *TaskManager) *ImportHandler {
	return &ImportHandler{
		entryStore:   entryStore,
		datasetStore: datasetStore,
		modelStore:   modelStore,
		storage:      storage,
		tmpDir:       storage.TmpDir(),
		tm:           tm,
	}
}

// Import receives the bundle (zip/tar.gz), saves it to a temp file, then starts
// an async task that extracts, uploads to OSS and persists entries.
func (h *ImportHandler) Import(c echo.Context) error {
	datasetID, err := strconv.ParseInt(c.Param("datasetId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid datasetId"})
	}

	ctx := c.Request().Context()
	d, err := h.datasetStore.Get(ctx, datasetID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if d == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "dataset not found"})
	}

	file, err := c.FormFile("file")
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing file field"})
	}
	// filepath.Ext only returns the last suffix (.gz for .tar.gz), so check by name
	ext := strings.ToLower(file.Filename)
	switch {
	case strings.HasSuffix(ext, ".zip"):
		ext = ".zip"
	case strings.HasSuffix(ext, ".tar.gz"), strings.HasSuffix(ext, ".tgz"):
		ext = ".tar.gz"
	default:
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "only .zip / .tar.gz bundles are supported"})
	}

	modelName, datasetName, err := resolveNames(ctx, h.datasetStore, h.modelStore, datasetID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	task, err := h.tm.TryLock(datasetID, d.ModelID, modelName, datasetName, model.TaskTypeImport)
	if err != nil {
		return c.JSON(http.StatusConflict, map[string]string{"error": fmt.Sprintf("数据集「%s」正在执行任务，请稍后再试", datasetName)})
	}

	if err := os.MkdirAll(h.tmpDir, 0o755); err != nil {
		h.tm.Unlock(datasetID, task.ID)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	tmp := filepath.Join(h.tmpDir, "import-"+task.ID)
	if err := os.MkdirAll(tmp, 0o755); err != nil {
		h.tm.Unlock(datasetID, task.ID)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	src, err := file.Open()
	if err != nil {
		h.tm.Unlock(datasetID, task.ID)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	bundlePath := filepath.Join(tmp, "bundle"+ext)
	dst, err := os.Create(bundlePath)
	if err != nil {
		src.Close()
		h.tm.Unlock(datasetID, task.ID)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	written, err := io.Copy(dst, src)
	src.Close()
	dst.Close()
	if err != nil {
		os.RemoveAll(tmp)
		h.tm.Unlock(datasetID, task.ID)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to store upload: " + err.Error()})
	}

	log.Printf("[import] task=%s dataset=%d bundle=%s size=%d -> %s/%s", task.ID, datasetID, file.Filename, written, modelName, datasetName)
	go h.runTask(task, datasetID, modelName, datasetName, tmp, ext)

	return c.JSON(http.StatusOK, model.ImportResponse{JobID: task.ID})
}

func (h *ImportHandler) runTask(task *Task, datasetID int64, modelName, datasetName, tmp, ext string) {
	ctx, cancel := context.WithTimeout(context.Background(), importTimeout)
	defer cancel()
	defer close(task.Done)
	defer h.tm.Unlock(datasetID, task.ID)

	defer func() {
		if r := recover(); r != nil {
			log.Printf("[import] task=%s panic: %v", task.ID, r)
			task.update(model.TaskStatusError, "", -1, -1, -1, nil, nil, "", "internal error: "+fmt.Sprint(r))
		}
		os.RemoveAll(tmp)
	}()

	start := time.Now()
	bundlePath := filepath.Join(tmp, "bundle"+ext)

	// Stage 1: extract
	if err := extractBundle(bundlePath, ext, tmp); err != nil {
		log.Printf("[import] task=%s extract failed: %v", task.ID, err)
		task.update(model.TaskStatusError, importStageExtract, -1, -1, -1, nil, nil, "", "解压失败: "+err.Error())
		return
	}
	log.Printf("[import] task=%s extract done", task.ID)

	listPaths, wavPaths := scanBundle(tmp)
	log.Printf("[import] task=%s scan: lists=%d wavs=%d", task.ID, len(listPaths), len(wavPaths))

	parsed, err := parseListFiles(listPaths)
	if err != nil {
		log.Printf("[import] task=%s parse list failed: %v", task.ID, err)
		task.update(model.TaskStatusError, importStageExtract, -1, -1, -1, nil, nil, "", "解析 list 失败: "+err.Error())
		return
	}
	log.Printf("[import] task=%s list parsed: %d rows", task.ID, len(parsed))

	wavByBase := map[string]string{}
	for _, p := range wavPaths {
		wavByBase[filepath.Base(p)] = p
	}

	var valid []listEntry
	var missing []string
	for _, e := range parsed {
		if _, ok := wavByBase[e.wav]; ok {
			valid = append(valid, e)
		} else {
			missing = append(missing, e.wav)
		}
	}
	var orphans []string
	for b := range wavByBase {
		matched := false
		for _, e := range parsed {
			if e.wav == b {
				matched = true
				break
			}
		}
		if !matched {
			orphans = append(orphans, b)
		}
	}
	log.Printf("[import] task=%s match: valid=%d missing=%d orphans=%d", task.ID, len(valid), len(missing), len(orphans))

	// Stage 2: upload wavs to OSS
	task.update("", importStageUpload, 20, -1, -1, missing, orphans, "", "")
	total := len(valid)
	inputs := make([]model.EntryInput, 0, total)
	for i, e := range valid {
		local := wavByBase[e.wav]
		if _, err := h.storage.UploadFile(ctx, modelName, datasetName, e.wav, local); err != nil {
			log.Printf("[import] task=%s upload %s failed: %v", task.ID, e.wav, err)
			task.update(model.TaskStatusError, importStageUpload, -1, -1, -1, nil, nil, "", "上传失败 "+e.wav+": "+err.Error())
			return
		}
		inputs = append(inputs, model.EntryInput{
			WavPath:  e.wav,
			Speaker:  e.speaker,
			Language: e.language,
			Text:     e.text,
			MetaData: service.ParseEntryMetaData(e.wav),
		})
		p := 20
		if total > 0 {
			p = 20 + int(float64(i+1)/float64(total)*60)
		}
		if i%20 == 0 || i == total-1 {
			task.update("", importStageUpload, p, i+1, -1, nil, nil, "", "")
			log.Printf("[import] task=%s upload %d/%d", task.ID, i+1, total)
		}
	}
	log.Printf("[import] task=%s upload done (%d files)", task.ID, total)

	// Stage 3: persist
	task.update("", importStageUpsert, 80, -1, -1, nil, nil, "", "")
	if _, err := h.entryStore.BatchUpsert(ctx, datasetID, inputs); err != nil {
		log.Printf("[import] task=%s upsert failed: %v", task.ID, err)
		task.update(model.TaskStatusError, importStageUpsert, -1, -1, -1, nil, nil, "", "落库失败: "+err.Error())
		return
	}
	log.Printf("[import] task=%s upsert done: %d entries in %s", task.ID, len(inputs), time.Since(start).Round(time.Millisecond))

	task.update(model.TaskStatusDone, importStageUpsert, 100, len(inputs), -1, missing, orphans, "", "")
	log.Printf("[import] task=%s finished: imported=%d missing=%d orphans=%d elapsed=%s", task.ID, len(inputs), len(missing), len(orphans), time.Since(start).Round(time.Millisecond))
}

// --- Bundle extraction (zip-slip safe) ---

func extractBundle(bundle, ext, dest string) error {
	switch ext {
	case ".zip":
		return extractZip(bundle, dest)
	case ".tar.gz", ".tgz":
		return extractTarGz(bundle, dest)
	}
	return fmt.Errorf("unsupported archive type %s", ext)
}

func safeJoin(dest, name string) (string, error) {
	clean := filepath.Clean(name)
	if clean == "." || filepath.IsAbs(clean) || strings.HasPrefix(clean, "..") || strings.Contains(clean, ":") {
		return "", fmt.Errorf("unsafe archive path: %s", name)
	}
	target := filepath.Join(dest, clean)
	rel, err := filepath.Rel(dest, target)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", fmt.Errorf("unsafe archive path: %s", name)
	}
	return target, nil
}

func extractZip(bundle, dest string) error {
	zr, err := zip.OpenReader(bundle)
	if err != nil {
		return err
	}
	defer zr.Close()
	for _, f := range zr.File {
		target, err := safeJoin(dest, f.Name)
		if err != nil {
			return err
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.Create(target)
		if err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(out, rc)
		rc.Close()
		out.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func extractTarGz(bundle, dest string) error {
	f, err := os.Open(bundle)
	if err != nil {
		return err
	}
	defer f.Close()
	gzr, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gzr.Close()
	tr := tar.NewReader(gzr)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		target, err := safeJoin(dest, hdr.Name)
		if err != nil {
			return err
		}
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			out, err := os.Create(target)
			if err != nil {
				return err
			}
			_, err = io.Copy(out, tr)
			out.Close()
			if err != nil {
				return err
			}
		default:
			// skip symlinks/devices/etc.
		}
	}
	return nil
}

func scanBundle(root string) (lists, wavs []string) {
	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		switch strings.ToLower(filepath.Ext(path)) {
		case ".list":
			lists = append(lists, path)
		case ".wav":
			wavs = append(wavs, path)
		}
		return nil
	})
	return lists, wavs
}

// listEntry is one parsed line of an asr_opt/*.list file.
type listEntry struct {
	wav      string
	speaker  string
	language string
	text     string
}

func parseListFiles(paths []string) ([]listEntry, error) {
	var out []listEntry
	for _, p := range paths {
		f, err := os.Open(p)
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" {
				continue
			}
			parts := strings.SplitN(line, "|", 4)
			if len(parts) < 2 {
				continue
			}
			wav := filepath.Base(strings.TrimSpace(parts[0]))
			if wav == "" {
				continue
			}
			e := listEntry{
				wav:     wav,
				speaker: strings.TrimSpace(parts[1]),
			}
			if len(parts) >= 3 {
				e.language = strings.TrimSpace(parts[2])
			}
			if len(parts) >= 4 {
				e.text = strings.TrimSpace(parts[3])
			}
			out = append(out, e)
		}
		closeErr := sc.Err()
		f.Close()
		if closeErr != nil {
			return nil, closeErr
		}
	}
	return out, nil
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
