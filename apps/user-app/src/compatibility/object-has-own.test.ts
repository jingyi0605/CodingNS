import { afterEach, describe, expect, it } from "vitest";

import { installObjectHasOwnPolyfill } from "./object-has-own";

const originalDescriptor = Object.getOwnPropertyDescriptor(Object, "hasOwn");

afterEach(() => {
  if (originalDescriptor) {
    Object.defineProperty(Object, "hasOwn", originalDescriptor);
  } else {
    Reflect.deleteProperty(Object, "hasOwn");
  }
});

describe("installObjectHasOwnPolyfill", () => {
  it("在运行时缺少 Object.hasOwn 时补齐属性判断", () => {
    Reflect.deleteProperty(Object, "hasOwn");

    installObjectHasOwnPolyfill();

    expect(Object.hasOwn({ ready: true }, "ready")).toBe(true);
    expect(Object.hasOwn(Object.create({ inherited: true }), "inherited")).toBe(false);
  });

  it("不会覆盖已有的 Object.hasOwn 实现", () => {
    const existingImplementation = Object.hasOwn;
    installObjectHasOwnPolyfill();

    expect(Object.hasOwn).toBe(existingImplementation);
  });
});
