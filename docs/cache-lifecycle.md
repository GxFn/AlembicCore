# 内存缓存生命周期

`@alembic/core/infrastructure/cache` 保留 CacheService、cacheService、
UnifiedCacheAdapter、initCacheAdapter、getCacheAdapter 和 CacheKeyBuilder 的既有出口。
GraphCache 是另一种基于文件与内容 hash 的缓存，不共享内存 TTL Map。

默认 UnifiedCacheAdapter 都借用模块级 cacheService；初始化 adapter 不转移缓存的
所有权。单个宿主服务关闭时，不能直接销毁其他调用方仍在使用的共享缓存。
需要独立数据的调用方仍可自行创建 CacheService 并管理其生命周期。

| 状态变化 | 清理任务 |
| --- | --- |
| 导入模块、创建空实例或初始化 adapter | 不创建 timer |
| set 写入第一条数据 | 启动一个每 60 秒执行的 unref interval |
| 再次写入、仍有其他条目 | 复用同一个 interval |
| get 发现最后一条已过期、delete 最后一条、clear 或定时扫描清空 | 取消 interval 并清空 handle |
| shutdown | 清空数据、释放任务；后续 set 可重新启动回收 |

TTL 以秒为单位，默认 300 秒；`expiresAt < Date.now()` 才过期，恰好到期时仍命中。
get miss 返回 null，缓存的 0/false 保持原值。getStats 继续报告当前 Map 内容，
不会为了查询统计额外执行过期清理。后台任务延迟和原有 60 秒周期一样，不承诺条目
恰好到期就从 Map 消失；get 自己负责拒绝过期值。

cache 和 cleanupInterval 字段仍可见，便于既有调用方检查状态；自动任务调度入口是
set/get/delete/clear/cleanupExpired/shutdown。直接改写 Map 或 timer 字段会绕过调度，
不能据此要求与方法调用相同的后台回收。与旧实现相比，空缓存的 handle 为 null，
周期从首次写入开始；这两项是有意的资源生命周期变化。

该实现只有进程内存后端，不包含 Redis 或分布式一致性能力。
`CacheService.test.ts` 验证共享 adapter、空闲释放、shutdown 后重用、TTL 边界及假值。
