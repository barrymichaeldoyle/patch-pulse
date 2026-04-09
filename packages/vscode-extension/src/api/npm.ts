export function getPackageInfo(packageName: string) {
  return import('@patch-pulse/shared').then(({ fetchNpmPackageManifest }) =>
    fetchNpmPackageManifest(packageName, {
      userAgent: 'vscode-patch-pulse-extension',
    }),
  );
}
