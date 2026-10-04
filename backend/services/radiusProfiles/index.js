const radiusProfileService = require("./radiusProfileService");

module.exports = Object.assign({}, radiusProfileService, {
  RADIUS_PROFILE_LAYER: "radiusProfiles",
});
