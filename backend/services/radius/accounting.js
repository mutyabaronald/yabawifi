const {
  RADIUS_ACCT_STATUS_TYPE_START,
  RADIUS_ACCT_STATUS_TYPE_STOP,
  RADIUS_ACCT_STATUS_TYPE_INTERIM_UPDATE,
  RADIUS_ACCT_STATUS_TYPE_ABORT,
  RADIUS_ACCT_TERMINATE_CAUSE_VALUES,
  isAccountingStatusType,
} = require("./constants");

const {
  findAttributeValue,
  getAllAttributeValues,
} = require("./attributes");

const RADIUS_ACCOUNTING_FIELDS = Object.freeze([
  "Acct-Status-Type",
  "Acct-Session-Id",
  "Acct-Session-Time",
  "Acct-Input-Octets",
  "Acct-Output-Octets",
  "Acct-Input-Packets",
  "Acct-Output-Packets",
  "Acct-Terminate-Cause",
  "Acct-Delay-Time",
  "Acct-Input-Gigawords",
  "Acct-Output-Gigawords",
  "User-Name",
  "NAS-Identifier",
  "NAS-IP-Address",
  "Called-Station-Id",
  "Calling-Station-Id",
  "Class",
  "Framed-IP-Address",
  "Session-Timeout",
  "Idle-Timeout",
]);

const ACCT_EVENT_START = "start";
const ACCT_EVENT_STOP = "stop";
const ACCT_EVENT_INTERIM = "interim";
const ACCT_EVENT_ABORT = "abort";

function normalizeAcctStatusType(rawValue) {
  if (typeof rawValue === "string") {
    const lower = rawValue.toLowerCase();
    if (lower === "start" || rawValue === String(RADIUS_ACCT_STATUS_TYPE_START)) {
      return RADIUS_ACCT_STATUS_TYPE_START;
    }
    if (lower === "stop" || rawValue === String(RADIUS_ACCT_STATUS_TYPE_STOP)) {
      return RADIUS_ACCT_STATUS_TYPE_STOP;
    }
    if (lower === "interim" || rawValue === String(RADIUS_ACCT_STATUS_TYPE_INTERIM_UPDATE)) {
      return RADIUS_ACCT_STATUS_TYPE_INTERIM_UPDATE;
    }
    if (lower === "abort" || rawValue === String(RADIUS_ACCT_STATUS_TYPE_ABORT)) {
      return RADIUS_ACCT_STATUS_TYPE_ABORT;
    }
  }

  if (typeof rawValue === "number") {
    if (!isAccountingStatusType(rawValue)) {
      return null;
    }
    return rawValue;
  }

  if (typeof rawValue === "string") {
    const num = parseInt(rawValue, 10);
    if (!Number.isNaN(num) && isAccountingStatusType(num)) {
      return num;
    }
  }

  return null;
}

function statusTypeToEvent(statusType) {
  switch (statusType) {
    case RADIUS_ACCT_STATUS_TYPE_START:
      return ACCT_EVENT_START;
    case RADIUS_ACCT_STATUS_TYPE_STOP:
      return ACCT_EVENT_STOP;
    case RADIUS_ACCT_STATUS_TYPE_INTERIM_UPDATE:
      return ACCT_EVENT_INTERIM;
    case RADIUS_ACCT_STATUS_TYPE_ABORT:
      return ACCT_EVENT_ABORT;
    default:
      return null;
  }
}

function safeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return 0;
  }
  if (Number.isInteger(num)) {
    return num;
  }
  return Math.floor(num);
}

function safeString(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

function decodeTerminateCause(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return null;
  }

  const num = Number(rawValue);
  if (Number.isInteger(num) && RADIUS_ACCT_TERMINATE_CAUSE_VALUES[num]) {
    return {
      code: num,
      text: RADIUS_ACCT_TERMINATE_CAUSE_VALUES[num],
    };
  }

  return {
    code: num,
    text: typeof rawValue === "string" ? rawValue : String(rawValue),
  };
}

function bytesToMegabytes(bytes) {
  return safeNumber(bytes) / (1024 * 1024);
}

function bytesToGigabytes(bytes) {
  return safeNumber(bytes) / (1024 * 1024 * 1024);
}

function secondsToMinutes(seconds) {
  const secs = safeNumber(seconds);
  return Math.floor(secs / 60);
}

function secondsToHours(seconds) {
  const secs = safeNumber(seconds);
  return secs / 3600;
}

function extractClassMetadata(classValue) {
  if (classValue === null || classValue === undefined) {
    return null;
  }

  if (Buffer.isBuffer(classValue)) {
    classValue = classValue.toString("utf8");
  }

  if (typeof classValue !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(classValue);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed;
    }
  } catch (_) {
    // Not JSON; try "key:value,key2:value2" format
  }

  const parts = classValue.split(",");
  const result = {};
  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx > 0) {
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      if (key) {
        result[key] = isNaN(Number(val)) ? val : Number(val);
      }
    }
  }

  return Object.keys(result).length > 0 ? result : { raw: classValue };
}

function normalizeClassFromAttributes(attributes) {
  const classValues = getAllAttributeValues(attributes, 25);

  if (!classValues || classValues.length === 0) {
    return null;
  }

  const result = {};

  for (const classValue of classValues) {
    const metadata = extractClassMetadata(classValue);
    if (metadata && typeof metadata === "object") {
      Object.assign(result, metadata);
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

function normalizeAccountingPacket(packet) {
  if (!packet || !packet.attributes) {
    throw new Error("Packet with attributes is required for accounting normalization");
  }

  const attrs = packet.attributes;

  const rawStatusType = findAttributeValue(attrs, 40, null);
  const statusType = normalizeAcctStatusType(rawStatusType);

  if (statusType === null) {
    return {
      valid: false,
      error: "MISSING_OR_INVALID_ACCT_STATUS_TYPE",
      message: "Acct-Status-Type attribute is required and must be valid",
    };
  }

  const event = statusTypeToEvent(statusType);
  if (!event) {
    return {
      valid: false,
      error: "UNSUPPORTED_ACCT_STATUS_TYPE",
      message: `Unsupported accounting status type: ${statusType}`,
    };
  }

  const acctSessionId = findAttributeValue(attrs, 44, null);
  const userName = findAttributeValue(attrs, 1, null);
  const nasIdentifier = findAttributeValue(attrs, 32, null);
  const nasIpAddress = findAttributeValue(attrs, 3, null);
  const calledStationId = findAttributeValue(attrs, 30, null);
  const callingStationId = findAttributeValue(attrs, 31, null);
  const framedIpAddress = findAttributeValue(attrs, 8, null);

  const acctSessionTime = findAttributeValue(attrs, 46, 0);
  const acctInputOctets = findAttributeValue(attrs, 42, 0);
  const acctOutputOctets = findAttributeValue(attrs, 43, 0);
  const acctInputPackets = findAttributeValue(attrs, 47, 0);
  const acctOutputPackets = findAttributeValue(attrs, 48, 0);
  const acctTerminateCause = findAttributeValue(attrs, 49, null);
  const acctDelayTime = findAttributeValue(attrs, 41, 0);
  const acctInputGigawords = findAttributeValue(attrs, 50, 0);
  const acctOutputGigawords = findAttributeValue(attrs, 51, 0);

  const classMetadata = normalizeClassFromAttributes(attrs);

  const inputOctets = safeNumber(acctInputOctets);
  const outputOctets = safeNumber(acctOutputOctets);
  const inputGigawords = safeNumber(acctInputGigawords);
  const outputGigawords = safeNumber(acctOutputGigawords);

  const totalBytes =
    inputOctets +
    outputOctets +
    inputGigawords * 4294967296 +
    outputGigawords * 4294967296;

  const sessionTimeSeconds = safeNumber(acctSessionTime);

  const sessionId = acctSessionId || classMetadata?.sessionId || classMetadata?.jti || null;

  const result = {
    valid: true,
    event,
    statusType,
    sessionId,
    acctSessionId: safeString(acctSessionId),
    userName: safeString(userName),
    nasIdentifier: safeString(nasIdentifier),
    nasIpAddress: safeString(nasIpAddress),
    calledStationId: safeString(calledStationId),
    callingStationId: safeString(callingStationId),
    framedIpAddress: safeString(framedIpAddress),
    classMetadata,
    usage: {
      inputOctets,
      outputOctets,
      inputPackets: safeNumber(acctInputPackets),
      outputPackets: safeNumber(acctOutputPackets),
      totalBytes,
      totalMegabytes: Math.round(bytesToMegabytes(totalBytes) * 100) / 100,
      totalGigabytes: Math.round(bytesToGigabytes(totalBytes) * 1000) / 1000,
    },
    session: {
      sessionTimeSeconds,
      sessionMinutes: secondsToMinutes(acctSessionTime),
      sessionHours: Math.round(secondsToHours(acctSessionTime) * 100) / 100,
    },
    timing: {
      delayTimeSeconds: safeNumber(acctDelayTime),
    },
    terminateCause:
      acctTerminateCause !== null ? decodeTerminateCause(acctTerminateCause) : null,
  };

  if (event === "stop" && !sessionId) {
    result.valid = false;
    result.error = "STOP_REQUIRES_SESSION_ID";
    result.message = "Accounting-Stop requires Acct-Session-Id or session identifier in Class";
  }

  if (event === "start" && !userName) {
    result.valid = false;
    result.error = "START_REQUIRES_USERNAME";
    result.message = "Accounting-Start requires User-Name";
  }

  return result;
}

function normalizeUsageForSession(normalizedAccounting) {
  if (!normalizedAccounting || !normalizedAccounting.valid) {
    throw new Error("Invalid accounting data; cannot normalize usage");
  }

  return {
    usedMinutes: normalizedAccounting.session.sessionMinutes,
    usedMegabytes: normalizedAccounting.usage.totalMegabytes,
  };
}

function mapAccountingToSessionUpdate(normalizedAccounting, existingSession) {
  if (!normalizedAccounting || !normalizedAccounting.valid) {
    throw new Error("Invalid accounting data; cannot map to session update");
  }

  const update = {
    lastActivityAt: new Date().toISOString(),
  };

  if (normalizedAccounting.usage.inputOctets > 0 || normalizedAccounting.usage.outputOctets > 0) {
    const existingMb = (existingSession?.usedMegabytes || 0);
    update.usedMegabytes = existingMb + normalizedAccounting.usage.totalMegabytes;
  }

  if (normalizedAccounting.session.sessionTimeSeconds > 0) {
    const existingMin = (existingSession?.usedMinutes || 0);
    update.usedMinutes = existingMin + normalizedAccounting.session.sessionMinutes;
  }

  if (normalizedAccounting.sessionId) {
    update.acctSessionId = normalizedAccounting.acctSessionId;
  }

  return update;
}

function isAccountingStart(normalizedAccounting) {
  return normalizedAccounting && normalizedAccounting.valid && normalizedAccounting.event === ACCT_EVENT_START;
}

function isAccountingStop(normalizedAccounting) {
  return normalizedAccounting && normalizedAccounting.valid && normalizedAccounting.event === ACCT_EVENT_STOP;
}

function isAccountingInterim(normalizedAccounting) {
  return normalizedAccounting && normalizedAccounting.valid && normalizedAccounting.event === ACCT_EVENT_INTERIM;
}

function isAccountingAbort(normalizedAccounting) {
  return normalizedAccounting && normalizedAccounting.valid && normalizedAccounting.event === ACCT_EVENT_ABORT;
}

function shouldTriggerRauBilling(normalizedAccounting) {
  return isAccountingInterim(normalizedAccounting) || isAccountingStop(normalizedAccounting);
}

function extractEntitlementId(classMetadata) {
  if (!classMetadata) return null;
  return (
    classMetadata.entitlementId ||
    classMetadata.entitlement ||
    classMetadata.sessionId ||
    null
  );
}

function extractSessionSequence(classMetadata) {
  if (!classMetadata) return null;
  return classMetadata.sessionSeq || classMetadata.seq || null;
}

function extractHomeOwnerId(classMetadata) {
  if (!classMetadata) return null;
  return classMetadata.homeOwnerId || classMetadata.home || null;
}

function extractVisitedOwnerId(classMetadata) {
  if (!classMetadata) return null;
  return classMetadata.visitedOwnerId || classMetadata.visited || null;
}

function extractQuotaInfo(classMetadata) {
  if (!classMetadata) return null;
  return {
    remainingMinutes: classMetadata.remainingMinutes || null,
    maxMinutes: classMetadata.maxMinutes || null,
  };
}

module.exports = {
  RADIUS_ACCOUNTING_FIELDS,
  ACCT_EVENT_START,
  ACCT_EVENT_INTERIM,
  ACCT_EVENT_STOP,
  ACCT_EVENT_ABORT,
  normalizeAcctStatusType,
  statusTypeToEvent,
  safeNumber,
  safeString,
  decodeTerminateCause,
  bytesToMegabytes,
  bytesToGigabytes,
  secondsToMinutes,
  secondsToHours,
  extractClassMetadata,
  normalizeClassFromAttributes,
  normalizeAccountingPacket,
  normalizeUsageForSession,
  mapAccountingToSessionUpdate,
  isAccountingStart,
  isAccountingStop,
  isAccountingInterim,
  isAccountingAbort,
  shouldTriggerRauBilling,
  extractEntitlementId,
  extractSessionSequence,
  extractHomeOwnerId,
  extractVisitedOwnerId,
  extractQuotaInfo,
};
