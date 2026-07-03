import assert from "node:assert/strict";
import test from "node:test";

import { isValidDeployHost, parseDeployMarker } from "../desktop/logic/controller-deploy";

test("host validation accepts ssh-ish hosts and rejects injection", () => {
  assert.equal(isValidDeployHost("spark-2822"), true);
  assert.equal(isValidDeployHost("ser@192.168.1.70"), true);
  assert.equal(isValidDeployHost("user@host.tailnet-1234.ts.net"), true);
  assert.equal(isValidDeployHost("-oProxyCommand=evil"), false);
  assert.equal(isValidDeployHost("host; rm -rf /"), false);
  assert.equal(isValidDeployHost("host $(x)"), false);
  assert.equal(isValidDeployHost(""), false);
});

test("marker parsing extracts url and api key", () => {
  const parsed = parseDeployMarker(
    'LOCAL_STUDIO_CONTROLLER {"url":"http://100.83.190.2:8090","api_key":"abc123"}',
  );
  assert.deepEqual(parsed, { url: "http://100.83.190.2:8090", apiKey: "abc123" });
  assert.equal(parseDeployMarker("[local-studio] waiting for controller"), null);
  assert.equal(parseDeployMarker("LOCAL_STUDIO_CONTROLLER not-json"), null);
});
