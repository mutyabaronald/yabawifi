const RADIUS_CODE_ACCESS_REQUEST = 1;
const RADIUS_CODE_ACCESS_ACCEPT = 2;
const RADIUS_CODE_ACCESS_REJECT = 3;
const RADIUS_CODE_ACCESS_CHALLENGE = 11;
const RADIUS_CODE_STATUS_SERVER = 14;
const RADIUS_CODE_ACCESS_DISCARD = 0;

const RADIUS_CODE_ACCOUNTING_REQUEST = 4;
const RADIUS_CODE_ACCOUNTING_RESPONSE = 5;

const RADIUS_CODE_DISCONNECT_REQUEST = 40;
const RADIUS_CODE_DISCONNECT_ACK = 41;
const RADIUS_CODE_DISCONNECT_NAK = 42;
const RADIUS_CODE_COA_REQUEST = 43;
const RADIUS_CODE_COA_ACK = 44;
const RADIUS_CODE_COA_NAK = 45;

const RADIUS_CODE_ACCESS_DENIED = 6;

const RADIUS_PACKET_HEADER_SIZE = 20;
const RADIUS_PACKET_HEADER_FORMAT = ">BBHBB";
const RADIUS_PACKET_HEADER_LENGTH = 20;

const RADIUS_AUTHENTICATOR_SIZE = 16;

const RADIUS_ATTRIBUTE_HEADER_SIZE = 2;

const RADIUS_PACKET_MAX_SIZE = 4096;

const RADIUS_CODE_NAMES = Object.freeze({
  [RADIUS_CODE_ACCESS_REQUEST]: "Access-Request",
  [RADIUS_CODE_ACCESS_ACCEPT]: "Access-Accept",
  [RADIUS_CODE_ACCESS_REJECT]: "Access-Reject",
  [RADIUS_CODE_ACCESS_CHALLENGE]: "Access-Challenge",
  [RADIUS_CODE_STATUS_SERVER]: "Status-Server",
  [RADIUS_CODE_ACCESS_DISCARD]: "Access-Discard",
  [RADIUS_CODE_ACCOUNTING_REQUEST]: "Accounting-Request",
  [RADIUS_CODE_ACCOUNTING_RESPONSE]: "Accounting-Response",
  [RADIUS_CODE_DISCONNECT_REQUEST]: "Disconnect-Request",
  [RADIUS_CODE_DISCONNECT_ACK]: "Disconnect-Ack",
  [RADIUS_CODE_DISCONNECT_NAK]: "Disconnect-Nak",
  [RADIUS_CODE_COA_REQUEST]: "CoA-Request",
  [RADIUS_CODE_COA_ACK]: "CoA-Ack",
  [RADIUS_CODE_COA_NAK]: "CoA-Nak",
  [RADIUS_CODE_ACCESS_DENIED]: "Access-Denied",
});

const RADIUS_ATTRIBUTE_USER_NAME = 1;
const RADIUS_ATTRIBUTE_USER_PASSWORD = 2;
const RADIUS_ATTRIBUTE_NAS_IDENTIFIER = 32;
const RADIUS_ATTRIBUTE_NAS_IP_ADDRESS = 3;
const RADIUS_ATTRIBUTE_NAS_PORT = 5;
const RADIUS_ATTRIBUTE_FILTER_ID = 11;
const RADIUS_ATTRIBUTE_FRAMED_IP_ADDRESS = 8;
const RADIUS_ATTRIBUTE_FRAMED_POOL = 28;
const RADIUS_ATTRIBUTE_CALLED_STATION_ID = 30;
const RADIUS_ATTRIBUTE_CALLING_STATION_ID = 31;
const RADIUS_ATTRIBUTE_NAS_PORT_TYPE = 61;
const RADIUS_ATTRIBUTE_CLASS = 25;
const RADIUS_ATTRIBUTE_SESSION_TIMEOUT = 27;
const RADIUS_ATTRIBUTE_IDLE_TIMEOUT = 28;
const RADIUS_ATTRIBUTE_STATE = 24;
const RADIUS_ATTRIBUTE_VENDOR_SPECIFIC = 26;
const RADIUS_ATTRIBUTE_REPLY_MESSAGE = 18;
const RADIUS_ATTRIBUTE_ACCT_STATUS_TYPE = 40;
const RADIUS_ATTRIBUTE_ACCT_SESSION_ID = 44;
const RADIUS_ATTRIBUTE_ACCT_INPUT_OCTETS = 42;
const RADIUS_ATTRIBUTE_ACCT_OUTPUT_OCTETS = 43;
const RADIUS_ATTRIBUTE_ACCT_SESSION_TIME = 46;
const RADIUS_ATTRIBUTE_ACCT_INPUT_PACKETS = 47;
const RADIUS_ATTRIBUTE_ACCT_OUTPUT_PACKETS = 48;
const RADIUS_ATTRIBUTE_ACCT_TERMINATE_CAUSE = 49;
const RADIUS_ATTRIBUTE_ACCT_INPUT_GIGAWORDS = 50;
const RADIUS_ATTRIBUTE_ACCT_OUTPUT_GIGAWORDS = 51;
const RADIUS_ATTRIBUTE_ACCT_DELAY_TIME = 41;

const RADIUS_ACCT_STATUS_TYPE_START = 1;
const RADIUS_ACCT_STATUS_TYPE_STOP = 2;
const RADIUS_ACCT_STATUS_TYPE_INTERIM_UPDATE = 3;
const RADIUS_ACCT_STATUS_TYPE_ABORT = 4;

const RADIUS_ACCT_TERMINATE_CAUSE_VALUES = Object.freeze({
  0: "Lost-Carrier",
  1: "Lost-Service",
  2: "_IDLE_Timeout",
  3: "Auth-Failure: user busy",
  4: "Port-error",
  5: "Port-Released",
  6: "Session-Timeout",
  7: "Reauthentication: admin reset (via CoA)",
  8: "Reauthentication: session timeout",
  9: "Port-reconfigured (e.g. VLANChange) by Remote Host",
  10: "EAP Success",
  12: "EAP Failed",
  13: "RADIUS Administration ( Disconnect-Message)",
  14: "RADIUS Administration (Session-Timeout)",
  15: "Callback Disconnect",
});

const RADIUS_ATTRIBUTE_TYPES = Object.freeze({
  1: { name: "User-Name", type: "string" },
  2: { name: "User-Password", type: "encrypted" },
  3: { name: "NAS-IP-Address", type: "ip" },
  4: { name: "NAS-Port", type: "integer" },
  5: { name: "Service-Type", type: "integer" },
  6: { name: "Framed-Protocol", type: "integer" },
  7: { name: "Framed-IP-Protocol", type: "integer" },
  8: { name: "Framed-IP-Address", type: "ip" },
  9: { name: "Framed-IP-Netmask", type: "ip" },
  10: { name: "Framed-Routing", type: "integer" },
  11: { name: "Filter-Id", type: "string" },
  12: { name: "Framed-MTU", type: "integer" },
  13: { name: "Framed-Compression", type: "integer" },
  14: { name: "Login-IP-Host", type: "ip" },
  15: { name: "Login-Service", type: "integer" },
  16: { name: "Login-TCP-Port", type: "integer" },
  17: { name: "(unassigned)", type: "string" },
  18: { name: "Reply-Message", type: "string" },
  19: { name: "Callback-Number", type: "string" },
  20: { name: "Callback-Id", type: "string" },
  21: { name: "(unassigned)", type: "string" },
  22: { name: "Framed-Route", type: "string" },
  23: { name: "Framed-IPX-Network", type: "ip" },
  24: { name: "State", type: "opaque" },
  25: { name: "Class", type: "opaque" },
  26: { name: "Vendor-Specific", type: "vsa" },
  27: { name: "Session-Timeout", type: "integer" },
  28: { name: "Idle-Timeout", type: "integer" },
  29: { name: "Framed-Pool", type: "string" },
  30: { name: "Called-Station-Id", type: "string" },
  31: { name: "Calling-Station-Id", type: "string" },
  32: { name: "NAS-Identifier", type: "string" },
  33: { name: "Port-Limit", type: "integer" },
  34: { name: "Login-LAT-Port", type: "string" },
  40: { name: "Acct-Status-Type", type: "integer" },
  41: { name: "Acct-Delay-Time", type: "integer" },
  42: { name: "Acct-Input-Octets", type: "integer" },
  43: { name: "Acct-Output-Octets", type: "integer" },
  44: { name: "Acct-Session-Id", type: "string" },
  45: { name: "Acct-Authentic", type: "integer" },
  46: { name: "Acct-Session-Time", type: "integer" },
  47: { name: "Acct-Input-Packets", type: "integer" },
  48: { name: "Acct-Output-Packets", type: "integer" },
  49: { name: "Acct-Terminate-Cause", type: "integer" },
  50: { name: "Acct-Input-Gigawords", type: "integer" },
  51: { name: "Acct-Output-Gigawords", type: "integer" },
  52: { name: "Acct-Event-Timestamp", type: "integer" },
  55: { name: "Acct-Session-Id", type: "string" },
  56: { name: "Acct-Multi-Session-Id", type: "string" },
  57: { name: "Acct-Link-Count", type: "integer" },
  60: { name: "CHAP-Challenge", type: "opaque" },
  61: { name: "NAS-Port-Type", type: "integer" },
  62: { name: "NAS-Port-Id", type: "string" },
  63: { name: "Tunnel-Type", type: "integer" },
  64: { name: "Tunnel-Medium-Type", type: "integer" },
  65: { name: "Tunnel-Client-Endpoint", type: "string" },
  66: { name: "Tunnel-Server-Edpoint", type: "string" },
  67: { name: "Tunnel-Private-Group-ID", type: "string" },
  80: { name: "Message-Authenticator", type: "opaque" },
  71: { name: "EAP-Message", type: "opaque" },
});

const RADIUS_VENDOR_ID_MICROTIK = 14988;
const RADIUS_VENDOR_ID_CISCO = 9;
const RADIUS_VENDOR_ID_UBIQUITI = 4672;
const RADIUS_VENDOR_ID_TP_LINK = 4832;

const RADIUS_VENDOR_ATTRIBUTES = Object.freeze({
  [RADIUS_VENDOR_ID_MICROTIK]: {
    name: "MikroTik",
    attributes: {
      1: { name: "Recv-Limit", type: "integer" },
      2: { name: "Xmit-Limit", type: "integer" },
      3: { name: "Idle-Limit", type: "integer" },
      4: { name: "Session-Timeout", type: "integer" },
      5: { name: "Port-Limit", type: "integer" },
      6: { name: "Version", type: "string" },
      7: { name: "Protocol", type: "integer" },
    },
  },
  [RADIUS_VENDOR_ID_CISCO]: {
    name: "Cisco",
    attributes: {
      1: { name: "User-Command", type: "string" },
      2: { name: "Privileged-User-Mode-Password", type: "encrypted" },
      3: { name: "ACL-Flag", type: "integer" },
      4: { name: "ACL-IP-Address-Info", type: "string" },
    },
  },
});

const RADIUS_STANDARD_ATTRIBUTES = Object.freeze({
  [RADIUS_ATTRIBUTE_USER_NAME]: "User-Name",
  [RADIUS_ATTRIBUTE_USER_PASSWORD]: "User-Password",
  [RADIUS_ATTRIBUTE_NAS_IDENTIFIER]: "NAS-Identifier",
  [RADIUS_ATTRIBUTE_NAS_IP_ADDRESS]: "NAS-IP-Address",
  [RADIUS_ATTRIBUTE_FILTER_ID]: "Filter-Id",
  [RADIUS_ATTRIBUTE_FRAMED_IP_ADDRESS]: "Framed-IP-Address",
  [RADIUS_ATTRIBUTE_FRAMED_POOL]: "Framed-Pool",
  [RADIUS_ATTRIBUTE_CALLED_STATION_ID]: "Called-Station-Id",
  [RADIUS_ATTRIBUTE_CALLING_STATION_ID]: "Calling-Station-Id",
  [RADIUS_ATTRIBUTE_CLASS]: "Class",
  [RADIUS_ATTRIBUTE_SESSION_TIMEOUT]: "Session-Timeout",
  [RADIUS_ATTRIBUTE_IDLE_TIMEOUT]: "Idle-Timeout",
  [RADIUS_ATTRIBUTE_ACCT_STATUS_TYPE]: "Acct-Status-Type",
  [RADIUS_ATTRIBUTE_ACCT_SESSION_ID]: "Acct-Session-Id",
  [RADIUS_ATTRIBUTE_ACCT_INPUT_OCTETS]: "Acct-Input-Octets",
  [RADIUS_ATTRIBUTE_ACCT_OUTPUT_OCTETS]: "Acct-Output-Octets",
  [RADIUS_ATTRIBUTE_ACCT_SESSION_TIME]: "Acct-Session-Time",
  [RADIUS_ATTRIBUTE_ACCT_INPUT_PACKETS]: "Acct-Input-Packets",
  [RADIUS_ATTRIBUTE_ACCT_OUTPUT_PACKETS]: "Acct-Output-Packets",
  [RADIUS_ATTRIBUTE_ACCT_TERMINATE_CAUSE]: "Acct-Terminate-Cause",
});

function isAccountingStatusType(value) {
  return [
    RADIUS_ACCT_STATUS_TYPE_START,
    RADIUS_ACCT_STATUS_TYPE_STOP,
    RADIUS_ACCT_STATUS_TYPE_INTERIM_UPDATE,
    RADIUS_ACCT_STATUS_TYPE_ABORT,
  ].includes(value);
}

function getAttributeName(typeCode) {
  if (RADIUS_STANDARD_ATTRIBUTES[typeCode]) {
    return RADIUS_STANDARD_ATTRIBUTES[typeCode];
  }
  const def = RADIUS_ATTRIBUTE_TYPES[typeCode];
  return def ? def.name : `Unknown-${typeCode}`;
}

function getCodeName(code) {
  return RADIUS_CODE_NAMES[code] || `Unknown-${code}`;
}

module.exports = {
  RADIUS_CODE_ACCESS_REQUEST,
  RADIUS_CODE_ACCESS_ACCEPT,
  RADIUS_CODE_ACCESS_REJECT,
  RADIUS_CODE_ACCESS_CHALLENGE,
  RADIUS_CODE_STATUS_SERVER,
  RADIUS_CODE_ACCESS_DISCARD,
  RADIUS_CODE_ACCOUNTING_REQUEST,
  RADIUS_CODE_ACCOUNTING_RESPONSE,
  RADIUS_CODE_DISCONNECT_REQUEST,
  RADIUS_CODE_DISCONNECT_ACK,
  RADIUS_CODE_DISCONNECT_NAK,
  RADIUS_CODE_COA_REQUEST,
  RADIUS_CODE_COA_ACK,
  RADIUS_CODE_COA_NAK,
  RADIUS_CODE_ACCESS_DENIED,
  RADIUS_PACKET_HEADER_SIZE,
  RADIUS_PACKET_HEADER_FORMAT,
  RADIUS_PACKET_HEADER_LENGTH,
  RADIUS_AUTHENTICATOR_SIZE,
  RADIUS_ATTRIBUTE_HEADER_SIZE,
  RADIUS_PACKET_MAX_SIZE,
  RADIUS_CODE_NAMES,
  RADIUS_ATTRIBUTE_USER_NAME,
  RADIUS_ATTRIBUTE_USER_PASSWORD,
  RADIUS_ATTRIBUTE_NAS_IDENTIFIER,
  RADIUS_ATTRIBUTE_NAS_IP_ADDRESS,
  RADIUS_ATTRIBUTE_NAS_PORT,
  RADIUS_ATTRIBUTE_FILTER_ID,
  RADIUS_ATTRIBUTE_FRAMED_IP_ADDRESS,
  RADIUS_ATTRIBUTE_FRAMED_POOL,
  RADIUS_ATTRIBUTE_CALLED_STATION_ID,
  RADIUS_ATTRIBUTE_CALLING_STATION_ID,
  RADIUS_ATTRIBUTE_NAS_PORT_TYPE,
  RADIUS_ATTRIBUTE_CLASS,
  RADIUS_ATTRIBUTE_SESSION_TIMEOUT,
  RADIUS_ATTRIBUTE_IDLE_TIMEOUT,
  RADIUS_ATTRIBUTE_STATE,
  RADIUS_ATTRIBUTE_VENDOR_SPECIFIC,
  RADIUS_ATTRIBUTE_REPLY_MESSAGE,
  RADIUS_ATTRIBUTE_ACCT_STATUS_TYPE,
  RADIUS_ATTRIBUTE_ACCT_SESSION_ID,
  RADIUS_ATTRIBUTE_ACCT_INPUT_OCTETS,
  RADIUS_ATTRIBUTE_ACCT_OUTPUT_OCTETS,
  RADIUS_ATTRIBUTE_ACCT_SESSION_TIME,
  RADIUS_ATTRIBUTE_ACCT_INPUT_PACKETS,
  RADIUS_ATTRIBUTE_ACCT_OUTPUT_PACKETS,
  RADIUS_ATTRIBUTE_ACCT_TERMINATE_CAUSE,
  RADIUS_ACCT_STATUS_TYPE_START,
  RADIUS_ACCT_STATUS_TYPE_STOP,
  RADIUS_ACCT_STATUS_TYPE_INTERIM_UPDATE,
  RADIUS_ACCT_STATUS_TYPE_ABORT,
  RADIUS_ACCT_TERMINATE_CAUSE_VALUES,
  RADIUS_ATTRIBUTE_TYPES,
  RADIUS_VENDOR_ID_MICROTIK,
  RADIUS_VENDOR_ID_CISCO,
  RADIUS_VENDOR_ID_UBIQUITI,
  RADIUS_VENDOR_ID_TP_LINK,
  RADIUS_VENDOR_ATTRIBUTES,
  RADIUS_STANDARD_ATTRIBUTES,
  isAccountingStatusType,
  getAttributeName,
  getCodeName,
};
