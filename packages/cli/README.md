# @scrimble/cli

The Scrimble Core Engine CLI.

## Installation

```bash
npm install -g @scrimble/cli
```

## Usage

```bash
scrimble plan <projectDir>
```

## Maintainer Release Workflow

To perform a version bump and publish to the npm registry, follow these steps locally:

1. Navigate to the CLI package directory:
   ```bash
   cd packages/cli
   ```

2. Run the release script for the appropriate semver bump (patch, minor, or major):
   ```bash
   # For a patch release (e.g., 1.0.0 -> 1.0.1)
   npm run release:patch
   
   # For a minor release (e.g., 1.0.0 -> 1.1.0)
   npm run release:minor
   
   # For a major release (e.g., 1.0.0 -> 2.0.0)
   npm run release:major
   ```

These scripts will automatically:
- Bump the version in `package.json`
- Compile the TypeScript source into a bundled JavaScript executable
- Publish the resulting package to the npm registry
