export interface TerminalHistorySegmentDto {
  id: string;
  fileId: string;
  startSeq: number;
  endSeq: number;
  content: string;
  byteLength: number;
  createdAt: string;
}

export interface TerminalHistoryPageDto {
  terminalId: string;
  content: string;
  lineCount: number;
  anchorLine: number;
  replaceContent?: boolean;
  hasMore: boolean;
  nextBeforeSeq: number | null;
}
