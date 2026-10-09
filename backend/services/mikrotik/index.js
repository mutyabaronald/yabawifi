// Phase 8.5A — MikroTik router control foundation.
//
// Public surface of the router-control foundation.
//
// Phase 8.5A scope reminder: this package provides the RouterOS control
// foundation ONLY. It does NOT register an AAA adapter, does NOT provision
// customer sessions, and does NOT enable production router traffic. The
// adapter seam that will consume this package is
// backend/services/roamingEnforcementService.js, which is deliberately left
// unmodified.

const errors = require("./errors");
const featureFlag = require("./featureFlag");
const identity = require("./identity");
const secrets = require("./secrets");
const routerOsClient = require("./routerOsClient");
const hotspotUserService = require("./hotspotUserService");
const enforcementSnapshot = require("./enforcementSnapshot");
const mockRouterOsTransport = require("./mockRouterOsTransport");
const mikrotikEnforcementAdapter = require("./mikrotikEnforcementAdapter");

module.exports = {
  ...errors,
  ...featureFlag,
  ...identity,
  ...secrets,
  ...routerOsClient,
  ...hotspotUserService,
  ...enforcementSnapshot,
  ...mockRouterOsTransport,
  ...mikrotikEnforcementAdapter,
};