import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: EmptyFixture[] = [];

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();

    if (server) {
      server.app.server.closeAllConnections?.();
      await server.app.close();
    }
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("auth login captcha", () => {
  it("第三次失败后触发验证码，并在验证码正确后清空失败计数", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "admin1234"
      }
    });

    const firstFailure = await login(hosted, {
      username: "admin",
      password: "wrong-password"
    });
    expect(firstFailure.statusCode).toBe(401);
    expect(firstFailure.json().error_code).toBe("INVALID_CREDENTIALS");
    expect(firstFailure.json().data).toBeUndefined();

    const secondFailure = await login(hosted, {
      username: "admin",
      password: "wrong-password"
    });
    expect(secondFailure.statusCode).toBe(401);
    expect(secondFailure.json().error_code).toBe("INVALID_CREDENTIALS");
    expect(secondFailure.json().data).toBeUndefined();

    const thirdFailure = await login(hosted, {
      username: "admin",
      password: "wrong-password"
    });
    expect(thirdFailure.statusCode).toBe(401);
    expect(thirdFailure.json().error_code).toBe("INVALID_CREDENTIALS");
    const thirdChallenge = readCaptchaChallenge(thirdFailure.json());
    expect(thirdChallenge.captchaId).toBeTruthy();
    expect(hosted.services.repositories.authLoginAttemptRepository.findByUsername("admin")).toMatchObject({
      failedAttemptCount: 3
    });

    const missingCaptcha = await login(hosted, {
      username: "admin",
      password: "admin1234"
    });
    expect(missingCaptcha.statusCode).toBe(400);
    expect(missingCaptcha.json().error_code).toBe("CAPTCHA_REQUIRED");
    const requiredChallenge = readCaptchaChallenge(missingCaptcha.json());

    const wrongCaptcha = await login(hosted, {
      username: "admin",
      password: "admin1234",
      captchaId: requiredChallenge.captchaId,
      captchaCode: "WRNG"
    });
    expect(wrongCaptcha.statusCode).toBe(400);
    expect(wrongCaptcha.json().error_code).toBe("CAPTCHA_INVALID");
    const validChallenge = readCaptchaChallenge(wrongCaptcha.json());
    const validCaptchaCode = decodeCaptchaCode(validChallenge.imageDataUrl);

    const success = await login(hosted, {
      username: "admin",
      password: "admin1234",
      captchaId: validChallenge.captchaId,
      captchaCode: validCaptchaCode
    });
    expect(success.statusCode).toBe(200);
    expect(success.json().user.username).toBe("admin");
    expect(hosted.services.repositories.authLoginAttemptRepository.findByUsername("admin")).toBeNull();

    const failureAfterSuccess = await login(hosted, {
      username: "admin",
      password: "wrong-password"
    });
    expect(failureAfterSuccess.statusCode).toBe(401);
    expect(failureAfterSuccess.json().error_code).toBe("INVALID_CREDENTIALS");
    expect(failureAfterSuccess.json().data).toBeUndefined();
    expect(hosted.services.repositories.authLoginAttemptRepository.findByUsername("admin")).toMatchObject({
      failedAttemptCount: 1
    });
  });
});

async function login(
  hosted: ReturnType<typeof createTestApp>,
  payload: {
    username: string;
    password: string;
    captchaId?: string;
    captchaCode?: string;
  }
) {
  return hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload
  });
}

function readCaptchaChallenge(body: Record<string, unknown>): { captchaId: string; imageDataUrl: string } {
  const data = body.data as { captcha?: { captchaId?: string; imageDataUrl?: string } } | undefined;
  const captchaId = data?.captcha?.captchaId;
  const imageDataUrl = data?.captcha?.imageDataUrl;

  expect(typeof captchaId).toBe("string");
  expect(typeof imageDataUrl).toBe("string");

  return {
    captchaId: captchaId as string,
    imageDataUrl: imageDataUrl as string
  };
}

function decodeCaptchaCode(imageDataUrl: string): string {
  const base64Payload = imageDataUrl.split(",", 2)[1] ?? "";
  const svg = Buffer.from(base64Payload, "base64").toString("utf8");
  const matches = Array.from(svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g));

  return matches.map((item) => item[1] ?? "").join("");
}
