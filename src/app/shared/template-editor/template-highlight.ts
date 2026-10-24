import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/** Novo realce calculado (assíncrono) para o documento atual. */
export const setHighlight = StateEffect.define<DecorationSet>();

/** Classes `hljs-*` sobre o texto; acompanha as edições até o próximo realce chegar. */
export const highlightField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update: (decorations, tr) => {
        const next = tr.effects.find((effect) => effect.is(setHighlight));

        return next ? next.value : decorations.map(tr.changes);
    },
    provide: (field) => EditorView.decorations.from(field)
});

/** Converte o HTML do highlight.js em marcações por posição (o texto decodificado é o próprio documento). */
export function highlightDecorations(html: string): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const root = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
    let pos = 0;

    const walk = (node: Node, classes: string): void => {
        for (const child of Array.from(node.childNodes)) {
            if (child instanceof Element) {
                walk(child, `${classes} ${child.className}`.trim());
            } else {
                const length = child.textContent?.length ?? 0;

                if (classes && length) {
                    builder.add(pos, pos + length, Decoration.mark({ class: classes }));
                }

                pos += length;
            }
        }
    };

    walk(root, '');

    return builder.finish();
}
