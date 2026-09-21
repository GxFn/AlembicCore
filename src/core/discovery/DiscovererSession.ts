import Logger from '../../infrastructure/logging/Logger.js';
import {
  type ProjectDiscoverer,
  type ProjectDiscoveryExecutionContext,
  throwIfProjectDiscoveryAborted,
} from './ProjectDiscoverer.js';

// 仅按旧注册对象排队，不保存当前项目；同一对象注册到多个 registry 仍共享使用权。
const sessionTails = new WeakMap<ProjectDiscoverer, Promise<void>>();

export async function withDiscovererSession<T>(
  discoverers: readonly ProjectDiscoverer[],
  read: () => Promise<T>,
  context?: ProjectDiscoveryExecutionContext
): Promise<T> {
  throwIfProjectDiscoveryAborted(context);
  const shared = [...new Set(discoverers)];
  if (shared.length === 0) {
    return read();
  }

  Logger.debug('Discoverer session uses serialized legacy registrations', {
    discovererIds: shared.map((discoverer) => discoverer.id),
    queued: shared.some((discoverer) => sessionTails.has(discoverer)),
  });
  // 同步预订全部对象，避免多个 registry 以不同注册顺序逐项加锁产生死锁。
  const previous = Promise.all(shared.map((discoverer) => sessionTails.get(discoverer))).then(
    () => undefined
  );
  const release = Promise.withResolvers<void>();
  const tail = previous.then(() => release.promise);
  for (const discoverer of shared) {
    sessionTails.set(discoverer, tail);
  }
  void tail.then(() => {
    for (const discoverer of shared) {
      if (sessionTails.get(discoverer) === tail) {
        sessionTails.delete(discoverer);
      }
    }
  });

  try {
    await waitForSessionTurn(previous, context);
    return await read();
  } finally {
    // 取消等待也必须保留 previous 依赖，后继请求不能越过仍在读取的前序请求。
    release.resolve();
  }
}

async function waitForSessionTurn(
  previous: Promise<void>,
  context?: ProjectDiscoveryExecutionContext
): Promise<void> {
  const signal = context?.signal;
  if (!signal) {
    await previous;
    return;
  }
  const aborted = Promise.withResolvers<void>();
  const onAbort = () => aborted.resolve();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    throwIfProjectDiscoveryAborted(context);
    await Promise.race([previous, aborted.promise]);
    throwIfProjectDiscoveryAborted(context);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
