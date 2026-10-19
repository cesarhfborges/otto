/**
 * Ajustes sobre os presets do PrimeNG para atingir contraste WCAG AA (4.5:1).
 * Aplicado no `providePrimeNG` e sempre que o preset é trocado em tempo de execução.
 */
export const ACCESSIBLE_TOKENS = {
    components: {
        togglebutton: {
            colorScheme: {
                // Aura usa surface.500 sobre surface.100 (4.34:1) nas opções não selecionadas.
                light: {
                    root: { color: '{surface.600}' },
                    icon: { color: '{surface.600}' }
                }
            }
        }
    }
};
