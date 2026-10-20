import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const activity = read('../android/app/src/main/java/dev/gulrating/app/MainActivity.java');
const manifest = read('../android/app/src/main/AndroidManifest.xml');
const gradle = read('../android/app/build.gradle');
const apkWorkflow = read('../.github/workflows/android-apk.yml');
const profile = read('../src/components/Profile.js');
const changelog = read('../CHANGELOG.md');

assert.match(activity, /api\.github\.com\/repos\/ToshakGulina\/gulrating\/releases\/latest/);
assert.match(activity, /release\.optBoolean\("draft", true\)/);
assert.match(activity, /release\.optBoolean\("prerelease", true\)/);
assert.match(activity, /isNewerAppVersion\(version, BuildConfig\.VERSION_NAME\)/);
assert.match(activity, /if \(isHomeShellUrl\(url\)\)[\s\S]*?checkForAppUpdate\(false\)/);
assert.match(activity, /@JavascriptInterface\s+public void checkForUpdate\(\)/);
assert.match(activity, /PackageInstaller\.SessionParams\.MODE_FULL_INSTALL/);
assert.match(activity, /try \(PackageInstaller\.Session session = installer\.openSession\(sessionId\)\) \{[\s\S]*?try \(java\.io\.InputStream input = new java\.io\.FileInputStream\(apkFile\);[\s\S]*?session\.fsync\(output\);\s*\}[\s\S]*?session\.commit\(/, 'write streams close before PackageInstaller commits the session');
assert.match(activity, /Settings\.ACTION_MANAGE_UNKNOWN_APP_SOURCES/);
assert.match(activity, /archive\.applicationInfo\.packageName/);
assert.match(activity, /downloaded > 300L \* 1024L \* 1024L/);
assert.match(manifest, /android\.permission\.REQUEST_INSTALL_PACKAGES/);
assert.match(gradle, /buildConfig\s+true/);
assert.match(gradle, /include\s+'assets\/\*\*',\s*'vendor\/\*\*',\s*'src\/\*\*'/,
  'the packaged APK includes local vendor modules used by the offline web app');
assert.match(activity, /path\.startsWith\("\/vendor\/"\)/,
  'the Android WebView serves locally bundled animation assets');
assert.match(apkWorkflow, /-\s+'vendor\/\*\*'/,
  'vendor changes trigger the APK validation build');
assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
assert.match(profile, /isApk\(\) \? `[^`]*check-apk-update/s);
assert.match(profile, /GulRatingBridge\.checkForUpdate\(\)/);

const versionName = gradle.match(/versionName\s+'([^']+)'/)?.[1];
const versionCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
assert.ok(versionName && Number.isInteger(versionCode), 'Android version metadata must be present');
assert.ok(changelog.includes(`## [${versionName}]`), 'The Android version must have a changelog section');

console.log(`Android APK updater wiring and release metadata (${versionName}, ${versionCode}): OK`);
