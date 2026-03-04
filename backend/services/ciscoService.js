const { Client } = require("ssh2");

/**
 * Helper to run one or more IOS commands over SSH.
 * Returns { success, message, rawOutput }.
 */
function runCiscoCommands(device, commands) {
  const {
    ip,
    sshPort = 22,
    sshUser,
    sshPassword,
    enablePassword,
  } = device || {};

  return new Promise((resolve) => {
    if (!ip || !sshUser || !sshPassword) {
      return resolve({
        success: false,
        message: "Missing SSH connection details (ip/sshUser/sshPassword)",
        rawOutput: "",
      });
    }

    const conn = new Client();
    let rawOutput = "";

    conn
      .on("ready", () => {
        const cmdList = Array.isArray(commands) ? commands : [commands];

        // Build a single script with newlines. We keep it simple and rely on IOS to process line by line.
        let finalScript = "terminal length 0\n";
        if (enablePassword) {
          finalScript += "enable\n" + enablePassword + "\n";
        }
        finalScript += cmdList.join("\n") + "\n";

        conn.exec(finalScript, (err, stream) => {
          if (err) {
            conn.end();
            return resolve({
              success: false,
              message: `SSH exec error: ${err.message || err}`,
              rawOutput: "",
            });
          }
          stream
            .on("close", () => {
              conn.end();
              resolve({
                success: true,
                message: "Command(s) executed",
                rawOutput,
              });
            })
            .on("data", (data) => {
              rawOutput += data.toString();
            })
            .stderr.on("data", (data) => {
              rawOutput += data.toString();
            });
        });
      })
      .on("error", (err) => {
        resolve({
          success: false,
          message: `SSH connection error: ${err.message || err}`,
          rawOutput,
        });
      })
      .connect({
        host: ip,
        port: sshPort,
        username: sshUser,
        password: sshPassword,
        readyTimeout: 15000,
      });
  });
}

function parseVersionInfo(rawOutput) {
  let model = null;
  let version = null;
  if (!rawOutput) return { model, version };

  const lines = rawOutput.split(/\r?\n/);
  for (const line of lines) {
    const l = line.trim();
    if (!version) {
      const m = l.match(/Cisco IOS .*Version\s+([^,]+)/i);
      if (m) {
        version = m[1].trim();
      }
    }
    if (!model) {
      const m2 = l.match(/bytes of memory\)\s+(.+)/i);
      if (m2) {
        model = m2[1].trim();
      }
    }
  }
  return { model, version };
}

async function onboardCiscoDevice(device) {
  try {
    const cmds = [
      "configure terminal",
      // Basic AAA bootstrap (simplified)
      "aaa new-model",
      // QoS bootstrap placeholder (can be extended)
      "class-map match-all YABA-CLASS",
      " match any",
      "policy-map YABA-QOS",
      " class YABA-CLASS",
      "  police 1000000 8000 exceed-action drop",
      "exit",
      "exit",
      "end",
      "write memory",
      "show version",
    ];

    const result = await runCiscoCommands(device, cmds);
    if (!result.success) {
      return {
        success: false,
        message: result.message,
        rawOutput: result.rawOutput,
      };
    }

    const { model, version } = parseVersionInfo(result.rawOutput);

    return {
      success: true,
      message: "Cisco device onboarded successfully",
      rawOutput: result.rawOutput,
      model,
      version,
    };
  } catch (err) {
    return {
      success: false,
      message: err.message || "Failed to onboard Cisco device",
      rawOutput: "",
    };
  }
}

async function createVoucherUser(device, user) {
  try {
    const { username, password, downloadKbps, uploadKbps } = user;
    const downPolicy = `BW_${username}_DOWN`;
    const upPolicy = `BW_${username}_UP`;
    const downBps = Number(downloadKbps || 0) * 1000;
    const upBps = Number(uploadKbps || 0) * 1000;

    const cmds = [
      "configure terminal",
      // Download policy
      `policy-map ${downPolicy}`,
      " class class-default",
      downBps > 0
        ? `  police ${downBps} 8000 exceed-action drop`
        : "  no police",
      "exit",
      "exit",
      // Upload policy
      `policy-map ${upPolicy}`,
      " class class-default",
      upBps > 0 ? `  police ${upBps} 8000 exceed-action drop` : "  no police",
      "exit",
      "exit",
      // Local user for voucher
      `username ${username} privilege 1 secret ${password}`,
      "end",
      "write memory",
    ];

    const result = await runCiscoCommands(device, cmds);
    if (!result.success) {
      return {
        success: false,
        message: result.message,
        rawOutput: result.rawOutput,
      };
    }

    return {
      success: true,
      message: "Voucher user created on Cisco router",
      rawOutput: result.rawOutput,
    };
  } catch (err) {
    return {
      success: false,
      message: err.message || "Failed to create voucher user",
      rawOutput: "",
    };
  }
}

async function deleteVoucherUser(device, username) {
  try {
    const downPolicy = `BW_${username}_DOWN`;
    const upPolicy = `BW_${username}_UP`;

    const cmds = [
      "configure terminal",
      `no username ${username}`,
      `no policy-map ${downPolicy}`,
      `no policy-map ${upPolicy}`,
      "end",
      "write memory",
    ];

    const result = await runCiscoCommands(device, cmds);
    if (!result.success) {
      return {
        success: false,
        message: result.message,
        rawOutput: result.rawOutput,
      };
    }

    return {
      success: true,
      message: "Voucher user and bandwidth policies removed",
      rawOutput: result.rawOutput,
    };
  } catch (err) {
    return {
      success: false,
      message: err.message || "Failed to delete voucher user",
      rawOutput: "",
    };
  }
}

async function updateUserBandwidth(device, username, downloadKbps, uploadKbps) {
  try {
    const downPolicy = `BW_${username}_DOWN`;
    const upPolicy = `BW_${username}_UP`;
    const downBps = Number(downloadKbps || 0) * 1000;
    const upBps = Number(uploadKbps || 0) * 1000;

    const cmds = [
      "configure terminal",
      `policy-map ${downPolicy}`,
      " class class-default",
      downBps > 0
        ? `  police ${downBps} 8000 exceed-action drop`
        : "  no police",
      "exit",
      "exit",
      `policy-map ${upPolicy}`,
      " class class-default",
      upBps > 0 ? `  police ${upBps} 8000 exceed-action drop` : "  no police",
      "exit",
      "exit",
      "end",
      "write memory",
    ];

    const result = await runCiscoCommands(device, cmds);
    if (!result.success) {
      return {
        success: false,
        message: result.message,
        rawOutput: result.rawOutput,
      };
    }

    return {
      success: true,
      message: "User bandwidth updated on Cisco router",
      rawOutput: result.rawOutput,
    };
  } catch (err) {
    return {
      success: false,
      message: err.message || "Failed to update user bandwidth",
      rawOutput: "",
    };
  }
}

async function disconnectExpiredUsers(device, expiredUsernames) {
  const results = [];

  if (!Array.isArray(expiredUsernames) || expiredUsernames.length === 0) {
    return {
      success: true,
      message: "No expired users to disconnect",
      rawOutput: "",
      results: [],
    };
  }

  for (const username of expiredUsernames) {
    // Best-effort: delete user + policies
    // We reuse deleteVoucherUser to keep behavior consistent.
    // eslint-disable-next-line no-await-in-loop
    const res = await deleteVoucherUser(device, username);
    results.push({ username, success: res.success, rawOutput: res.rawOutput });
  }

  const anyFailed = results.some((r) => !r.success);

  return {
    success: !anyFailed,
    message: anyFailed
      ? "Some users failed to disconnect"
      : "All expired users disconnected",
    rawOutput: results.map((r) => r.rawOutput || "").join("\n---\n"),
    results,
  };
}

async function getConnectedUsers(device) {
  try {
    const result = await runCiscoCommands(device, ["show users"]);
    if (!result.success) {
      return {
        success: false,
        message: result.message,
        rawOutput: result.rawOutput,
      };
    }

    return {
      success: true,
      message: "Fetched connected users",
      rawOutput: result.rawOutput,
    };
  } catch (err) {
    return {
      success: false,
      message: err.message || "Failed to get connected users",
      rawOutput: "",
    };
  }
}

module.exports = {
  onboardCiscoDevice,
  createVoucherUser,
  deleteVoucherUser,
  updateUserBandwidth,
  disconnectExpiredUsers,
  getConnectedUsers,
};
