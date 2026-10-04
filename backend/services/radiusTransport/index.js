const errors = require("./errors");
const featureFlag = require("./featureFlag");
const profile = require("./profile");
const secrets = require("./secrets");
const transport = require("./transport");
const client = require("./client");

module.exports = Object.assign({}, errors, featureFlag, profile, secrets, transport, client, {
  RADIUS_TRANSPORT_LAYER: "radiusTransport",
  RADIUS_PROTOCOL_LAYER: "radius",
});