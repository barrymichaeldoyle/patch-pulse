import * as vscode from 'vscode';
import { getDependencyStatus } from '@patch-pulse/shared';
import { createRangeFromPackageName } from './createRangeFromLineNumber';

interface CreateDecorationArgs {
  currentVersion: string;
  latestVersion: string;
  packageJsonDocument: vscode.TextDocument;
  packageName: string;
}

/**
 * Creates a decoration for a package in the package.json file.
 * @param args - The arguments for creating the decoration.
 * @returns The decoration.
 */
export function createDecoration({
  currentVersion,
  latestVersion,
  packageJsonDocument,
  packageName,
}: CreateDecorationArgs) {
  const dependencyStatus = getDependencyStatus({
    packageName,
    currentVersion,
    latestVersion,
  });

  return {
    range: createRangeFromPackageName(packageJsonDocument, packageName),
    renderOptions: {
      after: {
        contentText:
          dependencyStatus.status === 'update-available'
            ? `new version available (${latestVersion})`
            : 'up to date',
        fontStyle: 'italic',
        color: '#888888',
      },
    },
  };
}
