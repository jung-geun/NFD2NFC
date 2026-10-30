.PHONY: build run test test-model test-build-version archive export clean

PROJECT = macOS/NFD2NFC.xcodeproj
SCHEME = NFD2NFC
DERIVED = .build/xcode
ARCHIVE = .build/NFD2NFC.xcarchive
EXPORT = .build/app-store

build:
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) -configuration Release -derivedDataPath $(DERIVED) CODE_SIGN_IDENTITY=- build

run: build
	open "$(DERIVED)/Build/Products/Release/NFD2NFC.app"

test: build
	swift test --package-path macOS
	$(MAKE) test-model
	$(MAKE) test-build-version

test-model:
	xcrun swiftc -swift-version 5 -I $(DERIVED)/Build/Products/Release $(DERIVED)/Build/Products/Release/NormalizationCore.o macOS/NFD2NFC/AppModel.swift macOS/NFD2NFC/StateStore.swift macOS/Tests/AppModelSmoke.swift -o .build/app-model-smoke
	.build/app-model-smoke

test-build-version:
	xcrun swiftc -parse-as-library macOS/Tests/BuildVersionSmoke.swift -o .build/build-version-smoke
	.build/build-version-smoke "$(DERIVED)/Build/Products/Release/NFD2NFC.app"

archive:
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) -configuration Release -destination 'generic/platform=macOS' -archivePath $(ARCHIVE) archive

export:
	xcrun swift macOS/Branding/VerifyIcon.swift "$(ARCHIVE)/Products/Applications/NFD2NFC.app"
	xcodebuild -exportArchive -archivePath $(ARCHIVE) -exportOptionsPlist macOS/ExportOptions.plist -exportPath $(EXPORT)
	xcrun swift macOS/Branding/VerifyIcon.swift "$(EXPORT)/NFD2NFC.pkg"

clean:
	rm -rf .build macOS/.build
