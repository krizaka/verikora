// The @krizaka packages (and the @tanstack engines under their facades) are ESM with an `import` condition only (no `require`): Jest, which resolves in CommonJS, finds
// nothing. This resolver adds that condition for them alone (Babel then transforms them, see transformIgnorePatterns) and
// hands every other request to the React Native preset's resolver, unchanged.
const preset = require(
  require.resolve("@react-native/jest-preset/jest/resolver.js", {
    paths: [require.resolve("react-native/package.json", { paths: [require.resolve("jest-expo/package.json")] })],
  }),
);

module.exports = function resolveKrizakaPackages(request, options) {
  if (request.startsWith("@krizaka/") || request.startsWith("@tanstack/")) {
    return options.defaultResolver(request, { ...options, conditions: ["import", "react-native", "default"] });
  }
  return preset(request, options);
};
