import { frontmatter } from 'micromark-extension-frontmatter';
import { gfm } from 'micromark-extension-gfm';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { frontmatterFromMarkdown, frontmatterToMarkdown } from 'mdast-util-frontmatter';
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm';
import { toMarkdown } from 'mdast-util-to-markdown';

export const PLANNER_MARKDOWN_SCHEMA_VERSION = 1 as const;

export type PlannerMarkdownAst = ReturnType<typeof fromMarkdown>;

export type MarkdownDiagnostic = {
  severity: 'notice';
  code: 'raw_html_preserved';
  message: string;
};

export type PlannerMarkdownHeading = {
  depth: number;
  text: string;
  line: number;
};

export interface MarkdownEditorAdapter<TModel> {
  readonly id: string;
  fromAst(ast: PlannerMarkdownAst): TModel;
  toAst(model: TModel): PlannerMarkdownAst;
}

const parseOptions = {
  extensions: [gfm(), frontmatter(['yaml'])],
  mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(['yaml'])],
};

const serializeOptions = {
  bullet: '-' as const,
  emphasis: '_' as const,
  fences: true,
  listItemIndent: 'one' as const,
  resourceLink: true,
  extensions: [gfmToMarkdown(), frontmatterToMarkdown(['yaml'])],
};

export function parsePlannerMarkdown(markdown: string): PlannerMarkdownAst {
  return fromMarkdown(markdown, parseOptions);
}

export function serializePlannerMarkdown(ast: PlannerMarkdownAst): string {
  return toMarkdown(ast, serializeOptions);
}

export function normalizePlannerMarkdown(markdown: string): string {
  return serializePlannerMarkdown(parsePlannerMarkdown(markdown));
}

function withoutPositions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPositions);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'position')
      .map(([key, child]) => [key, withoutPositions(child)])
  );
}

export function semanticPlannerMarkdownAst(ast: PlannerMarkdownAst): unknown {
  return withoutPositions(ast);
}

export function plannerMarkdownIsSemanticallyEquivalent(left: string, right: string): boolean {
  return (
    JSON.stringify(semanticPlannerMarkdownAst(parsePlannerMarkdown(left))) ===
    JSON.stringify(semanticPlannerMarkdownAst(parsePlannerMarkdown(right)))
  );
}

export function inspectPlannerMarkdown(ast: PlannerMarkdownAst): MarkdownDiagnostic[] {
  const diagnostics: MarkdownDiagnostic[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const record = node as { type?: unknown; children?: unknown };
    if (record.type === 'html') {
      diagnostics.push({
        severity: 'notice',
        code: 'raw_html_preserved',
        message: 'Raw HTML is preserved in source mode and is not executed by Planner AI.',
      });
    }
    if (Array.isArray(record.children)) record.children.forEach(visit);
  };
  visit(ast);
  return diagnostics;
}

function textFromMarkdownNode(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const node = value as { value?: unknown; children?: unknown };
  const ownText = typeof node.value === 'string' ? node.value : '';
  const childText = Array.isArray(node.children)
    ? node.children.map(textFromMarkdownNode).join('')
    : '';
  return ownText + childText;
}

/** A source-derived outline keeps navigation useful without creating a second document model. */
export function extractPlannerMarkdownHeadings(markdown: string): PlannerMarkdownHeading[] {
  const headings: PlannerMarkdownHeading[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const node = value as {
      type?: unknown;
      depth?: unknown;
      children?: unknown;
      position?: { start?: { line?: unknown } };
    };
    if (node.type === 'heading' && typeof node.depth === 'number') {
      const text = textFromMarkdownNode(node).trim();
      if (text) {
        headings.push({
          depth: node.depth,
          text,
          line: typeof node.position?.start?.line === 'number' ? node.position.start.line : 1,
        });
      }
    }
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  visit(parsePlannerMarkdown(markdown));
  return headings;
}

export function roundTripPlannerMarkdown<TModel>(
  markdown: string,
  adapter: MarkdownEditorAdapter<TModel>
) {
  const sourceAst = parsePlannerMarkdown(markdown);
  const editorModel = adapter.fromAst(sourceAst);
  const outputAst = adapter.toAst(editorModel);
  const normalizedMarkdown = serializePlannerMarkdown(outputAst);
  return {
    normalizedMarkdown,
    diagnostics: inspectPlannerMarkdown(outputAst),
    semanticallyEquivalent:
      JSON.stringify(semanticPlannerMarkdownAst(sourceAst)) ===
      JSON.stringify(semanticPlannerMarkdownAst(outputAst)),
  };
}

export const mdastIdentityEditorAdapter: MarkdownEditorAdapter<PlannerMarkdownAst> = {
  id: 'planner-mdast-identity-v1',
  fromAst: (ast) => structuredClone(ast),
  toAst: (model) => structuredClone(model),
};
