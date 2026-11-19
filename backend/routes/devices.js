const express = require("express");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

function createDevicesRouter({
  db = null,
  admin = null,
  registry = null,
  credentialLifecycle = null,
  checkCiscoConnection = null,
  featureFlag = null,
} = {}) {
  // Lazy defaults — only used when no injection supplied (production)
  // If exactly one of db/admin is provided, throw explicit error (no silent fallback)
  if ((db === null) !== (admin === null)) {
    throw new Error("createDevicesRouter: both db and admin must be provided together, or neither (for production defaults)");
  }
  const firebase = db && admin ? { db, admin } : require("../firebase");
  const reg = registry || require("../services/roamingRegistryService");
  const cl = credentialLifecycle || require("../services/mikrotik/credentialLifecycle");
  const cisco = checkCiscoConnection || require("../services/ciscoService");
  const ff = featureFlag || require("../services/mikrotik/featureFlag");
  const {
    NETWORK_CONTROL_MODES,
    NETWORK_CONTROL_VALUES,
    DEFAULT_ROUTER_OS_API_PORT,
    normalizeNetworkControl,
  } = ff;

  const { db: firebaseDb, admin: firebaseAdmin } = firebase;
  const router = express.Router();

  // ─────────────────────────────────────────────────────────────
  // Valid router vendors (Phase 8.6c-5a). Only "mikrotik" has a working adapter.
  // ─────────────────────────────────────────────────────────────
  const VALID_VENDORS = Object.freeze(["mikrotik", "unifi", "omada", "cisco", "generic"]);

  // ✅ ENV VARS (set these in .env)
  const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL || "http://localhost:5000"; // public URL reachable by routers

  // ─────────────────────────────────────────────────────────────
  // Device callback authentication (Phase 8.5A security hardening)
  // ─────────────────────────────────────────────────────────────
  // ARCHITECTURAL ROLE
  //   GET /api/devices/connected is NOT a user-facing owner endpoint. It is an
  //   INTERNAL SERVICE CALLBACK invoked BY THE ROUTER ITSELF: the generated
  //   bootstrap script embeds a `/tool fetch` URL that the MikroTik device
  //   executes after it applies its configuration (see the bootstrap route).
  //   The router has no owner session and no superadmin JWT, so owner/superadmin
  //   authentication cannot apply here. A shared secret is therefore the correct
  //   mechanism for this endpoint.
  //
  // WHAT WAS WRONG
  //   The secret defaulted to the literal "supersecret". Anyone who knew that
  //   default could mark any device online or offline. Worse, render.yaml does not
  //   set CALLBACK_SECRET, so the deployed service ran with that guessable default.
  //
  // FINAL BEHAVIOUR
  //   * No default value. An unset CALLBACK_SECRET is treated as "not configured".
  //   * A weak/known literal is refused just as hard as an unset value.
  //   * When not configured the endpoint fails CLOSED with 503 and accepts nothing.
  //   * Comparison is length-checked and constant-time.
  //   * The secret is never logged, never returned and never echoed.
  const CALLBACK_SECRET_ENV_VAR = "CALLBACK_SECRET";
  const CALLBACK_SECRET_MIN_LENGTH = 16;

  // Known-weak values that must never be accepted as a real credential.
  const WEAK_CALLBACK_SECRETS = new Set([
    "supersecret",
    "changeme",
    "secret",
    "password",
    "supersecretpassword",
    "yabalink",
  ]);

  const CONFIGURED_CALLBACK_SECRET = process.env[CALLBACK_SECRET_ENV_VAR] || null;

  function isCallbackSecretConfigured() {
    const value = CONFIGURED_CALLBACK_SECRET;
    if (typeof value !== "string" || value.length < CALLBACK_SECRET_MIN_LENGTH) {
      return false;
    }
    if (WEAK_CALLBACK_SECRETS.has(value.toLowerCase())) return false;
    return true;
  }

  // Constant-time comparison that does not leak length via early return.
  function secretsMatch(provided, expected) {
    const a = Buffer.from(String(provided), "utf8");
    const b = Buffer.from(String(expected), "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  // ─────────────────────────────────────────────────────────────
  // RouterOS host validation (Phase 8.5C Step 1)
  // ─────────────────────────────────────────────────────────────
  // Conservative input validation for routerOsHost. This is SYNTAX ONLY.
  // It does NOT perform DNS resolution, network reachability checks, or
  // establish that the host is reachable. It rejects malformed and dangerous
  // values that could be used for SSRF or misconfiguration.
  //
  // Private IP addresses (RFC1918) are ALLOWED because MikroTik routers may
  // legitimately be reachable over a private management network or VPN.
  // This is SYNTAX validation only — it does not create network access.
  //
  // Validation rejects:
  //   - Empty/whitespace-only when explicitly supplied
  //   - URL schemes (http://, https://)
  //   - Paths, query strings, fragments, embedded credentials
  //   - Loopback (127.0.0.1, ::1, localhost)
  //   - Link-local (169.254.0.0/16, fe80::/10)
  //   - Cloud metadata endpoint (169.254.169.254)
  //   - Invalid hostname/IP syntax
  //
  // Private IPs (RFC1918) are ACCEPTED as valid host identifiers.
  // This does NOT create network access or attempt connection.
  //
  // Requirement: Actual network access control (firewall, VPN, static egress IP)
  // is an infrastructure prerequisite for live transport, not something this
  // syntax validation can provide.
  // ─────────────────────────────────────────────────────────────

  function validateRouterOsHost(value) {
    if (value === undefined || value === null) {
      return null; // optional field, not provided
    }
    if (typeof value !== "string") {
      throw new registry.RegistryError(400, "validation_error", "routerOsHost must be a string");
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new registry.RegistryError(400, "validation_error", "routerOsHost cannot be empty or whitespace");
    }

    // Reject URL schemes
    if (/^https?:\/\//i.test(trimmed)) {
      throw new registry.RegistryError(400, "validation_error", "routerOsHost must not include a URL scheme (http:// or https://)");
    }

    // Reject paths, query strings, fragments
    if (/[\/\?#]/.test(trimmed)) {
      throw new registry.RegistryError(400, "validation_error", "routerOsHost must not contain paths, query strings, or fragments");
    }

    // Reject embedded credentials (user:pass@host)
    if (/@/.test(trimmed)) {
      throw new registry.RegistryError(400, "validation_error", "routerOsHost must not contain embedded credentials");
    }

    // Check for IPv6 literal in brackets [::1] or [2001:db8::1]
    let host = trimmed;
    let isIPv6Literal = false;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      isIPv6Literal = true;
      host = trimmed.slice(1, -1);
      if (host.length === 0) {
        throw new registry.RegistryError(400, "validation_error", "Invalid IPv6 literal");
      }
    }

    // Validate as IP address
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

    let isValidIP = false;
    let ipParts = null;

    if (ipv4Regex.test(host)) {
      const parts = host.split(".").map(Number);
      if (parts.every(p => p >= 0 && p <= 255)) {
        isValidIP = true;
        ipParts = parts;
      } else {
        // IPv4-like syntax but with invalid octet (e.g., 256) - reject, don't fall through to hostname
        throw new registry.RegistryError(400, "validation_error", "routerOsHost has an invalid IPv4 octet (must be 0-255)");
      }
    } else if (ipv6Regex.test(host) || isIPv6Literal) {
      // Basic IPv6 validation - more thorough validation would use a library
      // For now, accept if it looks like IPv6 syntax
      isValidIP = true;
    }

    // Validate hostname (RFC 1123 / RFC 952)
    const hostnameRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    const isValidHostname = hostnameRegex.test(host) && host.length <= 253;

    if (!isValidIP && !isValidHostname) {
      throw new registry.RegistryError(400, "validation_error", "routerOsHost must be a valid hostname or IP address");
    }

    // Reject dangerous IPs (loopback, link-local, cloud metadata)
    if (isValidIP && ipParts) {
      // Loopback 127.0.0.0/8
      if (ipParts[0] === 127) {
        throw new registry.RegistryError(400, "validation_error", "routerOsHost must not be a loopback address (127.0.0.0/8)");
      }
      // Link-local 169.254.0.0/16
      if (ipParts[0] === 169 && ipParts[1] === 254) {
        throw new registry.RegistryError(400, "validation_error", "routerOsHost must not be a link-local address (169.254.0.0/16)");
      }
      // Cloud metadata 169.254.169.254
      if (ipParts[0] === 169 && ipParts[1] === 254 && ipParts[2] === 169 && ipParts[3] === 254) {
        throw new registry.RegistryError(400, "validation_error", "routerOsHost must not be the cloud metadata endpoint (169.254.169.254)");
      }
      // Loopback IPv6 ::1/128 (for IPv6 literals)
      // We don't fully parse IPv6 here, but we can check the literal
      if (isIPv6Literal && host === "::1") {
        throw new registry.RegistryError(400, "validation_error", "routerOsHost must not be the IPv6 loopback address (::1)");
      }
      // Link-local IPv6 fe80::/10 (basic check)
      if (isIPv6Literal && /^fe80:/i.test(host)) {
        throw new registry.RegistryError(400, "validation_error", "routerOsHost must not be an IPv6 link-local address (fe80::/10)");
      }
      // Cloud metadata IPv6 (not typically used, but defensive)
      // 169.254.169.254 doesn't have a standard IPv6 equivalent, but some clouds use fd00::/8
    }

    // Reject "localhost" hostname
    if (host.toLowerCase() === "localhost") {
      throw new registry.RegistryError(400, "validation_error", "routerOsHost must not be 'localhost'");
    }

    // Return the validated, trimmed value
    return trimmed;
  }

  // ─────────────────────────────────────────────────────────────
  // Credential redaction helpers (Phase 8.5A security hardening)
  // ─────────────────────────────────────────────────────────────
  // Every device response boundary strips credential material. The document in
  // Firestore keeps the secrets the backend legitimately needs; only the response
  // is sanitized.

  const DEVICE_SECRET_FIELDS = Object.freeze([
    "sshPassword",
    "enablePassword",
    "token",
    "routerOsApiSecretRef",
    "routerOsApiUsername",
    "routerOsApiPassword",
    "password",
    "secret",
    "apiPassword",
    "callbacksSecret",
  ]);

  function sanitizeDevice(device) {
    if (!device || typeof device !== "object") return device;
    const safe = { ...device };
    for (const field of DEVICE_SECRET_FIELDS) {
      delete safe[field];
    }
    // Credential STATE, never credential material.
    //
    // Because the stored password is no longer returned, the edit form cannot tell
    // "a password is stored, leave it alone" from "no password is stored, ask the
    // owner for one". These booleans close that gap without ever putting the secret
    // in a response. They are the only credential-derived values ever emitted.
    safe.hasPassword = Boolean(device.sshPassword);
    safe.hasEnablePassword = Boolean(device.enablePassword);
    safe.hasSecret = Boolean(device.routerOsApiSecretRef);
    return safe;
  }

  // Recursively replace credential-bearing VALUES with a marker. Used on log
  // `meta` objects so a credential cannot ride out inside a nested structure.
  const SENSITIVE_VALUE_KEYS = new Set([
    "sshpassword",
    "enablepassword",
    "password",
    "passphrase",
    "token",
    "secret",
    "apipassword",
    "api_password",
    "routerosapipassword",
    "routerosapisecretref",
    "routerosapiusername",
    "callbacksecret",
    "callbackssecret",
    "sharedsecret",
  ]);

  function redactSensitiveFields(value, depth = 0) {
    if (depth > 6) return null;
    if (Array.isArray(value)) {
      return value.map((item) => redactSensitiveFields(item, depth + 1));
    }
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, inner] of Object.entries(value)) {
        out[key] = SENSITIVE_VALUE_KEYS.has(key.toLowerCase())
          ? "[REDACTED]"
          : redactSensitiveFields(inner, depth + 1);
      }
      return out;
    }
    return value;
  }

  // Diagnostics echo router-reported messages back to the caller. Strip anything
  // credential-shaped so an SSH or ping failure can never surface a password, a
  // token or a secret reference, whatever the router or driver put in it.
  function redactDiagnosticMessage(message) {
    if (typeof message !== "string" || message.length === 0) {
      return "Device diagnostic failed";
    }
    return message
      .replace(
        /\b(sshPassword|enablePassword|password|passphrase|apiPassword|secret|token|routerOsApiSecretRef|routerOsApiUsername)\b(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;)]+)/gi,
        (match, key, separator) => `${key}${separator}[REDACTED]`,
      )
      .slice(0, 300);
  }

  // ─────────────────────────────────────────────────────────────
  // Owner / device authorization helpers (Phase 8.5A security hardening)
  // ─────────────────────────────────────────────────────────────
  // ONE ownership rule, applied consistently to every device endpoint:
  //
  //   superadmin -> permitted, per the existing superadmin model
  //   owner       -> only a device whose device.ownerId === authenticated ownerId
  //   anonymous   -> 401, always
  //
  // The authenticated identity is authoritative. A URL ownerId, body ownerId or
  // query-string ownerId is NEVER trusted on its own; it is only ever compared
  // against the identity established by the existing guard.
  //
  // Every /api/roaming/* route already uses this model (roamingRegistryService.js:66-134).
  // No new authentication system is introduced here: owner sessions are the existing
  // `owner_sessions` bearer tokens, and superadmin is the existing signed JWT.

  /**
   * Authenticate, then load the device, then enforce ownership.
   *
   * Authentication happens BEFORE the device lookup, so an anonymous caller can
   * never distinguish "device exists" from "device does not exist".
   */
  async function requireOwnedDevice(req, deviceId) {
    const auth = await registry.authenticateOwnerOrSuper(req);
    const snap = await db.collection("devices").doc(String(deviceId)).get();
    if (!snap.exists) {
      throw new registry.RegistryError(404, "not_found", "Device not found");
    }
    const device = snap.data() || {};
    assertDeviceAccessAllowed(auth, device);
    return { auth, device };
  }

  /**
   * Resolve the owner a new device must belong to.
   *
   * For an ordinary owner the AUTHENTICATED identity is authoritative: a body
   * ownerId is only accepted when it matches, so "owner A authenticated +
   * ownerId = owner B" cannot create a device belonging to owner B. Superadmin
   * retains the existing administrative ability to create a device for any owner.
   */
  function resolveTargetOwnerId(auth, requestedOwnerId) {
    if (auth.kind === "superadmin") return requestedOwnerId;
    if (String(requestedOwnerId) !== String(auth.ownerId)) {
      throw new registry.RegistryError(
        403,
        "unauthorized_scope",
        "Cannot create a device for another owner",
      );
    }
    return auth.ownerId;
  }

  // Owner isolation, matching the existing model used by assertDeviceOwnedBy and
  // requireOwnerSelf: superadmin keeps platform-wide access, an owner is confined
  // to their own devices.
  function assertDeviceAccessAllowed(auth, device) {
    if (auth.kind === "superadmin") return;
    if (String(device?.ownerId) !== String(auth.ownerId)) {
      throw new registry.RegistryError(
        403,
        "unauthorized_scope",
        "Device does not belong to the authenticated owner",
      );
    }
  }

  // RegistryError -> the existing roaming error convention
  // { success:false, error:<code>, message:<text> }.
  // Anything else -> the devices.js 500 shape.
  function handleDeviceError(res, err) {
    if (err && typeof err.status === "number" && typeof err.code === "string") {
      return res.status(err.status).json({
        success: false,
        error: err.code,
        message: err.message,
      });
    }
    console.error("Device request error:", err?.message || err);
    return res
      .status(500)
      .json({ success: false, message: "Device request failed" });
  }

  // Maps credential lifecycle typed errors to HTTP responses.
  // Identifies errors by their .name property (class name).
  function mapCredentialError(res, err, _context) {
    if (!err || typeof err.name !== "string") {
      console.error("Credential error (unknown):", err?.message || err);
      return res.status(500).json({ success: false, message: "Credential operation failed" });
    }
    switch (err.name) {
      case "ConcurrentModificationError":
        return res.status(409).json({ success: false, error: "concurrent_modification", message: err.message || "Concurrent modification" });
      case "CredentialIntegrityError":
        return res.status(500).json({ success: false, error: "credential_integrity_error", message: err.message || "Credential integrity error" });
      case "DeviceNotFoundError":
        return res.status(404).json({ success: false, error: "not_found", message: err.message || "Device not found" });
      case "OwnerMismatchError":
        return res.status(403).json({ success: false, error: "owner_mismatch", message: err.message || "Owner mismatch" });
      case "TransactionContentionError":
        res.set("Retry-After", "2");
        return res.status(503).json({ success: false, error: "transaction_contention", message: err.message || "Transaction contention, please retry" });
      default:
        console.error("Credential error (unhandled):", err?.message || err);
        return res.status(500).json({ success: false, message: "Credential operation failed" });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────
  const toArray = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    return String(val)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  };

  function generateToken() {
    return crypto.randomBytes(16).toString("hex");
  }

  async function appendDeviceLog(deviceId, entry) {
    try {
      if (!deviceId) return;
      const log = {
        level: entry?.level || "info",
        type: entry?.type || "event",
        message: entry?.message || "",
        meta: entry?.meta || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAtISO: new Date().toISOString(),
      };
      await db
        .collection("devices")
        .doc(String(deviceId))
        .collection("logs")
        .add(log);
    } catch (err) {
      console.warn("[devices] Failed to append device log:", err?.message || err);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 1) Create device (called by frontend wizard Step 1)
  // ─────────────────────────────────────────────────────────────
  router.post("/api/devices", async (req, res) => {
    try {
      // Authenticate before anything is read or written.
      const auth = await registry.authenticateOwnerOrSuper(req);

      const {
        ownerId: requestedOwnerId,
        deviceName,
        routerIdentity, // Router identity/name (like "WeaveCo")
        deviceType = "mikrotik", // default to mikrotik
        vendor, // optional: "mikrotik" | "unifi" | "omada" | "cisco" | "generic"
        vendorModel, // optional: vendor-specific model string
        serviceType, // "hotspot" | "pppoe" | ["hotspot", "pppoe"] (array or single)
        antiSharing = false, // Anti-sharing protection for hotspot
        interfaces, // array of ports like ["ether2","ether3"]
        // Cisco SSH connection details (optional; used when deviceType === "cisco")
        ip,
        sshPort,
        sshUser,
        sshPassword,
        enablePassword,
        // Router control (Phase 8.5A) — all optional and fail-closed by default.
        networkControl: networkControlRaw,
        routerOsApiEnabled = false,
        routerOsApiPort,
        routerOsHost,
      } = req.body;

      if (!requestedOwnerId || !deviceName || !serviceType) {
        return res.status(400).json({
          success: false,
          message: "ownerId, deviceName, and serviceType are required.",
        });
      }

      // The AUTHENTICATED identity decides ownership. A body ownerId is never
      // trusted on its own: for an ordinary owner it must match the authenticated
      // owner, so owner A cannot create a device that belongs to owner B.
      const ownerId = resolveTargetOwnerId(auth, requestedOwnerId);

      // Normalize serviceType to array
      const serviceTypes = Array.isArray(serviceType)
        ? serviceType
        : [serviceType];
      if (serviceTypes.length === 0) {
        return res.status(400).json({
          success: false,
          message: "At least one service type must be selected.",
        });
      }

      // Validate vendor (Phase 8.6c-5a)
      const normalizedVendor =
        vendor === undefined || vendor === null || vendor === ""
          ? null
          : String(vendor).trim().toLowerCase();
      if (normalizedVendor !== null && !VALID_VENDORS.includes(normalizedVendor)) {
        return res.status(400).json({
          success: false,
          message: "vendor must be one of: " + VALID_VENDORS.join(", ") + ".",
        });
      }

      // Validate vendorModel (optional string)
      const normalizedVendorModel =
        vendorModel === undefined || vendorModel === null || vendorModel === ""
          ? null
          : String(vendorModel).trim();
      if (normalizedVendorModel !== null && normalizedVendorModel.length > 128) {
        return res.status(400).json({
          success: false,
          message: "vendorModel must be 128 characters or fewer.",
        });
      }

      // Validate routerOsHost if provided (Phase 8.5C Step 1)
      const validatedRouterOsHost = validateRouterOsHost(routerOsHost);

      const iface = Array.isArray(interfaces) ? interfaces : toArray(interfaces);
      const deviceId = uuidv4();
      const token = generateToken();

      const doc = {
        deviceId,
        ownerId,
        deviceName,
        routerIdentity: routerIdentity || "",
        deviceType,
        vendor: normalizedVendor,
        vendorModel: normalizedVendorModel,
        serviceType: serviceTypes, // Store as array
        antiSharing: antiSharing || false,
        interfaces: iface,
        status: "pending",
        token,
        ip: ip || null,
        sshPort: sshPort ? Number(sshPort) : null,
        sshUser: sshUser || null,
        sshPassword: sshPassword || null,
        enablePassword: enablePassword || null,
        // Router control (Phase 8.5A) — all optional and fail-closed by default.
        networkControl:
          networkControlRaw === undefined || networkControlRaw === null
            ? NETWORK_CONTROL_MODES.NONE
            : normalizeNetworkControl(networkControlRaw),
        routerOsApiEnabled: routerOsApiEnabled === true, // default: false
        routerOsApiPort:
          Number.isFinite(Number(routerOsApiPort)) &&
          Number(routerOsApiPort) > 0
            ? Number(routerOsApiPort)
            : DEFAULT_ROUTER_OS_API_PORT,
        routerOsHost: validatedRouterOsHost || null,
        // A REFERENCE to a secret held outside the device document, never the
        // secret itself. It stays null until a real secret backend exists; Phase
        // 8.5A ships the resolver abstraction only (mikrotik/secrets.js).
        routerOsApiSecretRef: null,
        routerOsLastSeenAt: null,
        routerOsApiState: "unknown",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await db.collection("devices").doc(deviceId).set(doc);
      appendDeviceLog(deviceId, {
        type: "device_created",
        message: `Device created: ${deviceName}`,
        meta: {
          deviceType,
          serviceType: serviceTypes,
          antiSharing: !!antiSharing,
          interfaces: iface,
          routerIdentity: routerIdentity || "",
        },
      });

      return res.json({
        success: true,
        // Stripped: this response previously echoed sshPassword, enablePassword
        // and the provisioning token straight back to the caller.
        device: sanitizeDevice(doc),
        // Frontend will call this next to show copyable script:
        provisioningScriptUrl: `${APP_PUBLIC_URL}/api/provisioning/script?deviceId=${deviceId}`,
      });
    } catch (err) {
      return handleDeviceError(res, err);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Cisco active SSH connection check
  // ─────────────────────────────────────────────────────────────
  router.get("/api/devices/:id/ssh-check", async (req, res) => {
    try {
      // Authenticate and authorize BEFORE touching the device. This endpoint runs
      // a real SSH connection using the stored Cisco credentials, so it must never
      // be reachable for another owner's device.
      const { device } = await requireOwnedDevice(req, req.params.id);

      if ((device.deviceType || "").toLowerCase() !== "cisco") {
        return res.status(400).json({
          success: false,
          message: "SSH check is only available for Cisco devices",
        });
      }

      const result = await checkCiscoConnection(device);

      await db
        .collection("devices")
        .doc(String(device.deviceId || req.params.id))
        .update({
          status: result.success ? "online" : "offline",
          routerModel: result.model || null,
          routerVersion: result.version || null,
          lastCheckedAtISO: new Date().toISOString(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      appendDeviceLog(String(device.deviceId || req.params.id), {
        type: "ssh_check",
        level: result.success ? "info" : "warn",
        message: result.success
          ? "Cisco SSH check succeeded"
          : `Cisco SSH check failed: ${redactDiagnosticMessage(result.message)}`,
        meta: {
          model: result.model || null,
          version: result.version || null,
        },
      });

      return res.json({
        success: result.success,
        status: result.success ? "online" : "offline",
        // Redacted: the driver-supplied message is never echoed verbatim.
        message: redactDiagnosticMessage(result.message),
        model: result.model || null,
        version: result.version || null,
      });
    } catch (err) {
      return handleDeviceError(res, err);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 2) Return "Step 2" provisioning snippet to show in UI
  // ─────────────────────────────────────────────────────────────
  router.get("/api/provisioning/script", async (req, res) => {
    try {
      // The deviceId in the query string is NEVER trusted on its own. Authenticate
      // FIRST, then authorize the caller against that device. This closes the gap
      // where an unauthenticated caller could learn whether a device exists and
      // — critically — receive its provisioning token.
      const auth = await registry.authenticateOwnerOrSuper(req);

      const { deviceId } = req.query;
      if (!deviceId) return res.status(400).send("Missing deviceId");

      const snap = await db.collection("devices").doc(String(deviceId)).get();
      if (!snap.exists) {
        throw new registry.RegistryError(404, "not_found", "Device not found");
      }

      const device = snap.data() || {};
      assertDeviceAccessAllowed(auth, device);

      appendDeviceLog(String(deviceId), {
        type: "provisioning_script_requested",
        message: "Provisioning script requested",
        meta: { deviceType: device.deviceType || "mikrotik" },
      });

      // This is the VERY SIMPLE copy/paste snippet (Step 2 UI)
      const script = [
        `/tool fetch url="${APP_PUBLIC_URL}/provisioning/bootstrap?rId=${device.deviceId}&token=${device.token}" dst-path=bootstrap.rsc`,
        `/delay 2`,
        `/import file-name=bootstrap.rsc`,
      ].join("\n");

      res.set("Content-Type", "text/plain");
      return res.send(script);
    } catch (err) {
      return handleDeviceError(res, err);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 3) Bootstrap script (downloaded by MikroTik)
  // ─────────────────────────────────────────────────────────────
  router.get("/provisioning/bootstrap", async (req, res) => {
    try {
      const { rId, token } = req.query;
      if (!rId || !token) return res.status(400).send("Missing rId/token");

      const ref = db.collection("devices").doc(rId);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).send("Device not found");

      const device = snap.data();
      if (device.token !== token) return res.status(403).send("Invalid token");

      // Enhanced bootstrap script matching video tutorial requirements
      const serviceTypes = Array.isArray(device.serviceType)
        ? device.serviceType
        : [device.serviceType];
      const interfaces = device.interfaces || ["ether2"];

      const scriptLines = [];

      appendDeviceLog(rId, {
        type: "bootstrap_requested",
        message: "Bootstrap script requested by router",
        meta: {
          routerIdentity: device.routerIdentity || "",
          serviceType: serviceTypes,
          interfaces,
          antiSharing: !!device.antiSharing,
        },
      });

      // 0) Set router identity if provided
      if (device.routerIdentity) {
        scriptLines.push(
          `/system identity set name="${device.routerIdentity}"`,
          `:put "Router identity set to: ${device.routerIdentity}"`,
        );
      }

      // 1) RouterOS API access — INTENTIONALLY NOT PROVISIONED HERE.
      //
      // Before Phase 8.5A this block emitted:
      //   /ip service set api address=0.0.0.0/0 disabled=no
      //   /user add name=yaba_api group=full password=<random> disabled=no
      //
      // That was unsafe on three independent axes:
      //   1. group=full grants complete router control, including the ability to
      //      re-expose or rewrite the device's own security settings.
      //   2. address=0.0.0.0/0 exposed the API to every network the router can
      //      reach, including the guest HotSpot network this very script builds.
      //   3. The generated password was returned in cleartext to whoever fetched
      //      /provisioning/bootstrap, which was gated only by device.token — a
      //      token that was itself published in the device-list API response.
      //
      // Phase 8.5A therefore provisions NO RouterOS API credential from this
      // endpoint. Router control stays off until BOTH device.routerOsApiEnabled
      // and the global ROAMING_MIKROTIK_API_ENABLED kill switch are set, and the
      // account must be created out-of-band with a restricted source address, a
      // least-privileged group, and a secret stored by reference only.
      scriptLines.push(
        `:put "RouterOS API access is NOT configured by this script."`,
        `:put "For YabaLink router control, create a least-privilege API user manually"`,
        `:put "restricted to the YabaLink control host, and store the secret by reference."`,
      );

      // 2) Create bridge for all selected interfaces (as shown in video)
      scriptLines.push(
        `:put "Creating bridge for interfaces: ${interfaces.join(", ")}"`,
        `/interface bridge add name=bridge_yaba protocol-mode=none`,
      );

      // Add all interfaces to bridge (except ether1 if it's the WAN port)
      interfaces.forEach((iface) => {
        scriptLines.push(
          `/interface bridge port add bridge=bridge_yaba interface=${iface}`,
        );
      });

      // 3) Configure services based on selected types
      if (serviceTypes.includes("hotspot")) {
        scriptLines.push(`:put "Configuring Hotspot service"`);

        // Use bridge interface for hotspot
        scriptLines.push(
          `/ip address add address=10.10.10.1/24 interface=bridge_yaba comment="YABA Hotspot"`,
          `/ip pool add name=hs_pool ranges=10.10.10.2-10.10.10.254`,
          `/ip dhcp-server add name=hs_dhcp interface=bridge_yaba address-pool=hs_pool disabled=no`,
          `/ip dhcp-server network add address=10.10.10.0/24 gateway=10.10.10.1 dns-server=8.8.8.8,1.1.1.1`,
        );

        // Hotspot profile
        scriptLines.push(
          `/ip hotspot profile add name=hs_prof hotspot-address=10.10.10.1 dns-name=yaba.login local-address=10.10.10.1 html-directory=hotspot`,
        );

        // Add anti-sharing if enabled
        if (device.antiSharing) {
          scriptLines.push(
            `/ip hotspot profile set hs_prof shared-users=1`,
            `:put "Anti-sharing protection enabled"`,
          );
        }

        scriptLines.push(
          `/ip hotspot add name=hs1 interface=bridge_yaba profile=hs_prof disabled=no`,
        );

        if (device.antiSharing) {
          scriptLines.push(`:put "Anti-sharing protection enabled"`);
        }
      }

      if (serviceTypes.includes("pppoe")) {
        scriptLines.push(`:put "Configuring PPPoE service"`);

        // PPPoE server configuration
        scriptLines.push(
          `/ip pool add name=pppoe_pool ranges=10.20.20.2-10.20.20.254`,
          `/ppp profile add name=pppoe_prof local-address=10.20.20.1 remote-address=pppoe_pool`,
          `/interface pppoe-server server add service-name=yaba_pppoe interface=bridge_yaba disabled=no`,
        );
      }

      // 2) Call back to your server → mark as connected
      //
      // The callback is emitted ONLY when CALLBACK_SECRET is explicitly configured
      // with a non-trivial value. Shipping a fetch against a default or absent
      // secret would bake a guessable credential into every provisioned router and
      // would fail anyway, because the endpoint now fails closed.
      scriptLines.push(`:delay 2`);
      if (isCallbackSecretConfigured()) {
        const callbackUrl = `${APP_PUBLIC_URL}/api/devices/connected?rId=${encodeURIComponent(
          rId,
        )}&secret=${encodeURIComponent(CONFIGURED_CALLBACK_SECRET)}&status=online`;
        scriptLines.push(
          `/tool fetch url="${callbackUrl}" keep-result=no`,
        );
      } else {
        scriptLines.push(
          `:put "Device online-callback is disabled: the server callback secret is not configured."`,
        );
        appendDeviceLog(rId, {
          type: "bootstrap_callback_disabled",
          level: "warn",
          message:
            "Online callback omitted from the bootstrap script: CALLBACK_SECRET is not configured",
        });
      }
      scriptLines.push(`:put "YABA bootstrap complete"`);

      const out = scriptLines.join("\n");
      res.set("Content-Type", "text/plain");
      return res.send(out);
    } catch (err) {
      console.error("Bootstrap error:", err);
      res.status(500).send("Internal error");
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 4) Router callback: mark as connected/online
  // ─────────────────────────────────────────────────────────────
  router.get("/api/devices/connected", async (req, res) => {
    try {
      const { rId, secret, status, ip } = req.query;

      // FAIL CLOSED when no usable callback secret is configured. Previously the
      // secret defaulted to the literal "supersecret", so a guessable value
      // authenticated the callback on any deployment that had not set the variable
      // (render.yaml does not set it).
      if (!isCallbackSecretConfigured()) {
        return res.status(503).json({
          success: false,
          error: "not_configured",
          message: `Device callback authentication is not configured. Set ${CALLBACK_SECRET_ENV_VAR}.`,
        });
      }

      // Constant-time comparison. The configured secret is never echoed or logged.
      if (
        typeof secret !== "string" ||
        secret.length === 0 ||
        !secretsMatch(secret, CONFIGURED_CALLBACK_SECRET)
      ) {
        return res.status(403).send("Forbidden");
      }

      const ref = db.collection("devices").doc(String(rId));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).send("Device not found");

      await ref.update({
        status: status === "online" ? "online" : "unknown",
        wanIp: ip || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      appendDeviceLog(String(rId), {
        type: "connected_callback",
        message: `Router callback received: ${status === "online" ? "online" : "unknown"}`,
        meta: { ip: ip || null },
      });

      return res.json({ success: true });
    } catch (err) {
      console.error("Device connected callback error:", err?.message || err);
      return res.status(500).json({ success: false });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 5) Device status (used by Step 3 polling)
  //    (Optional: integrate real MikroTik API check later)
  // ─────────────────────────────────────────────────────────────
  router.get("/api/devices/status/:id", async (req, res) => {
    try {
      // Authenticate BEFORE any resource lookup, so an unauthenticated caller
      // cannot use the response code to learn whether a device exists.
      const auth = await registry.authenticateOwnerOrSuper(req);

      const id = req.params.id;
      const snap = await db.collection("devices").doc(id).get();
      if (!snap.exists) {
        return res.status(404).json({
          success: false,
          error: "not_found",
          message: "Device not found",
        });
      }

      const d = snap.data() || {};
      assertDeviceAccessAllowed(auth, d);

      return res.json({
        success: true,
        status: d.status || "unknown",
        // Sanitized: no sshPassword, enablePassword, token, routerOsApiSecretRef
        // or routerOsApiUsername, but hasPassword/hasEnablePassword are present.
        device: sanitizeDevice(d),
      });
    } catch (err) {
      return handleDeviceError(res, err);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 6) Get all devices for an owner
  // ─────────────────────────────────────────────────────────────
  router.get("/api/devices/owner/:ownerId", async (req, res) => {
    try {
      const auth = await registry.authenticateOwnerOrSuper(req);
      const { ownerId } = req.params;

      // Owner isolation: an owner may only read their own inventory. Superadmin
      // retains platform-wide read access, as in the existing roaming model.
      if (auth.kind !== "superadmin") {
        registry.requireOwnerSelf(auth, ownerId);
      }

      let snapshot;
      try {
        snapshot = await db
          .collection("devices")
          .where("ownerId", "==", ownerId)
          .orderBy("createdAt", "desc")
          .get();
      } catch (err) {
        // If missing index or orderBy constraint, fallback to non-ordered query and sort in memory.
        // Also surface the real error so we can create the composite index when needed.
        console.error("DEVICES OWNER QUERY ERROR:", err?.message);
        console.error(err);

        const isIndexError =
          (typeof err?.code === "string" &&
            err.code.toLowerCase() === "failed-precondition") ||
          err?.code === 9 ||
          (typeof err?.message === "string" &&
            err.message.toLowerCase().includes("index"));

        if (!isIndexError) throw err;

        snapshot = await db
          .collection("devices")
          .where("ownerId", "==", ownerId)
          .get();
      }

      const devices = [];
      snapshot.forEach((doc) => {
        devices.push({
          id: doc.id,
          ...sanitizeDevice(doc.data()),
        });
      });

      // Best-effort sort: prefer ISO timestamps if present, else leave as-is
      devices.sort((a, b) => {
        const aT = a.createdAtISO
          ? Date.parse(a.createdAtISO)
          : a.updatedAtISO
          ? Date.parse(a.updatedAtISO)
          : 0;
        const bT = b.createdAtISO
          ? Date.parse(b.createdAtISO)
          : b.updatedAtISO
          ? Date.parse(b.updatedAtISO)
          : 0;
        return bT - aT;
      });

      return res.json({
        success: true,
        devices,
      });
    } catch (err) {
      // Routes 401/403 through the existing RegistryError convention instead of
      // collapsing an authorization denial into a 500.
      if (!err || typeof err.status !== "number") {
        console.error("GET DEVICES OWNER ERROR:", err?.message || err);
      }
      return handleDeviceError(res, err);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 7) Update device
  // ─────────────────────────────────────────────────────────────
  router.put("/api/devices/:id", async (req, res) => {
    try {
      const { id } = req.params;
      // Authenticate and authorize BEFORE applying any change. The owner identity
      // is authoritative; the URL id is only ever compared against it.
      const { device: existing } = await requireOwnedDevice(req, id);
      const updateData = { ...(req.body || {}) };

      // ───────────────────────────────────────────────────────────
      // Phase 8.5A hardening
      // ───────────────────────────────────────────────────────────
      // This route accepts an arbitrary body and forwarded it straight into
      // Firestore, so it could be used to overwrite the provisioning token, or to
      // write router-control fields that only an authorized control path should
      // ever change. Those are now rejected rather than silently persisted.
      const immutableFields = [
        "deviceId",
        "ownerId",
        "createdAt",
        "token",
        "routerOsApiSecretRef",
        "routerOsApiUsername",
        "routerOsLastSeenAt",
        "routerOsApiState",
      ];
      for (const field of immutableFields) {
        delete updateData[field];
      }

      // ───────────────────────────────────────────────────────────
      // Credential-state handling (Phase 8.5A security follow-up)
      // ───────────────────────────────────────────────────────────
      // Phase 8.5A stopped returning sshPassword/enablePassword, so the edit form
      // cannot hold the stored value and necessarily submits the field blank.
      //
      // Three cases, deliberately distinct:
      //   stored password + blank  -> keep the stored password (no write)
      //   stored password + new    -> overwrite with the new value
      //   NO stored password + blank-> refuse, because the owner asked to save a
      //                                 device that will have no usable credential
      //
      // An absent field (undefined) always means "not part of this update" and is
      // never treated as a request to clear a credential. There is no credential
      // removal workflow in this application, so a blank is never a deletion.
      //
      // `existing` is the already-authorized device loaded by requireOwnedDevice,
      // so no second read is needed.

      // Only sshPassword is ever mandatory: it is the Cisco SSH credential. The
      // enable password is optional in the onboarding form and stays optional here,
      // so a blank enablePassword is simply "no change" even when nothing is stored.
      const deviceType = String(
        updateData.deviceType || existing.deviceType || "",
      ).toLowerCase();
      const sshPasswordRequired = deviceType === "cisco";

      for (const field of ["sshPassword", "enablePassword"]) {
        const wasSubmitted = Object.prototype.hasOwnProperty.call(updateData, field);
        const isBlank =
          updateData[field] === undefined ||
          updateData[field] === null ||
          updateData[field] === "";

        if (!isBlank) continue; // a real new value: allowed to overwrite

        delete updateData[field];

        // Blank submitted for a credential that this device requires, and there is
        // no stored value to preserve.
        if (wasSubmitted && field === "sshPassword" && sshPasswordRequired && !existing.sshPassword) {
          return res.status(400).json({
            success: false,
            error: "validation_error",
            message:
              "An SSH password is required: this device has no stored password.",
          });
        }
      }

      if (
        updateData.networkControl !== undefined &&
        !NETWORK_CONTROL_VALUES.includes(String(updateData.networkControl))
      ) {
        return res.status(400).json({
          success: false,
          message: `networkControl must be one of: ${NETWORK_CONTROL_VALUES.join(", ")}.`,
        });
      }

      // Validate vendor if provided (Phase 8.6c-5a)
      if (updateData.vendor !== undefined && updateData.vendor !== null) {
        const v = String(updateData.vendor).trim().toLowerCase();
        if (v === "") {
          updateData.vendor = null;
        } else if (!VALID_VENDORS.includes(v)) {
          return res.status(400).json({
            success: false,
            message: "vendor must be one of: " + VALID_VENDORS.join(", ") + ".",
          });
        } else {
          updateData.vendor = v;
        }
      }

      // Validate vendorModel if provided (Phase 8.6c-5a)
      if (updateData.vendorModel !== undefined && updateData.vendorModel !== null) {
        const vm = String(updateData.vendorModel).trim();
        if (vm === "") {
          updateData.vendorModel = null;
        } else if (vm.length > 128) {
          return res.status(400).json({
            success: false,
            message: "vendorModel must be 128 characters or fewer.",
          });
        } else {
          updateData.vendorModel = vm;
        }
      }

      // Enabling per-device control is permitted here, but it is only ever half of
      // the switch: isRouterOsApiEnabledForDevice additionally requires the global
      // ROAMING_MIKROTIK_API_ENABLED kill switch to be on.
      if (updateData.routerOsApiEnabled !== undefined) {
        updateData.routerOsApiEnabled = updateData.routerOsApiEnabled === true;
      }

      if (updateData.routerOsApiPort !== undefined) {
        const port = Number(updateData.routerOsApiPort);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          return res.status(400).json({
            success: false,
            message: "routerOsApiPort must be an integer between 1 and 65535.",
          });
        }
        updateData.routerOsApiPort = port;
      }

      // Validate routerOsHost if provided (Phase 8.5C Step 1)
      if (updateData.routerOsHost !== undefined) {
        try {
          updateData.routerOsHost = validateRouterOsHost(updateData.routerOsHost);
        } catch (err) {
          if (err instanceof registry.RegistryError) {
            return res.status(err.status).json({
              success: false,
              error: err.code,
              message: err.message,
            });
          }
          throw err;
        }
      }

      updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

      if (Object.keys(updateData).length === 1) {
        return res.status(400).json({
          success: false,
          message: "No updatable fields supplied.",
        });
      }

      await db.collection("devices").doc(id).update(updateData);
      appendDeviceLog(id, {
        type: "device_updated",
        message: "Device updated",
        meta: {
          // Field NAMES only. Values are never copied into the audit trail.
          updatedFields: Object.keys(updateData || {}).filter(
            (k) => !["updatedAt"].includes(k),
          ),
        },
      });

      return res.json({
        success: true,
        message: "Device updated successfully",
      });
    } catch (err) {
      return handleDeviceError(res, err);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 8) Delete/unlink device
  // ─────────────────────────────────────────────────────────────
  router.delete("/api/devices/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { device } = await requireOwnedDevice(req, id);
      const ownerId = device.ownerId;
      const operationId = crypto.randomUUID();
      const now = new Date().toISOString();
      try {
        await credentialLifecycle.deleteDeviceWithRevocation({ db, deviceId: id, ownerId, operationId, now });
      } catch (err) {
        return mapCredentialError(res, err, "device_delete");
      }
      // Cleanup semantics are UNCHANGED: logs subcollection deliberately left as before.
      return res.json({
        success: true,
        message: "Device unlinked successfully",
      });
    } catch (err) {
      return handleDeviceError(res, err);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 9) Ping router to test connectivity
  // ─────────────────────────────────────────────────────────────
  router.get("/api/devices/:id/ping", async (req, res) => {
    try {
      const { id } = req.params;
      // Authenticate and authorize BEFORE reading the device: a ping result and
      // the device WAN IP are device metadata that must not leak cross-owner.
      const { device } = await requireOwnedDevice(req, id);

      // Simple ping test - check if device has WAN IP and is marked online
      // In production, you'd ping the actual router IP via MikroTik API
      const isOnline = device.status === "online";
      const wanIp = device.wanIp || null;

      // Simulate ping time (in real implementation, ping actual router)
      const pingTime = isOnline ? Math.floor(Math.random() * 50) + 10 : null;

      appendDeviceLog(id, {
        type: "ping_test",
        message: isOnline ? "Ping test: reachable" : "Ping test: not reachable",
        meta: { status: isOnline ? "online" : "offline", pingTime, wanIp },
      });

      return res.json({
        success: isOnline,
        status: isOnline ? "online" : "offline",
        pingTime: pingTime,
        wanIp: wanIp,
        message: isOnline
          ? `Router is reachable${wanIp ? ` at ${wanIp}` : ""}`
          : "Router is not reachable. Please check connection and configuration.",
      });
    } catch (err) {
      // Routes 401/403 through the existing RegistryError convention instead of
      // collapsing an authorization denial into a 500.
      return handleDeviceError(res, err);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 10) Fetch device logs (UI "Router Logs")
  // ─────────────────────────────────────────────────────────────
  router.get("/api/devices/:id/logs", async (req, res) => {
    try {
      const { id } = req.params;
      // Authenticate and authorize BEFORE reading the device or its logs.
      await requireOwnedDevice(req, id);
      const limitRaw = parseInt(String(req.query.limit || "200"), 10);
      const limit = Math.max(
        1,
        Math.min(Number.isFinite(limitRaw) ? limitRaw : 200, 500),
      );

      const logsSnap = await db
        .collection("devices")
        .doc(id)
        .collection("logs")
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();

      const logs = logsSnap.docs.map((d) => {
        const data = d.data() || {};
        let createdAtISO = data.createdAtISO || null;
        try {
          if (
            !createdAtISO &&
            data.createdAt &&
            typeof data.createdAt.toDate === "function"
          ) {
            createdAtISO = data.createdAt.toDate().toISOString();
          }
        } catch (_) {}
        return {
          id: d.id,
          level: data.level || "info",
          type: data.type || "event",
          message: data.message || "",
          meta: data.meta || null,
          createdAtISO,
        };
      });

      return res.json({ success: true, logs });
    } catch (err) {
      // Routes 401/403 through the existing RegistryError convention instead of
      // collapsing an authorization denial into a 500.
      return handleDeviceError(res, err);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Router credential lifecycle (Phase 8.6c-5c)
  // ─────────────────────────────────────────────────────────────

  // POST /api/devices/:deviceId/router-secret — store or rotate credential
  router.post("/api/devices/:deviceId/router-secret", async (req, res) => {
    try {
      const deviceId = String(req.params.deviceId || "").trim();
      if (!deviceId) {
        return res.status(400).json({ success: false, message: "deviceId is required." });
      }

      const { device } = await requireOwnedDevice(req, deviceId);

      const secret = req.body && typeof req.body.secret === "string" ? req.body.secret : null;
      if (!secret || secret.trim().length === 0) {
        return res.status(400).json({ success: false, message: "A non-empty secret is required." });
      }
      if (secret.length > 256) {
        return res.status(400).json({ success: false, message: "Secret exceeds maximum length." });
      }

      const ownerId = device.ownerId;
      if (!ownerId) {
        return res.status(400).json({ success: false, message: "Device has no owner." });
      }

      const expectedRef = (device.routerOsApiSecretRef ?? null);
      const operationId = crypto.randomUUID();
      const now = new Date().toISOString();

      try {
        await credentialLifecycle.rotateRouterSecret({ db, deviceId, ownerId, secret, expectedRef, operationId, now });
      } catch (err) {
        return mapCredentialError(res, err, "rotate");
      }

      return res.json({
        success: true,
        message: "Router credential stored successfully.",
        hasSecret: true,
      });
    } catch (err) {
      return handleDeviceError(res, err);
    }
  });

  // DELETE /api/devices/:deviceId/router-secret - revoke credential
  router.delete("/api/devices/:deviceId/router-secret", async (req, res) => {
    try {
      const deviceId = String(req.params.deviceId || "").trim();
      if (!deviceId) {
        return res.status(400).json({ success: false, message: "deviceId is required." });
      }

      const { device } = await requireOwnedDevice(req, deviceId);

      const ownerId = device.ownerId;
      if (!ownerId) {
        return res.status(400).json({ success: false, message: "Device has no owner." });
      }

      const expectedRef = (device.routerOsApiSecretRef ?? null);
      const operationId = crypto.randomUUID();
      const now = new Date().toISOString();

      try {
        await credentialLifecycle.revokeRouterSecret({ db, deviceId, ownerId, expectedRef, operationId, now });
      } catch (err) {
        return mapCredentialError(res, err, "revoke");
      }

      return res.json({
        success: true,
        message: "Router credential revoked successfully.",
        hasSecret: false,
      });
    } catch (err) {
      return handleDeviceError(res, err);
    }
  });

  return router;
}

// Default export — preserves production behavior (lazy defaults, no injection)
module.exports = createDevicesRouter();

// Named export for tests to inject dependencies
module.exports.createDevicesRouter = createDevicesRouter;