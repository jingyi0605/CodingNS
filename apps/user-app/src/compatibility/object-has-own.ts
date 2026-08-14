/**
 * 为较旧的浏览器和 WebView 补齐 ES2022 的 Object.hasOwn。
 *
 * react-markdown 10 会直接调用这个 API。入口处提前安装兼容实现，
 * 避免用户打开工作台或加载 Markdown 内容时因运行时缺少 API 而崩溃。
 */
export function installObjectHasOwnPolyfill(): void {
  if (typeof Object.hasOwn === "function") {
    return;
  }

  Object.defineProperty(Object, "hasOwn", {
    configurable: true,
    value(value: object, propertyKey: PropertyKey): boolean {
      return Object.prototype.hasOwnProperty.call(value, propertyKey);
    },
    writable: true
  });
}

installObjectHasOwnPolyfill();
