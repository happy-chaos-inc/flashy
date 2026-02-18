/**
 * CodeMirror Collaborative Cursors
 * Broadcasts local caret position and renders remote carets
 */
import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import type { Awareness } from 'y-protocols/awareness';

// Effect to update remote cursors
const setRemoteCursors = StateEffect.define<RemoteCursor[]>();

interface RemoteCursor {
  clientId: number;
  name: string;
  color: string;
  position: number; // Character offset in the document
}

// Widget for the cursor caret line
class CursorWidget extends WidgetType {
  constructor(readonly name: string, readonly color: string) {
    super();
  }

  toDOM() {
    const wrapper = document.createElement('span');
    wrapper.className = 'cm-remote-cursor';
    wrapper.style.cssText = `
      position: relative;
      border-left: 2px solid ${this.color};
      margin-left: -1px;
      margin-right: -1px;
    `;

    const label = document.createElement('span');
    label.className = 'cm-remote-cursor-label';
    label.textContent = this.name;
    label.style.cssText = `
      position: absolute;
      top: -18px;
      left: -1px;
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
      color: white;
      background: ${this.color};
      padding: 2px 6px;
      border-radius: 4px 4px 4px 0;
      white-space: nowrap;
      pointer-events: none;
      z-index: 100;
    `;

    wrapper.appendChild(label);
    return wrapper;
  }

  eq(other: CursorWidget) {
    return other.name === this.name && other.color === this.color;
  }
}

// State field to track remote cursor decorations
const remoteCursorField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    // Apply any cursor update effects
    for (const effect of tr.effects) {
      if (effect.is(setRemoteCursors)) {
        const cursors = effect.value;
        const widgets = cursors.map(cursor => {
          // Clamp position to document length
          const pos = Math.min(cursor.position, tr.state.doc.length);
          return Decoration.widget({
            widget: new CursorWidget(cursor.name, cursor.color),
            side: 1,
          }).range(pos);
        });
        return Decoration.set(widgets, true);
      }
    }
    // Map decorations through document changes
    return decorations.map(tr.changes);
  },
  provide: f => EditorView.decorations.from(f),
});

/**
 * Create a ViewPlugin that syncs cursor position with Yjs awareness
 */
export function createCursorPlugin(awareness: Awareness) {
  const localClientId = awareness.doc.clientID;

  return ViewPlugin.fromClass(
    class {
      private lastPos: number = -1;

      constructor(private view: EditorView) {
        // Initial broadcast (deferred to avoid update-in-progress)
        requestAnimationFrame(() => {
          this.broadcastCursor();
        });

        // Listen for remote cursor updates
        awareness.on('change', this.handleAwarenessChange);
        // Initial update (deferred)
        requestAnimationFrame(() => {
          this.handleAwarenessChange();
        });
      }

      update(update: ViewUpdate) {
        // Broadcast cursor position when selection changes
        if (update.selectionSet || update.docChanged) {
          this.broadcastCursor();
        }
      }

      broadcastCursor = () => {
        const pos = this.view.state.selection.main.head;
        if (pos !== this.lastPos) {
          this.lastPos = pos;
          awareness.setLocalStateField('cmCursor', { position: pos });
        }
      };

      handleAwarenessChange = () => {
        const states = awareness.getStates();
        const remoteCursors: RemoteCursor[] = [];

        states.forEach((state: any, clientId: number) => {
          // Skip our own cursor
          if (clientId === localClientId) return;

          const user = state.user;
          const cursor = state.cmCursor;

          if (user && cursor && typeof cursor.position === 'number') {
            remoteCursors.push({
              clientId,
              name: user.name || `User ${clientId}`,
              color: user.color || '#888',
              position: cursor.position,
            });
          }
        });

        // Defer dispatch to avoid "update in progress" error
        requestAnimationFrame(() => {
          this.view.dispatch({
            effects: setRemoteCursors.of(remoteCursors),
          });
        });
      };

      destroy() {
        awareness.off('change', this.handleAwarenessChange);
        // Clear our cursor from awareness
        awareness.setLocalStateField('cmCursor', null);
      }
    }
  );
}

/**
 * Get all extensions needed for collaborative cursors
 */
export function collaborativeCursors(awareness: Awareness) {
  return [
    remoteCursorField,
    createCursorPlugin(awareness),
  ];
}
