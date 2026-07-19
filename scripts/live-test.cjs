/**
 * Live contract smoke for the server provider, run with `npm run test:live`
 * (builds first — this deliberately exercises the built artifact in dist/).
 *
 * Validates two things against the real Pendo data plane that unit tests
 * structurally cannot: (1) the segmentflag response still has a shape this
 * package parses (`flags` map or legacy `segmentFlags` array) — silent shape
 * drift resolves every flag to its default with no error, which is how the
 * 0.2.0 parsing bug went unnoticed; (2) a real evaluation round-trips.
 *
 * Configure via env (dotenv is loaded by the npm script):
 *   PENDO_API_KEY      required — the app's agent identifier
 *   PENDO_VISITOR_ID   required — a visitor known to Pendo
 *   PENDO_ACCOUNT_ID   optional — account for the evaluation context
 *   PENDO_DEFAULT_URL  optional — url sent as evaluation context
 *   PENDO_EXPECT_FLAG  optional — a flag name expected to resolve true for
 *                      this identity; the run fails if it does not
 */
const { PendoProvider, encodeJzb } = require("../packages/server-provider/dist/index.js");

const DATA_HOST = "https://data.pendo.io";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var ${name} — see scripts/live-test.cjs header.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const apiKey = requireEnv("PENDO_API_KEY");
  const visitorId = requireEnv("PENDO_VISITOR_ID");
  const accountId = process.env.PENDO_ACCOUNT_ID;
  const defaultUrl = process.env.PENDO_DEFAULT_URL || "";
  const expectFlag = process.env.PENDO_EXPECT_FLAG;

  // 1. Raw shape contract: fetch the endpoint directly and assert the body
  //    carries a shape this package knows how to parse.
  const jzb = encodeJzb({ visitorId, accountId, url: defaultUrl });
  const response = await fetch(`${DATA_HOST}/data/segmentflag.json/${apiKey}?jzb=${jzb}`);
  if (response.status === 202) {
    console.error(
      `Visitor "${visitorId}" is unknown to Pendo (202) — shape cannot be checked. ` +
        "Use a visitor that has been identified at least once."
    );
    process.exit(1);
  }
  if (!response.ok) {
    console.error(`segmentflag.json returned ${response.status} ${response.statusText}`);
    process.exit(1);
  }
  const body = await response.json();
  if (body.flags && typeof body.flags === "object") {
    console.log(`shape OK: live "flags" map with ${Object.keys(body.flags).length} entr(ies)`);
  } else if (Array.isArray(body.segmentFlags)) {
    console.log(`shape OK: legacy "segmentFlags" array with ${body.segmentFlags.length} entr(ies)`);
  } else {
    console.error(
      `SHAPE DRIFT: response has neither "flags" nor "segmentFlags" — this package would ` +
        `silently resolve every flag to its default. Body keys: ${Object.keys(body).join(", ")}`
    );
    process.exit(1);
  }

  // 2. Provider round-trip: evaluate through the real (built) code path.
  const provider = new PendoProvider({ apiKey, defaultUrl });
  const flagToCheck = expectFlag || "liveTestProbe";
  const context = accountId
    ? { targetingKey: visitorId, accountId }
    : { targetingKey: visitorId };
  const result = await provider.resolveBooleanEvaluation(flagToCheck, false, context);
  console.log(`evaluation of "${flagToCheck}": ${JSON.stringify(result)}`);

  if (result.reason === "ERROR") {
    console.error("evaluation returned ERROR — see message above");
    process.exit(1);
  }
  if (expectFlag && result.value !== true) {
    console.error(
      `expected "${expectFlag}" to resolve true for this identity, got ${result.value}`
    );
    process.exit(1);
  }
  console.log("live contract smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
