// Builds crates/musette-ffi for a platform and generates the React Native
// module around it (uniffi-bindgen-react-native), then fixes what the
// generated files get wrong for an Expo app.
//
//   node scripts/generate.mjs android   (needs the Android NDK: ANDROID_NDK_HOME)
//   node scripts/generate.mjs ios       (needs macOS and Xcode)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.argv[2];
if (platform !== 'android' && platform !== 'ios') {
  console.error('usage: generate.mjs android|ios');
  process.exit(1);
}

const args = ['build', platform, '--and-generate', '--config', 'ubrn.config.yaml'];
if (platform === 'android') {
  // Phones and the x86_64 emulator; set MUSETTE_ANDROID_TARGETS to change.
  args.push('--targets', process.env.MUSETTE_ANDROID_TARGETS ?? 'aarch64-linux-android,x86_64-linux-android');
}
if (process.env.MUSETTE_RELEASE) args.push('--release');
execFileSync(join(root, '../../node_modules/.bin/ubrn'), args, { cwd: root, stdio: 'inherit' });

if (platform === 'android') {
  // The app includes this CMakeLists from its own build: paths must be relative to it.
  const cmake = join(root, 'android/CMakeLists.txt');
  writeFileSync(cmake, readFileSync(cmake, 'utf8').replaceAll('${CMAKE_SOURCE_DIR}/', '${CMAKE_CURRENT_SOURCE_DIR}/'));
  // build.gradle names consumer ProGuard rules that ubrn does not write.
  const proguard = join(root, 'android/proguard-rules.pro');
  if (!existsSync(proguard)) writeFileSync(proguard, '');
}
