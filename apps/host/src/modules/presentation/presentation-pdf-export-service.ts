import type { HostConfig } from "../../config/env.js";
import { renderPresentationDocument } from "./presentation-renderer.js";

export interface ExportPresentationPdfInput {
  htmlContent: string;
  sourceFilePath: string;
  outputFilePath: string;
  signal: AbortSignal;
}

export interface ExportPresentationPdfResult {
  outputPath: string;
  pageCount: number;
  pageSize: {
    width: number;
    height: number;
  };
}

export class PresentationPdfExportService {
  constructor(private readonly config: HostConfig) {}

  async exportPdf(input: ExportPresentationPdfInput): Promise<ExportPresentationPdfResult> {
    const rendered = await renderPresentationDocument(this.config, {
      htmlContent: input.htmlContent,
      sourceFilePath: input.sourceFilePath,
      signal: input.signal
    });

    try {
      await rendered.renderPdf(input.outputFilePath);

      return {
        outputPath: input.outputFilePath,
        pageCount: rendered.pageCount,
        pageSize: {
          width: rendered.pageSize.width,
          height: rendered.pageSize.height
        }
      };
    } finally {
      await rendered.close();
    }
  }
}
