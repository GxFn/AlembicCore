import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
// 使用Core既有测试环境，仅增加Atlas自己的隔离恢复probe，不改产品Vitest配置。
export default defineConfig({root:fileURLToPath(new URL('../../',import.meta.url)),test:{include:['test/**/*.test.ts','alembic-core-architecture-atlas/probes/**/*.test.ts'],globals:true,testTimeout:30000,hookTimeout:30000,teardownTimeout:10000,setupFiles:['test/setup.ts'],maxWorkers:1}});
