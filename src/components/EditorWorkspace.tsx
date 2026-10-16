import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";

export interface EditorWorkspaceProps {
  title: string;
  subtitle?: string;
  breadcrumb?: ReactNode;
  sidebar?: ReactNode;
  showSidebar?: boolean;
  onBack?: () => void;
  backLabel?: string;
  onClose: () => void;
  headerActions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

export function EditorWorkspace({
  title,
  subtitle,
  breadcrumb,
  sidebar,
  showSidebar = false,
  onBack,
  backLabel = "Back",
  onClose,
  headerActions,
  children,
  footer,
}: EditorWorkspaceProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="editor-workspace"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="editor-frame">
        <header className="editor-header">
          <div className="editor-header-title">
            <h1>{title}</h1>
            {subtitle && (
              <span className="editor-draft-status" role="status">
                {subtitle}
              </span>
            )}
          </div>
          <div className="editor-header-actions">
            {headerActions}
            <button
              type="button"
              className="editor-icon-button"
              aria-label="Close editor"
              onClick={onClose}
            >
              <X size={21} />
            </button>
          </div>
        </header>
        <div
          className={`editor-body${sidebar ? " has-sidebar" : ""}${showSidebar ? " show-navigation" : ""}`}
        >
          {sidebar && (
            <aside className="editor-sidebar" data-reorder-scroll>
              {sidebar}
            </aside>
          )}
          <main className="editor-main" data-reorder-scroll>
            {(onBack || breadcrumb) && (
              <div className="editor-context">
                {onBack && (
                  <button
                    type="button"
                    className="editor-back"
                    onClick={onBack}
                  >
                    <ArrowLeft size={16} />
                    {backLabel}
                  </button>
                )}
                {breadcrumb && (
                  <div className="editor-breadcrumb">{breadcrumb}</div>
                )}
              </div>
            )}
            <div className="editor-content">{children}</div>
          </main>
        </div>
        {footer && <footer className="editor-footer">{footer}</footer>}
      </div>
    </dialog>
  );
}
