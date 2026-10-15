.PHONY: build run test test-model archive export clean

PROJECT = macOS/NFD2NFC.xcodeproj
SCHEME = NFD2NFC
DERIVED = .build/xcode
ARCHIVE = .build/NFD2NFC.xcarchive

build:
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) -configuration Release -derivedDataPath $(DERIVED) CODE_SIGN_IDENTITY=- build
	xcrun swift macOS/Branding/VerifyIcon.swift "$(DERIVED)/Build/Products/Release/NFD2NFC.app"

run: build
	open "$(DERIVED)/Build/Products/Release/NFD2NFC.app"

test: build
	swift test --package-path macOS
	$(MAKE) test-model

test-model:
	xcrun swiftc -swift-version 5 -I $(DERIVED)/Build/Products/Release $(DERIVED)/Build/Products/Release/NormalizationCore.o macOS/NFD2NFC/AppModel.swift macOS/NFD2NFC/StateStore.swift macOS/Tests/AppModelSmoke.swift -o .build/app-model-smoke
	.build/app-model-smoke

archive:
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) -configuration Release -destination 'generic/platform=macOS' -archivePath $(ARCHIVE) archive
	xcrun swift macOS/Branding/VerifyIcon.swift "$(ARCHIVE)/Products/Applications/NFD2NFC.app"

export:
	xcodebuild -exportArchive -archivePath $(ARCHIVE) -exportOptionsPlist macOS/ExportOptions.plist -exportPath .build/app-store

clean:
	rm -rf .build macOS/.build
