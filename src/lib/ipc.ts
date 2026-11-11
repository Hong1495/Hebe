import { inspectLongDocument } from "../components/editor/long-document";
export const isTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export interface Heading {
  text: string;
  level: number;
  line: number;
}

export async function readMarkdownFile(path: string): Promise<string> {
  if (!isTauriRuntime()) throw new Error("File I/O requires Tauri runtime");
  return invoke<string>("read_markdown_file", { path });
}

export async function takePendingOpenFiles(): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  return invoke<string[]>("take_pending_open_files");
}

export async function writeMarkdownFile(
  path: string,
  content: string,
  expectedContent?: string,
): Promise<void> {
  if (!isTauriRuntime()) throw new Error("File I/O requires Tauri runtime");
  return invoke<void>("write_markdown_file", {
    path,
    content,
    expectedContent: expectedContent ?? null,
  });
}

export async function getFileMtime(path: string): Promise<number> {
  if (!isTauriRuntime()) throw new Error("File metadata requires Tauri runtime");
  return Number(await invoke<number | string>("get_file_mtime", { path }));
}

export async function getHeadingOutline(content: string): Promise<Heading[]> {
  return inspectLongDocument(content).headings.map(({ text, level, line }) => ({
    text,
    level,
    line,
  }));
}

export interface ExportOptions {
  paperSize: string;
  fontSize: number;
  marginMm: number;
  tableOfContents: boolean;
  numberSections: boolean;
}

export async function exportDocument(
  content: string,
  inputPath: string,
  format: string,
  outputPath: string,
  options?: ExportOptions,
): Promise<string> {
  if (!isTauriRuntime()) throw new Error("Export requires Tauri runtime");
  return invoke<string>("export_document", {
    content,
    inputPath,
    format,
    outputPath,
    options: options ?? null,
  });
}

export async function pasteImage(imageData: number[], mdPath: string): Promise<string> {
  if (!isTauriRuntime()) throw new Error("Paste requires Tauri runtime");
  return invoke<string>("paste_image", { imageData, mdPath });
}

export async function renderSvgToPngDataUri(svg: string): Promise<string> {
  if (!isTauriRuntime()) throw new Error("SVG rendering requires Tauri runtime");
  return invoke<string>("render_svg_to_png_data_uri", { svg });
}

export async function hideMainWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("hide_main_window");
}
