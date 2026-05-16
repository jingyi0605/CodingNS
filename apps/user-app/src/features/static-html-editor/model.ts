export type DocumentMode = "presentation" | "report";

export type DocumentNodeType =
  | "group"
  | "text"
  | "image"
  | "shape"
  | "html"
  | "svg"
  | "decoration";

export type PatchStrategy =
  | "text_only"
  | "style_only"
  | "text_and_style"
  | "replace_node";

export interface DocumentSource {
  kind: "codingns" | "desktop";
  path: string;
  version: string | null;
  entryHtmlHash: string;
}

export interface ProjectCanvasConfig {
  width: number;
  height: number;
  unit: "px";
  aspectRatioLocked: boolean;
}

export interface SourceRef {
  pageIndex: number;
  pageSelector: string;
  nodePath: number[];
}

export interface PageFrame {
  width: number;
  height: number;
  background: string | null;
}

export interface DocumentNodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

export interface DocumentNodeStyle {
  position?: string | null;
  fontFamily?: string | null;
  fontSize?: number | null;
  fontWeight?: string | null;
  fontStyle?: string | null;
  lineHeight?: string | null;
  letterSpacing?: string | null;
  color?: string | null;
  textAlign?: string | null;
  textDecoration?: string | null;
  textDecorationColor?: string | null;
  whiteSpace?: string | null;
  padding?: string | null;
  margin?: string | null;
  borderRadius?: string | null;
  borderWidth?: string | null;
  borderColor?: string | null;
  backgroundColor?: string | null;
  opacity?: number | null;
}

export interface DocumentTextRun {
  text: string;
  tagName?: string | null;
  className?: string | null;
  style?: DocumentNodeStyle | null;
  sourceKind?: "text" | "element" | null;
}

export interface DocumentNodeContent {
  text?: string | null;
  runs?: DocumentTextRun[] | null;
  src?: string | null;
  alt?: string | null;
  html?: string | null;
}

export interface DocumentNode {
  id: string;
  type: DocumentNodeType;
  name: string;
  editable: boolean;
  lockedReason: string | null;
  box: DocumentNodeBox;
  style: DocumentNodeStyle;
  content: DocumentNodeContent;
  children: string[];
  sourceRef: SourceRef | null;
  patchStrategy: PatchStrategy;
  runtimeFlags: string[];
}

export interface PageRuntimeHints {
  hasActiveStateClass: boolean;
  hasDeckShell: boolean;
}

export interface DocumentPage {
  id: string;
  order: number;
  title: string | null;
  frame: PageFrame;
  rootNodeId: string;
  sourceRef: SourceRef;
  runtimeHints: PageRuntimeHints;
}

export interface DocumentAsset {
  id: string;
  type: "image";
  src: string;
}

export interface ProjectWarning {
  code: string;
  message: string;
  pageId?: string;
}

export interface ProjectMeta {
  originalTitle: string | null;
  pageDetectionStrategy: string;
}

export interface DocumentProject {
  id: string;
  schemaVersion: number;
  mode: DocumentMode;
  source: DocumentSource;
  canvas: ProjectCanvasConfig;
  pages: DocumentPage[];
  nodes: Record<string, DocumentNode>;
  assets: DocumentAsset[];
  warnings: ProjectWarning[];
  meta: ProjectMeta;
}

export interface PresentationProbePage {
  index: number;
  title: string;
  selector: string;
  sourceRef: SourceRef;
}

export interface PresentationProbeResult {
  supported: boolean;
  reason: string | null;
  mode: "presentation";
  strategy: string | null;
  pages: PresentationProbePage[];
  warnings: string[];
  viewport: {
    width: number;
    height: number;
  };
}
