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

// Assumes Pendo agent is already initialized on the page
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
| Caching | N/A (Pendo agent) | Yes |

## How It Works

Pendo feature flags are based on **segments**. When a visitor/account matches a segment, the corresponding flag key is included in the `segmentFlags` array.

### Web Provider
- Reads flags from `window.pendo.segmentFlags` populated by the Pendo agent
- Requires the Pendo agent snippet to be installed on the page

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

## License

MIT
