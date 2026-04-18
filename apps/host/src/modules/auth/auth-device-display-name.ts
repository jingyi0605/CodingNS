import type { AuthClientType } from "../../types/domain.js";

export interface ResolvedAuthDeviceInfo {
  displayName: string | null;
  browserName: string | null;
  browserVersion: string | null;
  osName: string | null;
  osVersion: string | null;
}

export function resolveAuthDeviceInfo(
  clientType: AuthClientType,
  userAgent: string | null | undefined
): ResolvedAuthDeviceInfo {
  const browser = detectBrowser(userAgent);
  const os = detectOs(userAgent);
  const browserName = browser.name;
  const osName = os.name;

  return {
    displayName: buildDisplayName(clientType, browserName, osName),
    browserName,
    browserVersion: browser.version,
    osName,
    osVersion: os.version
  };
}

export function resolveAuthDeviceDisplayName(
  clientType: AuthClientType,
  userAgent: string | null | undefined
): string | null {
  return resolveAuthDeviceInfo(clientType, userAgent).displayName;
}

function buildDisplayName(
  clientType: AuthClientType,
  browserName: string | null,
  osName: string | null
): string | null {
  switch (clientType) {
    case "desktop":
      return osName ? `Desktop · ${osName}` : "Desktop";
    case "ios":
      return "iOS App";
    case "android":
      return "Android App";
    case "web":
      if (browserName && osName) {
        return `${browserName} · ${osName}`;
      }

      if (browserName) {
        return browserName;
      }

      return osName ? `Web · ${osName}` : "Web";
    default:
      if (browserName && osName) {
        return `${browserName} · ${osName}`;
      }

      if (browserName) {
        return browserName;
      }

      if (osName) {
        return osName;
      }

      return null;
  }
}

function detectBrowser(userAgent: string | null | undefined): {
  name: string | null;
  version: string | null;
} {
  const value = userAgent?.trim();

  if (!value) {
    return {
      name: null,
      version: null
    };
  }

  const edgeVersion = readVersion(value, /\b(?:EdgA|EdgiOS|Edg|Edge)\/([\d.]+)/i);

  if (edgeVersion) {
    return {
      name: "Edge",
      version: edgeVersion
    };
  }

  const operaVersion = readVersion(value, /\b(?:OPR|Opera)\/([\d.]+)/i);

  if (operaVersion) {
    return {
      name: "Opera",
      version: operaVersion
    };
  }

  const firefoxVersion = readVersion(value, /\b(?:Firefox|FxiOS)\/([\d.]+)/i);

  if (firefoxVersion) {
    return {
      name: "Firefox",
      version: firefoxVersion
    };
  }

  const chromeVersion = readVersion(value, /\b(?:Chrome|CriOS)\/([\d.]+)/i);

  if (chromeVersion) {
    return {
      name: "Chrome",
      version: chromeVersion
    };
  }

  const safariVersion = readVersion(value, /\bVersion\/([\d.]+).+Safari\//i);

  if (safariVersion) {
    return {
      name: "Safari",
      version: safariVersion
    };
  }

  return {
    name: null,
    version: null
  };
}

function detectOs(userAgent: string | null | undefined): {
  name: string | null;
  version: string | null;
} {
  const value = userAgent?.trim();
  const fingerprint = normalizeUserAgent(userAgent);

  if (!value || !fingerprint) {
    return {
      name: null,
      version: null
    };
  }

  if (fingerprint.includes("iphone") || fingerprint.includes("ipad") || fingerprint.includes("ipod")) {
    return {
      name: "iOS",
      version: readVersion(value, /\bOS ([\d_]+)/i, "_")
    };
  }

  const androidVersion = readVersion(value, /\bAndroid ([\d.]+)/i);

  if (androidVersion || fingerprint.includes("android")) {
    return {
      name: "Android",
      version: androidVersion
    };
  }

  const windowsVersion = readVersion(value, /\bWindows NT ([\d.]+)/i);

  if (windowsVersion || fingerprint.includes("windows")) {
    return {
      name: "Windows",
      version: mapWindowsVersion(windowsVersion)
    };
  }

  const macVersion = readVersion(value, /\bMac OS X ([\d_]+)/i, "_");

  if (macVersion || fingerprint.includes("mac os x") || fingerprint.includes("macintosh")) {
    return {
      name: "macOS",
      version: macVersion
    };
  }

  if (fingerprint.includes("cros")) {
    return {
      name: "ChromeOS",
      version: readVersion(value, /\bCrOS [^ ]+ ([\d.]+)/i)
    };
  }

  if (fingerprint.includes("linux")) {
    return {
      name: "Linux",
      version: null
    };
  }

  return {
    name: null,
    version: null
  };
}

function normalizeUserAgent(userAgent: string | null | undefined): string {
  return userAgent?.trim().toLowerCase() ?? "";
}

function readVersion(
  userAgent: string,
  pattern: RegExp,
  separator = "."
): string | null {
  const match = pattern.exec(userAgent);
  const raw = match?.[1]?.trim();

  if (!raw) {
    return null;
  }

  return normalizeVersion(raw, separator);
}

function normalizeVersion(rawVersion: string, separator = "."): string {
  const parts = rawVersion
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return rawVersion.trim();
  }

  while (parts.length > 1 && parts[parts.length - 1] === "0") {
    parts.pop();
  }

  return parts.join(".");
}

function mapWindowsVersion(version: string | null): string | null {
  if (!version) {
    return null;
  }

  switch (version) {
    case "10":
      return "10/11";
    case "6.3":
      return "8.1";
    case "6.2":
      return "8";
    case "6.1":
      return "7";
    case "6":
      return "Vista";
    default:
      return version;
  }
}
