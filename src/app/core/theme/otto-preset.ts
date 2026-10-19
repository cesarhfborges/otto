import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

/**
 * Ajustes sobre o Aura para atingir contraste WCAG AA (4.5:1).
 * O Aura usa surface.500 sobre surface.100 (4.34:1) nas opções não selecionadas do SelectButton.
 */
const ACCESSIBLE_TOKENS = {
    semantic: {
        colorScheme: {
            // primary.500 (emerald) sobre branco dá 2.53:1 em texto (abas ativas, links); 700 dá 5.5:1.
            light: {
                primary: { color: '{primary.700}', contrastColor: '#ffffff', hoverColor: '{primary.800}', activeColor: '{primary.900}' }
            }
        }
    },
    components: {
        togglebutton: {
            colorScheme: {
                light: {
                    root: { color: '{surface.600}' },
                    icon: { color: '{surface.600}' }
                }
            }
        }
    }
};

/** Densidade de aplicativo desktop (estilo Bruno/VS Code): árvore e abas compactas. */
const DENSITY_TOKENS = {
    components: {
        tree: {
            root: { padding: '0.25rem 0.375rem', gap: '1px', indent: '0.875rem' },
            node: { padding: '0.1875rem 0.375rem', gap: '0.25rem' },
            nodeToggleButton: { size: '1.25rem' }
        },
        tabs: {
            // Sub-abas sobre a área principal (sem "cartão" próprio), como no Bruno.
            tablist: { background: 'transparent' },
            tab: { padding: '0.5rem 0.875rem', fontWeight: '500' },
            tabpanel: { padding: '0.75rem 0', background: 'transparent' }
        }
    }
};

export const OttoPreset = definePreset(Aura, ACCESSIBLE_TOKENS, DENSITY_TOKENS);
