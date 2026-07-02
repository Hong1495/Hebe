import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../stores/app-store";
import { blockWidgetPlugin } from "./extensions/block-widgets";
import {
  clickRevealPlugin,
  editorFocusedField,
  editorFocusPlugin,
  hybridBaseTheme,
  inlinePreviewPlugin,
  pasteImagePlugin,
  previewRevealRangeField,
} from "./extensions/hybrid-preview";

type ThemeKey = "light" | "dark" | "sepia";

const sepiaHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, class: "md-heading-1" },
  { tag: tags.heading2, class: "md-heading-2" },
  { tag: tags.heading3, class: "md-heading-3" },
  { tag: tags.heading, class: "md-heading" },
  { tag: tags.keyword, color: "#8b5e3c" },
  { tag: tags.string, color: "#5d7a4a" },
  { tag: tags.comment, color: "#a09080", fontStyle: "italic" },
  { tag: tags.meta, color: "#b85c38" },
  { tag: tags.link, class: "md-link" },
  { tag: tags.url, class: "md-url" },
  { tag: tags.emphasis, class: "md-emphasis" },
  { tag: tags.strong, class: "md-strong" },
  { tag: tags.monospace, class: "md-code" },
  { tag: tags.quote, class: "md-quote" },
  { tag: tags.list, class: "md-list" },
  { tag: tags.atom, color: "#9b6b3c" },
  { tag: tags.bool, color: "#a0522d" },
  { tag: tags.number, color: "#8b5e3c" },
  { tag: tags.name, color: "#3c2f20" },
  { tag: tags.operator, color: "#7a6040" },
  { tag: tags.regexp, color: "#5d7a4a" },
  { tag: tags.url, color: "#6e5a3f", textDecoration: "underline" },
]);

const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, class: "md-heading-1" },
  { tag: tags.heading2, class: "md-heading-2" },
  { tag: tags.heading3, class: "md-heading-3" },
  { tag: tags.heading, class: "md-heading" },
  { tag: tags.strong, class: "md-strong" },
  { tag: tags.emphasis, class: "md-emphasis" },
  { tag: tags.link, class: "md-link" },
  { tag: tags.url, class: "md-url" },
  { tag: tags.monospace, class: "md-code" },
  { tag: tags.quote, class: "md-quote" },
  { tag: tags.list, class: "md-list" },
  { tag: tags.contentSeparator, class: "md-separator" },
  { tag: tags.processingInstruction, class: "md-mark" },
  { tag: tags.meta, class: "md-mark" },
  { tag: tags.labelName, class: "md-mark" },
]);

interface HybridEditorProps {
  initialContent?: string;
  onContentChange?: (content: string) => void;
  onOpenFile?: () => void;
  onNewDocument?: () => void;
  onSaveFile?: () => void;
  onQuickOpen?: () => void;
  onGlobalSearch?: () => void;
  focusMode?: boolean;
  typewriterMode?: boolean;
  onEditorView?: (view: EditorView) => void;
  mdPath?: string | null;
}

const themeCompartment = new Compartment();

function themeExtension(key: ThemeKey): Extension {
  switch (key) {
    case "dark":
      return [oneDark];
    case "sepia":
      return [syntaxHighlighting(sepiaHighlightStyle)];
    default:
      return [syntaxHighlighting(markdownHighlightStyle)];
  }
}

export function HybridEditor({
  initialContent = "",
  onContentChange,
  onOpenFile,
  onNewDocument,
  onSaveFile,
  onQuickOpen,
  onGlobalSearch,
  focusMode = false,
  typewriterMode = false,
  onEditorView,
  mdPath,
}: HybridEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const didMountThemeRef = useRef(false);
  const theme = useAppStore((s) => s.theme);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || viewRef.current) return;

    const updateContent = EditorView.updateListener.of((update) => {
      if (update.docChanged && onContentChange) {
        onContentChange(update.state.doc.toString());
      }
    });

    const editorKeymap = keymap.of([
      {
        key: "Mod-n",
        run: () => {
          onNewDocument?.();
          return true;
        },
      },
      {
        key: "Mod-o",
        run: () => {
          onOpenFile?.();
          return true;
        },
      },
      {
        key: "Mod-s",
        run: () => {
          onSaveFile?.();
          return true;
        },
        preventDefault: true,
      },
      {
        key: "Mod-p",
        run: () => {
          onQuickOpen?.();
          return true;
        },
      },
      {
        key: "Mod-Shift-f",
        run: () => {
          onGlobalSearch?.();
          return true;
        },
      },
    ]);

    const extensions: Extension[] = [
      history(),
      closeBrackets(),
      highlightSelectionMatches(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...closeBracketsKeymap]),
      editorKeymap,

      hybridBaseTheme,
      editorFocusPlugin,
      editorFocusedField,
      previewRevealRangeField,
      inlinePreviewPlugin,
      clickRevealPlugin,
      blockWidgetPlugin(mdPath ?? null),

      pasteImagePlugin(mdPath ?? null),

      themeCompartment.of(themeExtension(theme)),

      updateContent,
    ];

    const state = EditorState.create({ doc: initialContent, extensions });
    const view = new EditorView({ state, parent: containerRef.current });

    viewRef.current = view;
    setIsReady(true);
    onEditorView?.(view);

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!didMountThemeRef.current) {
      didMountThemeRef.current = true;
      return;
    }
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: themeCompartment.reconfigure(themeExtension(theme)),
    });
  }, [theme]);

  useEffect(() => {
    const dom = viewRef.current?.dom;
    if (!dom) return;
    dom.classList.toggle("cm-focus-mode", focusMode);
  }, [focusMode]);

  useEffect(() => {
    const dom = viewRef.current?.dom;
    if (!dom) return;
    dom.classList.toggle("cm-typewriter-mode", typewriterMode);
  }, [typewriterMode]);

  useEffect(() => {
    if (!viewRef.current || !isReady) return;
    const currentContent = viewRef.current.state.doc.toString();
    if (initialContent !== currentContent) {
      viewRef.current.dispatch({
        changes: { from: 0, to: currentContent.length, insert: initialContent },
      });
    }
  }, [initialContent, isReady]);

  return <div ref={containerRef} className="h-full w-full" style={{ background: "var(--bg)" }} />;
}
