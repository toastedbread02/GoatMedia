#!/usr/bin/env bash
# Builds GoatMedia.apk with the Android SDK only: no Gradle, no network.
# Requires: JDK 11+, Android SDK build-tools and one platform android.jar.
set -euo pipefail
cd "$(dirname "$0")"

SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
BT="$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)"
JAR="$(ls -d "$SDK"/platforms/android-*/android.jar | sort -V | tail -1)"
VERSION="2.0.0"

rm -rf build
mkdir -p build/compiled build/gen build/classes build/dex

"$BT/aapt2" compile --dir app/src/main/res -o build/compiled/res.zip
"$BT/aapt2" link \
  -o build/base.apk \
  -I "$JAR" \
  --manifest app/src/main/AndroidManifest.xml \
  --java build/gen \
  --min-sdk-version 24 --target-sdk-version 35 \
  --version-code 1 --version-name "$VERSION" \
  build/compiled/res.zip

javac -source 11 -target 11 -nowarn -classpath "$JAR" -d build/classes \
  app/src/main/java/app/goatmedia/MainActivity.java \
  build/gen/app/goatmedia/R.java

"$BT/d8" --lib "$JAR" --min-api 24 --output build/dex $(find build/classes -name '*.class')

cp build/base.apk build/unaligned.apk
(cd build/dex && zip -q ../unaligned.apk classes.dex)
"$BT/zipalign" -f 4 build/unaligned.apk build/aligned.apk

# A local self-signed key. Fine for sideloading; every future build must use the
# same key or Android will refuse to update the installed app.
if [ ! -f art/goatmedia.keystore ]; then
  keytool -genkeypair -keystore art/goatmedia.keystore -alias goatmedia \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass goatmedia -keypass goatmedia \
    -dname 'CN=GoatMedia, OU=Local build, O=GoatMedia, L=Local, ST=Local, C=US' >/dev/null 2>&1
fi

"$BT/apksigner" sign --ks art/goatmedia.keystore \
  --ks-pass pass:goatmedia --key-pass pass:goatmedia \
  --out "build/GoatMedia-$VERSION.apk" build/aligned.apk

cp "build/GoatMedia-$VERSION.apk" "../GoatMedia-$VERSION.apk"
echo "built GoatMedia-$VERSION.apk"
