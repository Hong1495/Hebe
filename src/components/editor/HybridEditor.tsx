import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  Annotation,
  Compartment,
  EditorState,
  type Extension,
  StateEffect,
} from "@codemirror/state";
import { EditorView, highlightActiveLine, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../stores/app-store";
import { editorSessions } from "./editor-sessions";
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
import { typewriterExtension } from "./extensions/writing-modes";
import { runMarkdownFormatCommand } from "./format-commands";
import { pendingImages } from "./image-actions";

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

const externalContentSync = Annotation.define<boolean>();

declare global {
  interface Window {
    __HEBE_EDITOR_TEST__?: {
      getDocument: () => string;
      getSelection: () => { from: number; to: number };
      setDocument: (content: string) => void;
      setSelection: (from: number, to?: number) => void;
    };
  }
}

function hybridPreviewExtensions(sourceMode: boolean, mdPath: string | null): Extension[] {
  return sourceMode
    ? []
    : [inlinePreviewPlugin, clickRevealPlugin, blockWidgetPlugin(mdPath ?? null)];
}

interface HybridEditorProps {
  documentId: string;
  initialContent?: string;
  onContentChange?: (content: string) => void;
  onOpenFile?: () => void;
  onNewDocument?: () => void;
  onSaveFile?: () => void;
  focusMode?: boolean;
  typewriterMode?: boolean;
  sourceMode?: boolean;
  onEditorView?: (view: EditorView) => void;
  mdPath?: string | null;
}

export function HybridEditor({
  documentId,
  initialContent = "",
  onContentChange,
  onOpenFile,
  onNewDocument,
  onSaveFile,
  focusMode = false,
  typewriterMode = false,
  sourceMode = false,
  onEditorView,
  mdPath,
}: HybridEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const previewCompartmentRef = useRef<Compartment | null>(null);
  const writingCompartmentRef = useRef(new Compartment());
  const pasteCompartmentRef = useRef(new Compartment());
  const [isReady, setIsReady] = useState(false);

  if (!previewCompartmentRef.current) {
    previewCompartmentRef.current = new Compartment();
  }

  useEffect(() => {
    if (!containerRef.current || viewRef.current) return;
    const previewCompartment = previewCompartmentRef.current;
    if (!previewCompartment) return;
    let testBridge: HTMLElement | null = null;
    let bridgedView: EditorView | null = null;
    let removeTestBridgeListeners: (() => void) | null = null;

    const syncTestBridge = () => {
      if (!testBridge || !bridgedView) return;
      const selection = bridgedView.state.selection.main;
      testBridge.dataset.document = bridgedView.state.doc.toString();
      testBridge.dataset.selectionFrom = String(selection.from);
      testBridge.dataset.selectionTo = String(selection.to);
    };

    const updateContent = EditorView.updateListener.of((update) => {
      const externalUpdate = update.transactions.some((tr) => tr.annotation(externalContentSync));
      if (update.docChanged && !externalUpdate && onContentChange) {
        onContentChange(update.state.doc.toString());
      }
    });
    const updateTestBridge = EditorView.updateListener.of((update) => {
      if (!import.meta.env.DEV || (!update.docChanged && !update.selectionSet)) return;
      queueMicrotask(syncTestBridge);
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
        key: "Mod-b",
        run: (view) => runMarkdownFormatCommand(view, "format-bold"),
        preventDefault: true,
      },
      {
        key: "Mod-i",
        run: (view) => runMarkdownFormatCommand(view, "format-italic"),
        preventDefault: true,
      },
      {
        key: "Mod-e",
        run: (view) => runMarkdownFormatCommand(view, "format-inline-code"),
        preventDefault: true,
      },
      {
        key: "Mod-k",
        run: (view) => runMarkdownFormatCommand(view, "format-link"),
        preventDefault: true,
      },
    ]);

    const extensions: Extension[] = [
      markdown({ base: markdownLanguage }),
      history(),
      pendingImages,
      EditorView.domEventHandlers({
        compositionstart() {
          useAppStore.setState((state) => ({
            tabs: state.tabs.map((tab) =>
              tab.id === documentId ? { ...tab, composing: true } : tab,
            ),
          }));
          return false;
        },
        compositionend() {
          // Let CodeMirror finish its final composition transaction before syncing disk changes.
          setTimeout(
            () =>
              useAppStore.setState((state) => ({
                tabs: state.tabs.map((tab) =>
                  tab.id === documentId ? { ...tab, composing: false } : tab,
                ),
              })),
            0,
          );
          return false;
        },
      }),
      highlightActiveLine(),
      writingCompartmentRef.current.of(typewriterMode ? typewriterExtension : []),
      closeBrackets(),
      highlightSelectionMatches(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...closeBracketsKeymap]),
      editorKeymap,

      hybridBaseTheme,
      editorFocusPlugin,
      editorFocusedField,
      previewRevealRangeField,
      previewCompartment.of(hybridPreviewExtensions(sourceMode, mdPath ?? null)),

      pasteCompartmentRef.current.of(pasteImagePlugin(mdPath ?? null)),

      syntaxHighlighting(markdownHighlightStyle),

      updateContent,
      updateTestBridge,
    ];

    const session = editorSessions.get(documentId);
    let state = session?.state ?? EditorState.create({ doc: initialContent, extensions });
    if (session) state = state.update({ effects: StateEffect.reconfigure.of(extensions) }).state;
    const view = new EditorView({ state, parent: containerRef.current });

    viewRef.current = view;
    if (session)
      view.requestMeasure({
        read: () => session.scrollTop,
        write: (scrollTop) => {
          view.scrollDOM.scrollTop = scrollTop;
        },
      });
    bridgedView = view;
    if (import.meta.env.DEV) {
      window.__HEBE_EDITOR_TEST__ = {
        getDocument: () => view.state.doc.toString(),
        getSelection: () => {
          const selection = view.state.selection.main;
          return { from: selection.from, to: selection.to };
        },
        setDocument: (content) => {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: content },
            selection: { anchor: 0, head: 0 },
            annotations: externalContentSync.of(true),
          });
        },
        setSelection: (from, to = from) => {
          view.dispatch({ selection: { anchor: from, head: to } });
        },
      };

      testBridge = document.createElement("div");
      testBridge.id = "hebe-editor-test-bridge";
      testBridge.hidden = true;
      testBridge.setAttribute("aria-hidden", "true");
      document.body.appendChild(testBridge);

      const setDocument = () => {
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: testBridge?.dataset.document ?? "",
          },
          selection: { anchor: 0, head: 0 },
          annotations: externalContentSync.of(true),
        });
        syncTestBridge();
      };
      const setSelection = () => {
        const from = Number.parseInt(testBridge?.dataset.selectionFrom ?? "0", 10);
        const to = Number.parseInt(testBridge?.dataset.selectionTo ?? String(from), 10);
        if (!Number.isFinite(from) || !Number.isFinite(to)) return;
        view.dispatch({ selection: { anchor: from, head: to } });
        syncTestBridge();
      };
      const getState = () => syncTestBridge();

      testBridge.addEventListener("hebe:set-document", setDocument);
      testBridge.addEventListener("hebe:set-selection", setSelection);
      testBridge.addEventListener("hebe:get-state", getState);
      removeTestBridgeListeners = () => {
        testBridge?.removeEventListener("hebe:set-document", setDocument);
        testBridge?.removeEventListener("hebe:set-selection", setSelection);
        testBridge?.removeEventListener("hebe:get-state", getState);
        testBridge?.remove();
        testBridge = null;
      };
      syncTestBridge();
    }
    setIsReady(true);
    onEditorView?.(view);

    return () => {
      if (import.meta.env.DEV) delete window.__HEBE_EDITOR_TEST__;
      removeTestBridgeListeners?.();
      editorSessions.set(documentId, { state: view.state, scrollTop: view.scrollDOM.scrollTop });
      editorSessions.prune(useAppStore.getState().tabs.map((tab) => tab.id));
      view.destroy();
      viewRef.current = null;
      bridgedView = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const dom = viewRef.current?.dom;
    if (!dom) return;
    dom.classList.toggle("cm-focus-mode", focusMode);
  }, [focusMode]);

  useEffect(() => {
    const dom = viewRef.current?.dom;
    if (!dom) return;
    dom.classList.toggle("cm-typewriter-mode", typewriterMode);
    viewRef.current?.dispatch({
      effects: writingCompartmentRef.current.reconfigure(typewriterMode ? typewriterExtension : []),
    });
  }, [typewriterMode]);

  useEffect(() => {
    const view = viewRef.current;
    const previewCompartment = previewCompartmentRef.current;
    if (!view || !previewCompartment || !isReady) return;
    view.dispatch({
      effects: [
        previewCompartment.reconfigure(hybridPreviewExtensions(sourceMode, mdPath ?? null)),
        pasteCompartmentRef.current.reconfigure(pasteImagePlugin(mdPath ?? null)),
      ],
    });
  }, [sourceMode, mdPath, isReady]);

  useEffect(() => {
    if (!viewRef.current || !isReady) return;
    const currentContent = viewRef.current.state.doc.toString();
    if (initialContent !== currentContent) {
      viewRef.current.dispatch({
        changes: { from: 0, to: currentContent.length, insert: initialContent },
        annotations: externalContentSync.of(true),
      });
    }
  }, [initialContent, isReady]);

  return <div ref={containerRef} className="h-full w-full" style={{ background: "var(--bg)" }} />;
}
