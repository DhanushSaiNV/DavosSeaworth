// app.config.js
// Extends the static `app.json` with config that depends on files/state we can't
// express in JSON. Expo gives this file precedence over `app.json`; we spread the
// static config so nothing is lost.
//
// `android.googleServicesFile` must only be declared when the file actually exists:
// @expo/config-plugins' `withGoogleServicesFile` throws during prebuild when the
// referenced file is missing, which would break every build (including web/CI) until
// the owner creates it. When it is absent we warn loudly and let Android push fail at
// runtime with a token error instead — far easier to diagnose than a prebuild crash.
//
// Refs: TECH-SPECS §7.10.
const fs = require('fs');
const path = require('path');

const appJson = require('./app.json');

const GOOGLE_SERVICES_FILE = './google-services.json';

module.exports = () => {
  const config = { ...appJson.expo };
  // eslint-disable-next-line no-undef -- CommonJS global provided by the Expo config loader.
  const googleServicesPath = path.join(__dirname, GOOGLE_SERVICES_FILE);

  if (fs.existsSync(googleServicesPath)) {
    config.android = { ...config.android, googleServicesFile: GOOGLE_SERVICES_FILE };
  } else {
    console.warn(
      `[app.config] ${GOOGLE_SERVICES_FILE} not found — Android push will fail to obtain a token. ` +
        'Generate it from the Firebase console (TECH-SPECS §7.10).',
    );
  }

  return { expo: config };
};
