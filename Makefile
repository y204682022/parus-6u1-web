PYTHON ?= python3
WEB_HOST ?= 0.0.0.0
WEB_PORT ?= 8080
SITE_DIR ?= .site

.PHONY: pages-build web-preview clean

pages-build:
	rm -rf $(SITE_DIR)
	mkdir -p $(SITE_DIR)
	cp index.html app.js style.css local_config.js $(SITE_DIR)/
	cp -R data $(SITE_DIR)/
	touch $(SITE_DIR)/.nojekyll
	@echo "[pages-build] built static site in $(SITE_DIR)/"

web-preview:
	@echo "Web Dashboard 啟動中..."
	@echo "本機連線: http://localhost:$(WEB_PORT)"
	$(PYTHON) -m http.server $(WEB_PORT) --bind $(WEB_HOST)

clean:
	rm -rf $(SITE_DIR)