const {
  RADIUS_ATTRIBUTE_HEADER_SIZE,
  RADIUS_ATTRIBUTE_TYPES,
  getAttributeName,
  RADIUS_VENDOR_ID_MICROTIK,
  RADIUS_VENDOR_ID_CISCO,
  RADIUS_VENDOR_ATTRIBUTES,
} = require("./constants");

class RadiusAttributeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RadiusAttributeError";
    this.code = code;
    this.details = details;
  }
}

function ipToBuffer(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    throw new RadiusAttributeError(
      "INVALID_IP",
      `Invalid IPv4 address: ${ip}`,
    );
  }
  const bytes = parts.map((p) => {
    const n = parseInt(p, 10);
    if (n < 0 || n > 255) {
      throw new RadiusAttributeError(
        "INVALID_IP",
        `Invalid IPv4 octet: ${p} in ${ip}`,
      );
    }
    return n;
  });
  return Buffer.from(bytes);
}

function bufferToIp(buf) {
  if (buf.length !== 4) return null;
  return Array.from(buf).join(".");
}

function integerToBuffer(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value >>> 0, 0);
  return buf;
}

function bufferToInteger(buf) {
  if (buf.length < 4) {
    let val = 0;
    for (let i = 0; i < buf.length; i++) {
      val = (val << 8) | buf[i];
    }
    return val >>> 0;
  }
  return buf.readUInt32BE(0);
}

function integer64ToBuffer(value) {
  const buf = Buffer.alloc(8);
  const val = Number(value) >>> 0;
  buf.writeUInt32BE(val, 0);
  buf.writeUInt32BE(0, 4);
  return buf;
}

function bufferToInteger64(buf) {
  if (buf.length >= 8) {
    const high = buf.readUInt32BE(0);
    const low = buf.readUInt32BE(4);
    return high * 0x100000000 + low;
  }
  if (buf.length >= 4) {
    return buf.readUInt32BE(0);
  }
  return buf.readUInt8(0);
}

function encodeAttribute(type, value) {
  if (type < 1 || type > 255) {
    throw new RadiusAttributeError(
      "INVALID_TYPE",
      `Attribute type must be 1-255, got ${type}`,
    );
  }

  const typeDef = RADIUS_ATTRIBUTE_TYPES[type];
  const attrType = typeDef ? typeDef.type : "string";

  let valueBuf;

  if (attrType === "integer" || attrType === "integer64") {
    valueBuf = attrType === "integer64" ? integer64ToBuffer(value) : integerToBuffer(Number(value));
  } else if (attrType === "ip") {
    valueBuf = ipToBuffer(value);
  } else if (attrType === "vsa") {
    valueBuf = encodeVendorSpecific(value.vendorId, value.vendorType, value.vendorValue);
  } else if (attrType === "encrypted" || attrType === "opaque") {
    valueBuf = Buffer.isBuffer(value) ? value : Buffer.from(value, "binary");
  } else {
    valueBuf = Buffer.from(String(value), "utf8");
  }

  if (valueBuf.length > 253) {
    throw new RadiusAttributeError(
      "VALUE_TOO_LONG",
      `Attribute ${type} (${getName(type)}) value exceeds 253 bytes (got ${valueBuf.length})`,
    );
  }

  const buf = Buffer.alloc(RADIUS_ATTRIBUTE_HEADER_SIZE + valueBuf.length);
  buf.writeUInt8(type, 0);
  buf.writeUInt8(RADIUS_ATTRIBUTE_HEADER_SIZE + valueBuf.length, 1);
  valueBuf.copy(buf, RADIUS_ATTRIBUTE_HEADER_SIZE);

  return buf;
}

function encodeVendorSpecific(vendorId, vendorType, vendorValue) {
  const vendorIdBuf = Buffer.alloc(4);
  vendorIdBuf.writeUInt32BE(vendorId >>> 0, 0);

  let valueBuf;
  if (Buffer.isBuffer(vendorValue)) {
    valueBuf = vendorValue;
  } else if (typeof vendorValue === "string") {
    valueBuf = Buffer.from(vendorValue, "utf8");
  } else if (typeof vendorValue === "number") {
    valueBuf = integerToBuffer(vendorValue);
  } else {
    valueBuf = Buffer.from(String(vendorValue), "utf8");
  }

  const subBuf = Buffer.alloc(2 + valueBuf.length);
  subBuf.writeUInt8(vendorType, 0);
  subBuf.writeUInt8(2 + valueBuf.length, 1);
  valueBuf.copy(subBuf, 2);

  return Buffer.concat([vendorIdBuf, subBuf]);
}

function decodeVendorSpecific(buf) {
  if (buf.length < 6) {
    throw new RadiusAttributeError(
      "MALFORMED_VSA",
      "Vendor-Specific attribute must be at least 6 bytes",
    );
  }

  const vendorId = buf.readUInt32BE(0);
  const subType = buf[4];
  const subLength = buf[5];

  if (subLength < 2 || subLength > buf.length - 4) {
    throw new RadiusAttributeError(
      "MALFORMED_VSA",
      "Invalid Vendor-Specific sub-attribute length",
    );
  }

  const subValue = buf.slice(6, 4 + subLength);

  const vendorDef = RADIUS_VENDOR_ATTRIBUTES[vendorId];
  let subName = `VSA-${subType}`;

  if (vendorDef && vendorDef.attributes && vendorDef.attributes[subType]) {
    subName = vendorDef.attributes[subType].name;
  }

  return {
    vendorId,
    vendorName: vendorDef ? vendorDef.name : `Vendor-${vendorId}`,
    subType,
    subTypeName: subName,
    value: subValue,
    raw: buf,
  };
}

function decodeAttribute(buf) {
  if (buf.length < RADIUS_ATTRIBUTE_HEADER_SIZE) {
    throw new RadiusAttributeError(
      "MALFORMED_ATTRIBUTE",
      `Attribute buffer too short: ${buf.length} bytes`,
    );
  }

  const type = buf[0];
  const attrLength = buf[1];

  if (attrLength < 2 || attrLength > buf.length) {
    throw new RadiusAttributeError(
      "MALFORMED_ATTRIBUTE",
      `Invalid attribute length: ${attrLength}`,
    );
  }

  const valueBuf = buf.slice(RADIUS_ATTRIBUTE_HEADER_SIZE, attrLength);
  const typeDef = RADIUS_ATTRIBUTE_TYPES[type];
  const attrType = typeDef ? typeDef.type : "string";

  let decoded;

  if (attrType === "string") {
    decoded = valueBuf.toString("utf8");
  } else if (attrType === "encrypted" || attrType === "opaque" || attrType === undefined) {
    decoded = valueBuf;
  } else if (attrType === "ip") {
    decoded = bufferToIp(valueBuf);
  } else if (attrType === "integer") {
    decoded = bufferToInteger(valueBuf);
  } else if (attrType === "integer64") {
    decoded = bufferToInteger64(valueBuf);
  } else if (attrType === "vsa") {
    decoded = decodeVendorSpecific(valueBuf);
  } else {
    decoded = valueBuf;
  }

  return {
    type,
    name: getName(type),
    length: attrLength,
    value: valueBuf,
    raw: valueBuf,
    decoded,
  };
}

function getName(type) {
  return getAttributeName(type);
}

function encodeAttributes(attrs) {
  const buffers = [];
  for (const attr of attrs) {
    if (attr.type === 26) {
      buffers.push(
        encodeAttribute(attr.type, {
          vendorId: attr.vendorId,
          vendorType: attr.vendorType,
          vendorValue: attr.value,
        }),
      );
    } else {
      buffers.push(encodeAttribute(attr.type, attr.value));
    }
  }
  return Buffer.concat(buffers);
}

function decodeAttributes(buf, expectedCount) {
  const attributes = [];
  let offset = 0;

  while (offset < buf.length) {
    if (offset + RADIUS_ATTRIBUTE_HEADER_SIZE > buf.length) {
      throw new RadiusAttributeError(
        "TRUNCATED_ATTRIBUTE",
        `Truncated attribute at offset ${offset}: only ${buf.length - offset} bytes remaining`,
      );
    }

    const attrLength = buf[offset + 1];
    if (attrLength < 2) {
      throw new RadiusAttributeError(
        "MALFORMED_ATTRIBUTE",
        `Invalid attribute length ${attrLength} at offset ${offset}`,
      );
    }

    const attrBuf = buf.slice(offset, offset + attrLength);
    if (attrBuf.length < attrLength) {
      throw new RadiusAttributeError(
        "TRUNCATED_ATTRIBUTE",
        `Attribute at offset ${offset} claims ${attrLength} bytes but only ${attrBuf.length} available`,
      );
    }

    attributes.push(decodeAttribute(attrBuf));
    offset += attrLength;
  }

  return attributes;
}

function findAttribute(attributes, type) {
  return attributes.find((a) => a.type === type);
}

function findAttributeValue(attributes, type, fallback = null) {
  const attr = findAttribute(attributes, type);
  return attr ? attr.decoded : fallback;
}

function getAllAttributeValues(attributes, type) {
  return attributes
    .filter((a) => a.type === type)
    .map((a) => a.decoded);
}

module.exports = {
  RadiusAttributeError,
  encodeAttribute,
  decodeAttribute,
  encodeVendorSpecific,
  decodeVendorSpecific,
  encodeAttributes,
  decodeAttributes,
  findAttribute,
  findAttributeValue,
  getAllAttributeValues,
};
