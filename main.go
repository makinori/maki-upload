package main

import (
	"bytes"
	"crypto/md5"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"io"
	"math/rand/v2"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"text/template"

	"github.com/charmbracelet/log"
	"github.com/dustin/go-humanize"
)

//go:embed bg-gifs fonts config page.html
var STATIC_CONTENT embed.FS

const (
	BACKGROUNDS_DIR    = "bg-gifs"
	MAX_UPLOAD_SIZE_GB = 1
)

var (
	BACKGROUND_EXTS  = []string{".jpg", ".png", ".gif"}
	BACKGROUND_NAMES = getBackgroundNames()

	PORT, _ = strconv.Atoi(getEnv("PORT", "8080"))

	TOKENS = strings.Split(getEnv("TOKENS", "token_a,token_b"), ",")

	PUBLIC_DIR = getEnv("PUBLIC_DIR", "./public/")
)

func getEnv(key string, fallback string) string {
	value, exists := os.LookupEnv(key)
	if exists {
		return value
	} else {
		return fallback
	}
}

func getBackgroundNames() []string {
	entries, err := STATIC_CONTENT.ReadDir(BACKGROUNDS_DIR)

	if err != nil {
		return []string{}
	}

	filenames := []string{}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		filename := entry.Name()

		if slices.Contains(BACKGROUND_EXTS[:], filepath.Ext(filename)) {
			filenames = append(filenames, filename)
		}
	}

	return filenames
}

func handleEtag(w http.ResponseWriter, r *http.Request, stat os.FileInfo) bool {
	hashInput := (strconv.FormatInt(stat.ModTime().Unix(), 16) +
		strconv.FormatInt(stat.Size(), 16))

	hash := md5.Sum([]byte(hashInput))

	etag := fmt.Sprintf(`W/"%s"`, hex.EncodeToString(hash[:]))

	if strings.Contains(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return true
	}

	w.Header().Add("ETag", etag)
	return false
}

func fileHandler(
	w http.ResponseWriter, r *http.Request, rootPath string, hostDir string,
	static bool,
) {
	filename := strings.Replace(r.URL.Path, rootPath, "", 1)

	if static {
		http.ServeFileFS(w, r, STATIC_CONTENT, filepath.Join(hostDir, filename))
		return
	}

	file, err := os.Open(filepath.Join(hostDir, filename))
	if err != nil {
		log.Error(err)
		w.WriteHeader(http.StatusNotFound)
		return
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		log.Error(err)
		w.WriteHeader(http.StatusNotFound)
		return
	}

	if handleEtag(w, r, stat) {
		return
	}

	http.ServeContent(w, r, stat.Name(), stat.ModTime(), file)

}

func registerFileHandler(urlPrefix string, hostDir string, static bool) {
	http.HandleFunc(urlPrefix, func(w http.ResponseWriter, r *http.Request) {
		fileHandler(w, r, urlPrefix, hostDir, static)
	})
}

func readStaticFileAsString(path string) string {
	bytes, _ := STATIC_CONTENT.ReadFile(path)
	return string(bytes)
}

func getCookieAsInt(cookies []*http.Cookie, name string, defaultInt int) int {
	for _, cookie := range cookies {
		if cookie.Name == name {
			i, err := strconv.Atoi(cookie.Value)
			if err == nil {
				return i
			}
			return defaultInt
		}
	}
	return defaultInt
}

func gbToBytes(gigabytes int) int64 {
	return int64(gigabytes * 1024 * 1024 * 1024)
}

func writeJson[T any](w http.ResponseWriter, data T, statusCode int) {
	jsonData, _ := json.Marshal(data)
	w.Header().Add("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	w.Write(jsonData)
}

func writeJsonError(w http.ResponseWriter, errorStr string, statusCode int) {
	writeJson(w, map[string]any{
		"error": errorStr,
	}, statusCode)
}

const base62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

func generateName(bytes []byte) string {

	hash := crc32.ChecksumIEEE(bytes)

	if hash == 0 {
		return string(base62[0])
	}

	var name string

	for hash > 0 {
		name = string(base62[hash%62]) + name
		hash /= 62
	}

	return name
}

func removeLastPart(str string, delimiter string) string {
	index := strings.LastIndex(str, delimiter)
	if index == -1 {
		return str
	}
	return str[:index]
}

func getRequestIP(r *http.Request) string {
	ip := r.Header.Get("X-Forwarded-For")
	if ip != "" {
		return ip
	}

	ip = r.Header.Get("X-Real-IP")
	if ip != "" {
		return ip
	}

	return removeLastPart(r.RemoteAddr, ":")
}

func apiUploadHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJsonError(w, "not a post request", http.StatusBadRequest)
		return
	}

	err := r.ParseMultipartForm(gbToBytes(MAX_UPLOAD_SIZE_GB))
	if err != nil {
		log.Error(err)
		writeJsonError(w, "failed to parse multipart form", http.StatusBadRequest)
		return
	}

	tokens, hasTokens := r.MultipartForm.Value["token"]
	if !hasTokens {
		writeJsonError(w, "no token provided", http.StatusBadRequest)
		return
	}

	token := tokens[0]

	validToken := slices.Index(TOKENS, token) != -1
	if !validToken {
		log.Warnf("invalid token %s (%s)", getRequestIP(r), token)
		writeJsonError(w, "invalid token", http.StatusBadRequest)
		return
	}

	files, hasFiles := r.MultipartForm.File["files"]
	if !hasFiles {
		writeJsonError(w, "no files provided", http.StatusBadRequest)
		return
	}

	var fileUrls []string

	for _, fileHeader := range files {
		file, _ := fileHeader.Open()

		buf := bytes.NewBuffer(nil)
		_, err := io.Copy(buf, file)
		if err != nil {
			log.Error(err)
			writeJsonError(
				w, "internal server error", http.StatusInternalServerError,
			)
			return
		}

		filename := generateName(buf.Bytes()) + filepath.Ext(fileHeader.Filename)

		filePath := filepath.Join(PUBLIC_DIR, filename)

		err = os.WriteFile(filePath, buf.Bytes(), 0644)
		if err != nil {
			log.Error(err)
			writeJsonError(
				w, "internal server error", http.StatusInternalServerError,
			)
			return
		}

		fileUrl := fmt.Sprintf("https://%s/u/%s", r.Host, filename)
		fileUrls = append(fileUrls, fileUrl)

		log.Infof(
			`%s (%s) uploaded: %s (%s)`,
			getRequestIP(r), token,
			filename, humanize.Bytes(uint64(buf.Len())),
		)
	}

	writeJson(w, fileUrls, http.StatusOK)
}

func getPageConfigData(r *http.Request) map[string]string {
	configData := map[string]string{
		"bashScript":     "maki-upload.sh",
		"nautilusConfig": "actions-for-nautilus-config.json",
		"dolphinConfig":  "maki-upload.desktop",
		"sharexConfig":   "sharex.json",
	}

	inConfigData := map[string]string{
		"siteDomain": r.Host,
	}

	for key, value := range configData {
		configTmpl, _ := template.New(key).Parse(
			readStaticFileAsString("config/" + value),
		)

		var bytes bytes.Buffer
		configTmpl.Execute(&bytes, inConfigData)
		config := bytes.String()

		configData[key] = config
	}

	return configData
}

func handler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/u/" || r.URL.Path == "/u/index.html" {
		// handle background cookie

		lastbg := getCookieAsInt(r.Cookies(), "lastbg", -1)
		if lastbg == -1 {
			lastbg = rand.IntN(len(BACKGROUND_NAMES))
		} else {
			lastbg = (lastbg + 1) % len(BACKGROUND_NAMES)
		}

		http.SetCookie(w, &http.Cookie{
			Name:  "lastbg",
			Value: strconv.Itoa(lastbg),
		})

		// render page

		tmpl, _ := template.New("page").Parse(
			readStaticFileAsString("page.html"),
		)

		data := getPageConfigData(r)
		data["backgroundUrl"] = "/u/bg/" + BACKGROUND_NAMES[lastbg]

		var bytes bytes.Buffer
		tmpl.Execute(&bytes, data)

		w.Header().Add("Content-Type", "text/html")
		w.Header().Add("Content-Length", strconv.Itoa(bytes.Len()))
		w.Write(bytes.Bytes())

	} else if r.URL.Path == "/u/api/upload" {
		apiUploadHandler(w, r)

	} else {
		fileHandler(w, r, "/u/", PUBLIC_DIR, false)

	}
}

func main() {
	registerFileHandler("/u/bg/", BACKGROUNDS_DIR, true)
	registerFileHandler("/u/fonts/", "fonts", true)

	http.HandleFunc("/u/", handler)

	log.Infof(
		"starting web server: http://127.0.0.1:%d",
		PORT,
	)

	err := http.ListenAndServe(fmt.Sprintf(":%d", PORT), nil)
	if err != nil {
		log.Fatalf("error starting server: %s", err)
	}
}
