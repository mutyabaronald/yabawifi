const dgram = require("dgram");
const dns = require("dns");

const {
  decodePacket,
  validateResponseAuthenticator,
  RADIUS_PACKET_HEADER_SIZE,
  RADIUS_ATTRIBUTE_USER_PASSWORD,
} = require("../radius");

const { radiusError, RADIUS_ERROR_CODES, REDACTED } = require("./errors");

const RADIUS_SOCKET_FAMILY = "udp4";
const RADIUS_SOCKET_BIND_ADDRESS = "0.0.0.0";
const LOOPBACK_ALIASES = Object.freeze({ localhost: "127.0.0.1" });

let openSocketCount = 0;

function getOpenSocketCount() {
  return openSocketCount;
}

function defaultSocketFactory() {
  return dgram.createSocket({ type: RADIUS_SOCKET_FAMILY });
}

function isIpv4Literal(value) {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function resolveIPv4(host) {
  if (isIpv4Literal(host)) return Promise.resolve(host);
  if (Object.prototype.hasOwnProperty.call(LOOPBACK_ALIASES, host)) {
    return Promise.resolve(LOOPBACK_ALIASES[host]);
  }
  return new Promise((resolve, reject) => {
    dns.lookup(host, { family: 4 }, (err, address) => {
      if (err) {
        reject(
          radiusError(RADIUS_ERROR_CODES.RADIUS_NETWORK_ERROR, "RADIUS host could not be resolved", {
            host,
            dnsCode: err.code || null,
          }),
        );
        return;
      }
      resolve(address);
    });
  });
}

function isExpectedSource(rinfo, expectedAddress, expectedPort) {
  if (!rinfo) return false;
  if (typeof rinfo.port === "number" && rinfo.port !== expectedPort) return false;
  if (expectedAddress && rinfo.address !== expectedAddress) return false;
  return true;
}

function sanitizeAttributes(attributes) {
  const safe = {};
  for (const attr of attributes) {
    const name = attr.name || `Attr-${attr.type}`;
    const value =
      attr.type === RADIUS_ATTRIBUTE_USER_PASSWORD
        ? REDACTED
        : Buffer.isBuffer(attr.decoded)
          ? `[Buffer:${attr.decoded.length}]`
          : attr.decoded;
    if (safe[name] === undefined) safe[name] = value;
  }
  return safe;
}

function collectVendorSpecific(attributes) {
  return attributes.filter((a) => a.type === 26).map((a) => a.decoded);
}

function validateExchangeArguments(args) {
  if (!Buffer.isBuffer(args.packet)) {
    throw radiusError(RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID, "packet must be a Buffer");
  }
  if (!Number.isInteger(args.identifier) || args.identifier < 0 || args.identifier > 255) {
    throw radiusError(RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID, "identifier must be 0-255");
  }
  if (!Buffer.isBuffer(args.requestAuthenticator) || args.requestAuthenticator.length !== 16) {
    throw radiusError(
      RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID,
      "requestAuthenticator must be a 16-byte Buffer",
    );
  }
  if (typeof args.destinationHost !== "string" || args.destinationHost.length === 0) {
    throw radiusError(RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID, "destinationHost is required");
  }
  if (!Number.isInteger(args.destinationPort) || args.destinationPort < 1 || args.destinationPort > 65535) {
    throw radiusError(RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID, "destinationPort must be 1-65535");
  }
  if (!Array.isArray(args.expectedCodes) || args.expectedCodes.length === 0) {
    throw radiusError(RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID, "expectedCodes is required");
  }
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1) {
    throw radiusError(RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID, "timeoutMs must be a positive integer");
  }
  if (!Number.isInteger(args.retries) || args.retries < 0) {
    throw radiusError(RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID, "retries must be >= 0");
  }
  if (typeof args.secret !== "string" || args.secret.length === 0) {
    throw radiusError(
      RADIUS_ERROR_CODES.RADIUS_SECRET_UNAVAILABLE,
      "RADIUS shared secret is unavailable",
      { reason: "transport_requires_secret" },
    );
  }
}

async function exchangeRADIUSPacket(args) {
  validateExchangeArguments(args);

  const {
    packet,
    identifier,
    requestAuthenticator,
    destinationPort,
    expectedCodes,
    timeoutMs,
    secret,
    socketFactory = defaultSocketFactory,
  } = args;

  const destinationAddress = await resolveIPv4(args.destinationHost);

  return new Promise((resolve, reject) => {
    const stats = {
      attempts: 0,
      datagramsReceived: 0,
      accepted: 0,
      discarded: 0,
      discardedSourceMismatch: 0,
      discardedIdentifierMismatch: 0,
    };

    let socket = null;
    let socketCounted = false;
    let timer = null;
    let settled = false;
    let lastFailure = null;
    const startedAt = Date.now();
    const maxAttempts = args.retries + 1;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (socket) {
        const active = socket;
        socket = null;
        try {
          active.removeAllListeners();
        } catch (err) {
          void err;
        }
        try {
          if (typeof active.close === "function" && active._closed !== true) {
            active.close();
          }
        } catch (err) {
          void err;
        }
        if (socketCounted) {
          socketCounted = false;
          if (openSocketCount > 0) openSocketCount -= 1;
        }
      }
    };

    const settle = (err, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve(value);
    };

    const armTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onTimeout, timeoutMs);
    };

    const failWithNetworkError = (err) => {
      lastFailure = { kind: "network", code: err && err.code ? err.code : null };
      if (stats.attempts < maxAttempts) {
        transmit();
        armTimer();
        return;
      }
      settle(
        radiusError(RADIUS_ERROR_CODES.RADIUS_NETWORK_ERROR, "RADIUS transport network error", {
          attempts: stats.attempts,
          systemCode: lastFailure.code,
        }),
      );
    };

    function transmit() {
      if (settled || !socket) return;
      if (stats.attempts >= maxAttempts) return;
      stats.attempts += 1;
      try {
        socket.send(packet, destinationPort, destinationAddress, (err) => {
          if (err && !settled) failWithNetworkError(err);
        });
      } catch (err) {
        failWithNetworkError(err);
      }
    }

    function onTimeout() {
      timer = null;
      if (settled) return;
      lastFailure = { kind: "timeout" };
      if (stats.attempts < maxAttempts) {
        transmit();
        armTimer();
        return;
      }
      settle(
        radiusError(
          RADIUS_ERROR_CODES.RADIUS_RETRY_EXHAUSTED,
          "RADIUS request timed out after all attempts",
          {
            attempts: stats.attempts,
            timeoutMs,
            lastFailure: lastFailure.kind,
            discarded: stats.discarded,
          },
        ),
      );
    }

    function onMessage(msg, rinfo) {
      if (settled) return;
      stats.datagramsReceived += 1;

      if (!isExpectedSource(rinfo, destinationAddress, destinationPort)) {
        stats.discarded += 1;
        stats.discardedSourceMismatch += 1;
        return;
      }

      let decoded;
      try {
        decoded = decodePacket(msg);
      } catch (err) {
        stats.discarded += 1;
        settle(
          radiusError(RADIUS_ERROR_CODES.RADIUS_PACKET_DECODE_FAILED, "RADIUS response could not be decoded", {
            receivedBytes: msg.length,
            cause: err && err.code ? err.code : null,
          }),
        );
        return;
      }

      if (decoded.identifier !== identifier) {
        stats.discarded += 1;
        stats.discardedIdentifierMismatch += 1;
        return;
      }

      if (!expectedCodes.includes(decoded.code)) {
        settle(
          radiusError(RADIUS_ERROR_CODES.RADIUS_UNEXPECTED_PACKET, "Unexpected RADIUS packet code", {
            expected: expectedCodes,
            received: decoded.code,
            receivedName: decoded.codeName,
          }),
        );
        return;
      }

      const declaredLength = msg.readUInt16BE(2);
      const attributeBytes = msg.slice(RADIUS_PACKET_HEADER_SIZE, declaredLength);

      let authenticatorResult;
      try {
        authenticatorResult = validateResponseAuthenticator(
          decoded.code,
          decoded.identifier,
          declaredLength,
          requestAuthenticator,
          decoded.authenticator,
          attributeBytes,
          secret,
        );
      } catch (err) {
        settle(
          radiusError(RADIUS_ERROR_CODES.RADIUS_AUTHENTICATOR_INVALID, "RADIUS response authenticator could not be validated", {
            cause: err && err.code ? err.code : null,
          }),
        );
        return;
      }

      if (!authenticatorResult || authenticatorResult.valid !== true) {
        settle(
          radiusError(RADIUS_ERROR_CODES.RADIUS_AUTHENTICATOR_INVALID, "RADIUS response authenticator is invalid", {
            code: decoded.code,
            identifier: decoded.identifier,
          }),
        );
        return;
      }

      stats.accepted += 1;
      settle(null, {
        code: decoded.code,
        codeName: decoded.codeName,
        identifier: decoded.identifier,
        attributes: sanitizeAttributes(decoded.attributes),
        vendorSpecific: collectVendorSpecific(decoded.attributes),
        attempts: stats.attempts,
        rttMs: Date.now() - startedAt,
        stats: Object.assign({}, stats),
      });
    }

    try {
      socket = socketFactory();
      socketCounted = true;
      openSocketCount += 1;
    } catch (err) {
      settle(
        radiusError(RADIUS_ERROR_CODES.RADIUS_NETWORK_ERROR, "RADIUS socket could not be created", {
          systemCode: err && err.code ? err.code : null,
        }),
      );
      return;
    }

    socket.on("message", onMessage);
    socket.on("error", (err) => {
      if (settled) return;
      failWithNetworkError(err);
    });

    try {
      socket.bind(0, RADIUS_SOCKET_BIND_ADDRESS, () => {
        if (settled) return;
        transmit();
        armTimer();
      });
    } catch (err) {
      failWithNetworkError(err);
    }
  });
}

module.exports = {
  RADIUS_SOCKET_FAMILY,
  RADIUS_SOCKET_BIND_ADDRESS,
  getOpenSocketCount,
  defaultSocketFactory,
  resolveIPv4,
  isExpectedSource,
  sanitizeAttributes,
  exchangeRADIUSPacket,
};