/**
 * 文件名 → 语言。宿主的模块服务经 `@alembic/core/host-agent-workflows` 取这个入口；
 * 规则只有 LanguageService 那一份，这里只做转发。
 *
 * 这个文件原名 LanguageExtensionBuilder，另带一张按语言给出"典型模式 / 反模式 / Guard 建议 /
 * Agent 注意事项"的注册表（约 900 行）和 `buildLanguageExtension`。那张表只被旧的项目快照简报
 * 与内部呈现器使用，宿主改走 ProjectContext 简报之后就没有调用方了（简报里的
 * `languageExtension` 一直是 null），已随那条分支一并删除；最后一个带着它的提交是 2ba6c20。
 */

import { LanguageService } from '../../../shared/LanguageService.js';

/** 根据文件扩展名推断语言 — 委托给 LanguageService（唯一来源） */
export function inferLang(filename: string) {
  return LanguageService.inferLang(filename);
}
