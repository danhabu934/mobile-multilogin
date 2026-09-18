#!/usr/bin/env bash
set -eu

SDK_ROOT="${ANDROID_SDK_ROOT:-/opt/android-sdk}"
SYSTEM_IMAGE="${ANDROID_SYSTEM_IMAGE:-system-images;android-34;google_apis_playstore;x86_64}"
SDKMANAGER="$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager"

if [ ! -x "$SDKMANAGER" ]; then
  echo "sdkmanager was not found at $SDKMANAGER"
  echo "Install Android command-line tools first and accept the Android SDK license manually."
  exit 1
fi

"$SDKMANAGER" "platform-tools" "emulator" "$SYSTEM_IMAGE"
echo "Installed: $SYSTEM_IMAGE"
