#!/bin/sh
# Xcode Cloud — runs after every xcodebuild action.
# Use this to run tests, generate reports, or send notifications.
set -e

echo "▶ ci_post_xcodebuild: build finished with exit code $CI_XCODEBUILD_EXIT_CODE"

if [ "$CI_XCODEBUILD_EXIT_CODE" -ne 0 ]; then
  echo "✗ Build failed"
  exit 1
fi

echo "✓ Build succeeded"
