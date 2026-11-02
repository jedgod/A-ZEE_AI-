declare global {
  var localStorage: Storage | undefined;
  var sessionStorage: Storage | undefined;
}

const storageStub = (): Storage => ({
  length: 0,
  clear: () => undefined,
  getItem: () => null,
  key: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
});

if (typeof globalThis !== "undefined") {
  if (!globalThis.localStorage || typeof globalThis.localStorage.getItem !== "function") {
    Object.defineProperty(globalThis, "localStorage", {
      value: storageStub(),
      configurable: true,
      writable: true,
    });
  }

  if (!globalThis.sessionStorage || typeof globalThis.sessionStorage.getItem !== "function") {
    Object.defineProperty(globalThis, "sessionStorage", {
      value: storageStub(),
      configurable: true,
      writable: true,
    });
  }
}

export {};
