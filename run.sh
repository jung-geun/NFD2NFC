#!/bin/bash

# Detect the operating system
OS="$(uname -s)"

case "$OS" in
    Darwin)
        echo "Running on macOS"
        ./normalize-macos $@
        ;;
    Linux)
        echo "Running on Linux"
        ./normalize-linux $@
        ;;
    *)
        echo "Unknown OS: $OS"
        exit 1
        ;;
esac
