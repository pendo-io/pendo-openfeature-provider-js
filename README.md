# Pendo OpenFeature Providers

OpenFeature providers for [Pendo](https://www.pendo.io/) feature flags. These providers allow you to use Pendo's segment-based feature flags through the standardized [OpenFeature](https://openfeature.dev/) API.

## Packages

| Package | Description | Environment |
|---------|-------------|-------------|
| [@pendo/openfeature-web-provider](./packages/web-provider) | Browser/client-side provider | Web browsers |
| [@pendo/openfeature-server-provider](./packages/server-provider) | Server-side provider | Node.js |

## Quick Start

### Web (Browser)

```bash
npm install @pendo/openfeature-web-provider @openfeature/web-sdk
```

```typescript
import { OpenFeature } from '@openfeature/web-sdk';
import { PendoProvider } from '@pendo/openfeature-web-provider';

// Assumes the Pendo Web SDK is already initialized on the page
await OpenFeature.setProviderAndWait(new PendoProvider());

const client = OpenFeature.getClient();
const showNewFeature = await client.getBooleanValue('new-checkout-flow', false);

if (showNewFeature) {
  // Render new checkout experience
}
```

### Server (Node.js)

```bash
npm install @pendo/openfeature-server-provider @openfeature/server-sdk
```

```typescript
import { OpenFeature } from '@openfeature/server-sdk';
import { PendoProvider } from '@pendo/openfeature-server-provider';

const pendoProvider = new PendoProvider({
  apiKey: process.env.PENDO_API_KEY!,
  defaultUrl: 'https://myapp.example.com',
  trackEventSecret: process.env.PENDO_TRACK_SECRET,
});

await OpenFeature.setProviderAndWait(pendoProvider);

const client = OpenFeature.getClient();
const showNewFeature = await client.getBooleanValue('new-checkout-flow', false, {
  targetingKey: 'user-123',
  accountId: 'account-456',
});
```

## OpenFeature Compliance

These providers implement the [OpenFeature Provider Specification](https://openfeature.dev/docs/reference/concepts/provider).

| Feature | Web Provider | Server Provider |
|---------|--------------|-----------------|
| Boolean flags | Yes | Yes |
| String flags | Yes | Yes |
| Number flags | Yes | Yes |
| Object flags | Yes | Yes |
| Targeting context | Yes | Yes |
| Provider lifecycle | Yes | Yes |
| Event tracking | Yes | Yes |
| Caching | N/A (Pendo Web SDK) | Yes |

## How It Works

Pendo feature flags are based on **segments**. When a visitor/account matches a segment, the corresponding flag key is included in the `segmentFlags` array.

### Web Provider
- Reads flags from `window.pendo.segmentFlags` populated by the Pendo Web SDK
- Requires the Pendo Web SDK snippet to be installed on the page

### Server Provider
- Calls Pendo's `/data/segmentflag.json` API with JZB-encoded context
- Caches results per visitor/account with configurable TTL

## Context Mapping

| OpenFeature Context | Pendo Concept |
|---------------------|---------------|
| `targetingKey` | Visitor ID |
| `accountId` | Account ID |

## Event Tracking

Both providers expose a `track()` method for sending custom events to Pendo:

```typescript
// Web
pendoProvider.track('checkout_started', undefined, { cartValue: '99.99' });

// Server
pendoProvider.track('checkout_started', { targetingKey: 'user-123' }, { cartValue: '99.99' });
```

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test
```

## Releasing

Publishing is triggered by pushing a version tag. CircleCI runs the tests and then publishes both packages to Artifactory and npm.

1. Bump `version` in both `packages/web-provider/package.json` and `packages/server-provider/package.json` (and update `package-lock.json`) through a PR to `main`. Use a minor bump for new features and a patch bump for fixes.
2. On GitHub, go to **Releases** → **Draft a new release**.
3. In **Choose a tag**, type a new tag matching the version you bumped to, prefixed with `v` (for example `v0.3.1`), and select **Create new tag: ... on publish**. Set the target to `main`. The tag must match `vX.Y.Z` or CircleCI will not run the publish workflow.
4. Add a title and release notes (**Generate release notes** works well), then click **Publish release**.
5. Watch the `publish` workflow in CircleCI to confirm it succeeds.

Alternatively, steps 2-4 can be done with the [GitHub CLI](https://cli.github.com/), which creates the tag from `main` and publishes the release with generated notes:

```bash
gh release create v0.3.1 --target main --title v0.3.1 --generate-notes
```

The published version comes from each package's `package.json`, not from the tag. If a version is already published the publish step is skipped, so a tag without a matching version bump publishes nothing.

## License

MIT
