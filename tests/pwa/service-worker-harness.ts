import vm from "node:vm";

const DEFAULT_ORIGIN = "https://winfrabr.test";

export type WorkerRequest = {
  cache: RequestCache;
  clone: () => WorkerRequest;
  destination: RequestDestination;
  headers: Headers;
  method: string;
  mode: RequestMode;
  url: string;
};

export type CacheOperation = {
  cacheName?: string;
  key?: string;
  operation: "addAll" | "delete" | "keys" | "match" | "open" | "put";
};

type FetchImplementation = (
  request: WorkerRequest | string,
) => Promise<Response>;

type ExtendableEvent = {
  waitUntil(promise: Promise<unknown>): void;
};

type FetchEvent = ExtendableEvent & {
  request: WorkerRequest;
  respondWith(response: Promise<Response> | Response): void;
};

type MessageEvent = ExtendableEvent & {
  data: unknown;
};

type WorkerEvent = ExtendableEvent | FetchEvent | MessageEvent;

type WorkerListener = (event: WorkerEvent) => unknown;

function requestKey(request: WorkerRequest | string, origin = DEFAULT_ORIGIN) {
  return typeof request === "string"
    ? new URL(request, origin).toString()
    : request.url;
}

export function createWorkerRequest(
  path: string,
  options: {
    destination?: RequestDestination;
    headers?: HeadersInit;
    method?: string;
    mode?: RequestMode;
    origin?: string;
  } = {},
): WorkerRequest {
  const origin = options.origin ?? DEFAULT_ORIGIN;
  const url = new URL(path, origin).toString();
  const request = {
    cache: "default" as RequestCache,
    destination: options.destination ?? "",
    headers: new Headers(options.headers),
    method: (options.method ?? "GET").toUpperCase(),
    mode: options.mode ?? "cors",
    url,
  } as WorkerRequest;
  request.clone = () => request;
  return request;
}

export function createWorkerResponse(
  body = "network response",
  options: {
    headers?: HeadersInit;
    status?: number;
    type?: ResponseType;
  } = {},
) {
  const status = options.status ?? 200;
  const type = options.type ?? "basic";
  const makeResponse = () => {
    const response = new Response(body, {
      headers: options.headers,
      status,
    });
    Object.defineProperty(response, "type", { configurable: true, value: type });
    Object.defineProperty(response, "clone", {
      configurable: true,
      value: makeResponse,
    });
    return response;
  };
  return makeResponse();
}

export function createServiceWorkerHarness(
  source: string,
  options: {
    cachePutError?: Error;
    fetch?: FetchImplementation;
    initialCaches?: Record<string, Record<string, Response>>;
    origin?: string;
  } = {},
) {
  const origin = options.origin ?? DEFAULT_ORIGIN;
  const listeners = new Map<string, WorkerListener[]>();
  const operations: CacheOperation[] = [];
  const fetchCalls: Array<WorkerRequest | string> = [];
  const stores = new Map<string, Map<string, Response>>();
  let claimCount = 0;
  let skipWaitingCount = 0;

  for (const [cacheName, entries] of Object.entries(options.initialCaches ?? {})) {
    stores.set(cacheName, new Map(Object.entries(entries)));
  }

  function cacheFor(cacheName: string) {
    const entries = stores.get(cacheName) ?? new Map<string, Response>();
    stores.set(cacheName, entries);
    return {
      async addAll(requests: Array<WorkerRequest | string>) {
        operations.push({ cacheName, operation: "addAll" });
        for (const request of requests) {
          const key = requestKey(request, origin);
          entries.set(
            key,
            createWorkerResponse(`precache:${new URL(key).pathname}`),
          );
        }
      },
      async match(request: WorkerRequest | string) {
        const key = requestKey(request, origin);
        operations.push({ cacheName, key, operation: "match" });
        return entries.get(key)?.clone();
      },
      async delete(request: WorkerRequest | string) {
        const key = requestKey(request, origin);
        operations.push({ cacheName, key, operation: "delete" });
        return entries.delete(key);
      },
      async keys() {
        operations.push({ cacheName, operation: "keys" });
        return [...entries.keys()].map((key) =>
          createWorkerRequest(key, { origin }),
        );
      },
      async put(request: WorkerRequest | string, response: Response) {
        const key = requestKey(request, origin);
        operations.push({ cacheName, key, operation: "put" });
        if (options.cachePutError) throw options.cachePutError;
        entries.set(key, response.clone());
      },
    };
  }

  const cacheStorage = {
    async delete(cacheName: string) {
      operations.push({ cacheName, operation: "delete" });
      return stores.delete(cacheName);
    },
    async keys() {
      operations.push({ operation: "keys" });
      return [...stores.keys()];
    },
    async match(request: WorkerRequest | string) {
      const key = requestKey(request, origin);
      operations.push({ key, operation: "match" });
      for (const entries of stores.values()) {
        const match = entries.get(key);
        if (match) return match.clone();
      }
      return undefined;
    },
    async open(cacheName: string) {
      operations.push({ cacheName, operation: "open" });
      return cacheFor(cacheName);
    },
  };

  const fetchImplementation: FetchImplementation =
    options.fetch ?? (async () => createWorkerResponse());
  const trackedFetch: FetchImplementation = async (request) => {
    fetchCalls.push(request);
    return fetchImplementation(request);
  };

  const scope = {
    addEventListener(type: string, listener: WorkerListener) {
      const current = listeners.get(type) ?? [];
      current.push(listener);
      listeners.set(type, current);
    },
    caches: cacheStorage,
    clients: {
      async claim() {
        claimCount += 1;
      },
    },
    fetch: trackedFetch,
    location: new URL("/sw.js", origin),
    registration: {
      scope: `${origin}/`,
    },
    async skipWaiting() {
      skipWaitingCount += 1;
    },
  };

  const context = vm.createContext({
    Headers,
    Request: class WorkerRequestMock {
      constructor(input: WorkerRequest | string, init: RequestInit = {}) {
        const inputUrl = typeof input === "string" ? input : input.url;
        return createWorkerRequest(inputUrl, {
          headers: init.headers,
          method: init.method,
          origin,
        });
      }
    },
    Response,
    URL,
    caches: cacheStorage,
    console,
    fetch: trackedFetch,
    location: scope.location,
    self: scope,
  });
  vm.runInContext(source, context, { filename: "public/sw.js" });

  async function dispatch(type: string, details: Record<string, unknown> = {}) {
    const waitUntilPromises: Promise<unknown>[] = [];
    let responsePromise: Promise<Response> | undefined;
    const event = {
      ...details,
      respondWith(value: Promise<Response> | Response) {
        responsePromise = Promise.resolve(value);
      },
      waitUntil(value: Promise<unknown>) {
        waitUntilPromises.push(Promise.resolve(value));
      },
    };

    for (const listener of listeners.get(type) ?? []) {
      await listener(event as WorkerEvent);
    }
    const response = responsePromise ? await responsePromise : undefined;
    await Promise.all(waitUntilPromises);
    return { responded: Boolean(responsePromise), response };
  }

  return {
    context,
    dispatchActivate: () => dispatch("activate"),
    dispatchFetch: (request: WorkerRequest) => dispatch("fetch", { request }),
    dispatchInstall: () => dispatch("install"),
    dispatchMessage: (data: unknown) => dispatch("message", { data }),
    evaluate<T>(expression: string, bindings: Record<string, unknown> = {}) {
      Object.assign(context, bindings);
      return vm.runInContext(expression, context) as T;
    },
    fetchCalls,
    get claimCount() {
      return claimCount;
    },
    operations,
    stores,
    get skipWaitingCount() {
      return skipWaitingCount;
    },
  };
}
