const { withAppDelegate, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// react-native-spotify-remote needs the app's AppDelegate to forward the auth
// redirect (hockeydj://callback?...) to the SDK's session manager. Expo's
// prebuild regenerates ios/ and a Swift AppDelegate, so we reapply two edits on
// every prebuild:
//   1. Import RNSpotifyRemoteAuth via the Swift bridging header.
//   2. Give the SDK first crack at openURL, ahead of expo-router's linking.

const IMPORT_LINE = '#import <RNSpotifyRemote/RNSpotifyRemoteAuth.h>';

/** Add the import to the target's bridging header (create it if missing). */
function withSpotifyBridgingHeader(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const projectRoot = cfg.modRequest.platformProjectRoot;
      const name = cfg.modRequest.projectName;
      const headerPath = path.join(
        projectRoot,
        name,
        `${name}-Bridging-Header.h`
      );
      let contents = fs.existsSync(headerPath)
        ? fs.readFileSync(headerPath, 'utf8')
        : '//\n// Bridging header\n//\n';
      if (!contents.includes(IMPORT_LINE)) {
        contents += `\n${IMPORT_LINE}\n`;
        fs.writeFileSync(headerPath, contents);
      }
      return cfg;
    },
  ]);
}

/** Insert the Spotify openURL forwarding into AppDelegate.swift. */
function withSpotifyOpenURL(config) {
  return withAppDelegate(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes('RNSpotifyRemoteAuth.sharedInstance()')) return cfg;

    // Replace the stock openURL body (which only calls the linking manager).
    const stock =
      'return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)';
    if (src.includes(stock)) {
      src = src.replace(
        stock,
        `if RNSpotifyRemoteAuth.sharedInstance().application(app, open: url, options: options) {\n      return true\n    }\n    ${stock}`
      );
      cfg.modResults.contents = src;
    } else {
      throw new Error(
        'withSpotifyAuth: could not find the stock openURL body in AppDelegate.swift to patch.'
      );
    }
    return cfg;
  });
}

module.exports = function withSpotifyAuth(config) {
  config = withSpotifyBridgingHeader(config);
  config = withSpotifyOpenURL(config);
  return config;
};
