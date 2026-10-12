interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

const promises = Promise as PromiseConstructor & {
  withResolvers?: <T>() => Deferred<T>;
};

/** Use native resolvers while keeping file conversion usable on older Safari versions. */
export function deferred<T>(): Deferred<T> {
  if (promises.withResolvers) return promises.withResolvers<T>();
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  // The ES2022 compatibility path requires the Promise constructor's executor API.
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
