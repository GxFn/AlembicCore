import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RecipeParser } from '../src/service/knowledge/validation/recipe/index.js';

function recipe(title: string, code = 'export const value = 1;'): string {
  return [
    '---',
    `title: ${title}`,
    'summary: A reusable implementation',
    'language: typescript',
    'category: architecture',
    '---',
    `# ${title}`,
    '',
    '## Code',
    '```typescript',
    code,
    '```',
    '',
    '## Usage Guide',
    'Use the implementation at the module boundary.',
  ].join('\n');
}

describe('RecipeParser extraction behavior', () => {
  it('preserves raw source bytes for the extract/path consumer', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-recipe-parser-'));
    const code = 'export function run() {\n  return 42;\n}\n';
    try {
      fs.writeFileSync(path.join(projectRoot, 'example.ts'), code);
      const result = await new RecipeParser().extractFromPath('example.ts', { projectRoot });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        title: 'example',
        language: 'typescript',
        code,
        codeBlocks: [{ language: 'typescript', code }],
        frontmatter: {},
      });
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      filename: 'documented.ts',
      language: 'typescript',
      code: '/**\n * Example:\n * ```ts\n * run();\n * ```\n */\nexport function run() { return 42; }\n',
    },
    {
      filename: 'prompt.py',
      language: 'python',
      code: 'PROMPT = """Example:\n```python\nrun()\n```\n"""\ndef run():\n    return 42\n',
    },
    {
      filename: 'windows.ts',
      language: 'typescript',
      code: '/**\r\n * ```ts\r\n * run();\r\n * ```\r\n */\r\nexport const run = () => 42;\r\n',
    },
  ])('keeps embedded fences inside the full source file $filename', async ({
    filename,
    language,
    code,
  }) => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-recipe-parser-'));
    try {
      fs.writeFileSync(path.join(projectRoot, filename), code);
      const result = await new RecipeParser().extractFromPath(filename, { projectRoot });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        title: path.basename(filename, path.extname(filename)),
        language,
        code,
        codeBlocks: [{ language, code }],
        frontmatter: {},
      });
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    { filename: 'guide.md', text: '# Example\n```ts\nrun();\n```', title: 'Example' },
    { filename: 'README', text: '# Example\n```ts\nrun();\n```', title: 'Example' },
    { filename: 'guide.notes', text: '# Example\n```ts\nrun();\n```', title: 'Example' },
    { filename: 'marked.ts', text: recipe('Explicit Recipe', 'run();'), title: 'Explicit Recipe' },
    {
      filename: 'marked-crlf.ts',
      text: recipe('Explicit CRLF Recipe', 'run();').replaceAll('\n', '\r\n'),
      title: 'Explicit CRLF Recipe',
    },
    {
      filename: 'marked-crlf.py',
      text: recipe('Explicit CRLF Recipe', 'run();').replaceAll('\n', '\r\n'),
      title: 'Explicit CRLF Recipe',
    },
  ])('keeps document and explicit-frontmatter extraction for $filename', async ({
    filename,
    text,
    title,
  }) => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-recipe-parser-'));
    try {
      fs.writeFileSync(path.join(projectRoot, filename), text);
      const result = await new RecipeParser().extractFromPath(filename, { projectRoot });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ title, code: 'run();' });
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('rejects raw source as Recipe Markdown so text extraction can use its fallback', async () => {
    const parser = new RecipeParser();
    const code = 'export const answer = 42;';
    await expect(parser.parseFromText(code)).rejects.toThrow('Recipe Markdown');
    await expect(parser.extractFromText(code, { language: 'typescript' })).resolves.toMatchObject({
      code,
      language: 'typescript',
      codeBlocks: [{ language: 'typescript', code }],
    });
  });

  it('keeps one complete recipe frontmatter and code in the same document', async () => {
    const parser = new RecipeParser();
    const text = recipe('Atomic Recipe');
    expect(parser.parseAll(text)).toHaveLength(1);
    await expect(parser.parseFromText(text)).resolves.toMatchObject({
      title: 'Atomic Recipe',
      summary: 'A reusable implementation',
      code: 'export const value = 1;',
      usageGuide: 'Use the implementation at the module boundary.',
      frontmatter: { title: 'Atomic Recipe', category: 'architecture' },
    });
  });

  it('extracts both complete documents without splitting their YAML delimiters', async () => {
    const parser = new RecipeParser();
    const text = `${recipe('First')}\n---\n${recipe('Second', 'export const second = 2;')}`;
    const all = parser.parseAll(text);
    expect(all.map((item) => item.title)).toEqual(['First', 'Second']);
    expect(all.map((item) => item.code)).toEqual([
      'export const value = 1;',
      'export const second = 2;',
    ]);
    await expect(parser.parseFromText(text)).resolves.toEqual(all);
  });

  it('keeps fenced separators and ordinary Markdown horizontal rules inside the recipe', () => {
    const code = 'first line\n---\n# a code heading\nlast line';
    const text = `${recipe('Fenced Recipe', code)}\n\n---\nMore usage detail.`;
    const all = new RecipeParser().parseAll(text);
    expect(all).toHaveLength(1);
    expect(all[0].code).toBe(code);
    expect(all[0].usageGuide).toContain('More usage detail.');
  });

  it('preserves introduction-only Markdown and a heading with a fenced snippet', () => {
    const parser = new RecipeParser();
    const intro = '---\ntitle: Introduction\nsummary: An overview\n---\n# Introduction\nOverview.';
    expect(parser.isIntroOnly(intro)).toBe(true);
    expect(parser.parseAll(intro)).toMatchObject([
      { title: 'Introduction', summary: 'An overview', codeBlocks: [] },
    ]);
    expect(parser.parseAll('# Snippet\n```ts\nconst value = 1;\n```')).toMatchObject([
      { title: 'Snippet', code: 'const value = 1;' },
    ]);
  });

  it('preserves standalone fenced Markdown as a parseable snippet', async () => {
    await expect(
      new RecipeParser().parseFromText('```ts\nconst value = 1;\n```')
    ).resolves.toMatchObject([{ code: 'const value = 1;', language: 'ts' }]);
  });

  it('keeps standalone fenced snippets separated by a document divider independent', () => {
    const text = '```ts\nconst first = 1;\n```\n---\n```ts\nconst second = 2;\n```';
    expect(new RecipeParser().parseAll(text).map((item) => item.code)).toEqual([
      'const first = 1;',
      'const second = 2;',
    ]);
  });
});
