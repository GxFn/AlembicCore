/**
 * RecipeParser — Recipe Markdown 解析器
 * 从完整 Recipe MD 提取结构化数据
 */

import fs from 'node:fs';
import path from 'node:path';
import Logger from '../../../../infrastructure/logging/Logger.js';
import { LanguageService } from '../../../../shared/LanguageService.js';

interface CodeBlock {
  language: string;
  code: string;
}

export interface ParsedRecipe {
  title: string;
  summary: string;
  description: string;
  trigger: string;
  category: string;
  language: string;
  code: string;
  codeBlocks: CodeBlock[];
  usageGuide: string;
  headers: string[];
  includeHeaders: boolean;
  frontmatter: Record<string, unknown>;
  [key: string]: unknown;
}

interface ExtractOpts {
  projectRoot?: string;
  language?: string;
  relativePath?: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;
const USAGE_HEADING_RE = /^##\s+(?:Usage\s*Guide|用法|使用指南)/im;
const FENCED_CODE_RE = /```(\w*)\n([\s\S]*?)```/;

export class RecipeParser {
  readonly #logger = Logger.getInstance();

  /**
   * 检查文本是否为完整 Recipe MD
   * 需包含: frontmatter + 代码块 + Usage Guide
   */
  isCompleteRecipe(text: string) {
    if (!text) {
      return false;
    }
    return FRONTMATTER_RE.test(text) && FENCED_CODE_RE.test(text) && USAGE_HEADING_RE.test(text);
  }

  /** 检查是否为「仅介绍」Recipe（有 frontmatter 但无代码块） */
  isIntroOnly(text: string) {
    if (!text) {
      return false;
    }
    return FRONTMATTER_RE.test(text) && !FENCED_CODE_RE.test(text);
  }

  /** 解析完整 Recipe MD 为结构化对象 */
  parse(text: string): ParsedRecipe | null {
    if (!text) {
      return null;
    }

    const frontmatter = this.parseFrontmatter(text) as Record<string, unknown>;
    const body = text.replace(FRONTMATTER_RE, '').trim();

    // 提取代码块
    const codeBlocks: CodeBlock[] = [];
    let match: RegExpExecArray | null;
    const codeRe = /```(\w*)\n([\s\S]*?)```/g;
    while ((match = codeRe.exec(body)) !== null) {
      codeBlocks.push({ language: match[1] || 'text', code: match[2].trim() });
    }

    // 提取 Usage Guide
    const usageMatch = body.match(USAGE_HEADING_RE);
    let usageGuide = '';
    if (usageMatch && usageMatch.index !== undefined) {
      const usageStart = usageMatch.index + usageMatch[0].length;
      const nextHeading = body.slice(usageStart).search(/^##\s+/m);
      usageGuide =
        nextHeading > 0
          ? body.slice(usageStart, usageStart + nextHeading).trim()
          : body.slice(usageStart).trim();
    }

    // 提取标题
    const titleMatch = body.match(/^#\s+(.+)/m);
    const title = (frontmatter.title as string) || (titleMatch ? titleMatch[1].trim() : '');

    // 提取 headers
    const headers = this.#extractHeaders(body);

    return {
      title,
      summary: (frontmatter.summary as string) || (frontmatter.description as string) || '',
      description: (frontmatter.description as string) || (frontmatter.summary as string) || '',
      trigger: (frontmatter.trigger as string) || this.#generateTrigger(title),
      category: (frontmatter.category as string) || 'general',
      language:
        (frontmatter.language as string) ||
        (codeBlocks[0]?.language !== 'text' ? codeBlocks[0]?.language : 'swift'),
      code: codeBlocks.map((b) => b.code).join('\n\n'),
      codeBlocks,
      usageGuide,
      headers,
      includeHeaders: headers.length > 0,
      frontmatter,
    };
  }

  /** 从文本中解析多段 Recipe（按 `---` 分隔） */
  parseAll(text: string): ParsedRecipe[] {
    if (!text) {
      return [];
    }
    // YAML 的关闭标记、围栏内的分隔线和正文水平线都不是 Recipe 边界。
    // 先识别文档，再筛选真正的 Markdown，原始源码才能进入提取兜底而不丢失 code。
    return splitRecipeDocuments(text)
      .filter((segment) => FRONTMATTER_RE.test(segment) || FENCED_CODE_RE.test(segment))
      .map((segment) => this.parse(segment))
      .filter((recipe): recipe is ParsedRecipe => recipe !== null);
  }

  /** 解析 frontmatter YAML */
  parseFrontmatter(text: string): Record<string, unknown> {
    const match = text.match(FRONTMATTER_RE);
    if (!match) {
      return {};
    }

    const fm: Record<string, unknown> = {};
    for (const line of match[1].split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        let value: unknown = line.slice(colonIdx + 1).trim();
        if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
          value = value
            .slice(1, -1)
            .split(',')
            .map((s: string) => s.trim().replace(/^['"]|['"]$/g, ''));
        } else if (value === 'true') {
          value = true;
        } else if (value === 'false') {
          value = false;
        } else if (typeof value === 'string' && /^\d+$/.test(value)) {
          value = parseInt(value, 10);
        } else if (typeof value === 'string') {
          value = value.replace(/^['"]|['"]$/g, '');
        }
        fm[key] = value;
      }
    }
    return fm;
  }

  /** 从内容提取 trigger */
  getTrigger(text: string) {
    const fm = this.parseFrontmatter(text);
    return (fm.trigger as string) || '';
  }

  /**
   * 从文件路径读取并提取 Recipe 候选
   * @param relativePath 相对路径
   * @param [opts.projectRoot] 项目根目录
   * @returns >}
   */
  async extractFromPath(relativePath: string, opts: ExtractOpts = {}) {
    const projectRoot = opts.projectRoot || process.cwd();
    const fullPath = path.isAbsolute(relativePath)
      ? relativePath
      : path.resolve(projectRoot, relativePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`文件不存在: ${fullPath}`);
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    const ext = path.extname(fullPath).toLowerCase();
    const language = LanguageService.langFromExt(ext);

    // 已知源码中的注释/字符串也可含 Markdown 围栏，不能因此丢掉源码主体。
    // 显式 frontmatter 仍表达 Recipe 文档意图；其余文档沿用单篇/多篇分段协议。
    const preserveSourceFile =
      LanguageService.isSourceExt(ext) &&
      // 只统一文档标记检测的换行；源码 fallback 仍返回未经改写的原始 content。
      !FRONTMATTER_RE.test(content.trim().replace(/\r\n/g, '\n'));
    const allRecipes = preserveSourceFile ? [] : this.parseAll(content);
    if (allRecipes.length > 0) {
      return { items: allRecipes, isMarked: false };
    }

    // 回退: 将整个文件内容作为代码片段
    const title = path.basename(fullPath, ext);
    this.#logger.debug('[RecipeParser] Using complete file content for extraction', {
      source: fullPath,
      language,
      bytes: Buffer.byteLength(content, 'utf8'),
      reason: preserveSourceFile ? 'source-file-boundary' : 'no-recipe-markdown',
    });
    return {
      items: [
        {
          title,
          summary: '',
          description: '',
          trigger: this.#generateTrigger(title),
          category: 'Utility',
          language,
          code: content,
          codeBlocks: [{ language, code: content }],
          usageGuide: '',
          headers: this.#extractHeaders(content),
          includeHeaders: false,
          frontmatter: {},
        },
      ],
      isMarked: false,
    };
  }

  /** 从文本解析 Recipe（优先完整 Markdown 格式） */
  async parseFromText(text: string, opts: ExtractOpts = {}) {
    if (!text || text.trim().length === 0) {
      throw new Error('文本内容为空');
    }

    // 保留单篇完整 Markdown 的对象返回契约；多篇即使首篇完整也返回独立条目数组。
    const all = this.parseAll(text);
    if (all.length > 0) {
      return all.length === 1 && this.isCompleteRecipe(text) ? all[0] : all;
    }

    throw new Error('文本不是有效的 Recipe Markdown 格式');
  }

  /** 从文本提取代码片段（兜底方法，不要求 Markdown 格式） */
  async extractFromText(text: string, opts: ExtractOpts = {}) {
    if (!text || text.trim().length === 0) {
      throw new Error('文本内容为空');
    }

    const language = opts.language || 'unknown';

    // 先尝试标准解析
    try {
      const result = await this.parseFromText(text, opts);
      return result;
    } catch {
      this.#logger.debug('[RecipeParser] Using snippet fallback after Recipe Markdown rejection', {
        language,
        bytes: Buffer.byteLength(text, 'utf8'),
      });
    }

    // 提取代码块
    const codeBlocks: CodeBlock[] = [];
    const codeRe = /```(\w*)\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    while ((match = codeRe.exec(text)) !== null) {
      codeBlocks.push({ language: match[1] || language, code: match[2].trim() });
    }

    const code = codeBlocks.length > 0 ? codeBlocks.map((b) => b.code).join('\n\n') : text.trim();

    // 简单标题推断
    const titleLine = text.split('\n').find((l: string) => l.trim().startsWith('#'));
    const title = titleLine ? titleLine.replace(/^#+\s*/, '').trim() : 'Untitled Snippet';

    return {
      title,
      summary: '',
      description: '',
      trigger: this.#generateTrigger(title),
      category: 'Utility',
      language,
      code,
      codeBlocks: codeBlocks.length > 0 ? codeBlocks : [{ language, code }],
      usageGuide: '',
      headers: this.#extractHeaders(code),
      includeHeaders: false,
      frontmatter: {},
    };
  }

  #extractHeaders(body: string) {
    const headers: string[] = [];
    const re = /#import\s+[<"]([^>"]+)[>"]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(body)) !== null) {
      headers.push(match[1]);
    }
    return headers;
  }

  #generateTrigger(title: string) {
    if (!title) {
      return '';
    }
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/(^_|_$)/g, '')
      .slice(0, 30);
  }
}

function splitRecipeDocuments(text: string): string[] {
  const documents: string[] = [];
  const lines = text.split(/\r?\n/);
  let current: string[] = [];
  let inFrontmatter = false;
  let fence: string | null = null;
  const flush = () => {
    const document = current.join('\n').trim();
    if (document) {
      documents.push(document);
    }
    current = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const delimiter = line.trim() === '---';
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      current.push(line);
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence[0] &&
        fenceMatch[1].length >= fence.length &&
        line.slice(fenceMatch[0].length).trim() === ''
      ) {
        fence = null;
      }
      continue;
    }
    if (inFrontmatter) {
      current.push(line);
      if (delimiter) {
        inFrontmatter = false;
      }
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      current.push(line);
      continue;
    }
    if (delimiter) {
      let nextIndex = index + 1;
      while (nextIndex < lines.length && !lines[nextIndex].trim()) {
        nextIndex++;
      }
      const next = lines[nextIndex]?.trim() ?? '';
      const nextIsYaml = /^[A-Za-z_][\w-]*\s*:/.test(next);
      if (current.every((candidate) => !candidate.trim())) {
        current = [line];
        inFrontmatter = true;
        continue;
      }
      if (nextIsYaml || next === '---' || /^#\s+\S/.test(next) || /^`{3,}/.test(next)) {
        flush();
        if (nextIsYaml) {
          current.push(line);
          inFrontmatter = true;
        }
        continue;
      }
    }
    current.push(line);
  }
  flush();
  return documents;
}
