.PHONY: install build clean

build:
	npm ci
	npm run build

install: build
	cp -R "dist/mac-arm64/NFD2NFC.app" /Applications/

clean:
	rm -rf out dist node_modules
